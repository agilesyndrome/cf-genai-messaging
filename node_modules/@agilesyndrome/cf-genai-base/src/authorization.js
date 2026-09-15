import { createD1 } from "./core.js";

export const AUTH_USER_TABLE = "auth_users";
export const AUTH_SCOPE_TABLE = "auth_scopes";
export const AUTH_GRANT_TABLE = "auth_user_scopes";
export const DEFAULT_TENANT_ID = "easley-family";
export const DEFAULT_TENANT_NAME = "Easley Family";

export class SubscriptionError extends Error {
  constructor(message) { super(message); this.name = "SubscriptionError"; }
}

export function normalizeScopes(scopes = []) {
  return scopes.map((scope) => typeof scope === "string" ? { name: scope, label: scope, description: "", system: false } : scope)
    .filter((scope) => scope && /^[a-z0-9]+(?::[a-z0-9-]+)+$/.test(String(scope.name || "")))
    .map((scope) => ({ name: String(scope.name), label: String(scope.label || scope.name), description: String(scope.description || ""), system: Boolean(scope.system) }));
}

export async function ensureScopes(env, scopes = [], { who = "system:read" } = {}) {
  if (!env?.DB) return;
  const db = createD1(env, { who });
  for (const scope of normalizeScopes(scopes)) {
    await db.prepare(`INSERT INTO ${AUTH_SCOPE_TABLE} (name,label,description,system) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET label=excluded.label,description=excluded.description,system=excluded.system`).bind(scope.name, scope.label, scope.description, scope.system ? 1 : 0).run();
  }
}

export async function ensureUser(env, user, { who = "system:read" } = {}) {
  if (!env?.DB || !user?.sub) return null;
  const db = createD1(env, { who });
  const provider = String(user.auth_strategy || "oauth");
  const subject = String(user.sub);
  const email = String(user.email || "").trim().toLowerCase();
  const existing = await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE provider=? AND subject=?`).bind(provider, subject).first();
  const bootstrap = new Set(String(env.AUTH_ADMIN_EMAILS || env.ADMIN_EMAILS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
  if (existing) {
    await db.prepare(`UPDATE ${AUTH_USER_TABLE} SET email=?,display_name=?,is_admin=CASE WHEN is_admin=1 OR ? THEN 1 ELSE 0 END,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(email, String(user.name || email || subject), bootstrap.has(email) ? 1 : 0, existing.id).run();
    await ensureDefaultTenantMembership(db, existing.id);
    return { ...existing, email, display_name: String(user.name || email || subject), is_admin: Boolean(existing.is_admin || bootstrap.has(email)) };
  }
  const id = await stableId(`${provider}:${subject}`);
  await db.prepare(`INSERT INTO ${AUTH_USER_TABLE} (id,provider,subject,email,display_name,is_admin) VALUES (?,?,?,?,?,?) ON CONFLICT(provider,subject) DO NOTHING`).bind(id, provider, subject, email, String(user.name || email || subject), bootstrap.has(email) ? 1 : 0).run();
  await ensureDefaultTenantMembership(db, id);
  return await db.prepare(`SELECT * FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(id).first();
}

async function ensureDefaultTenantMembership(db, userId) {
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO auth_tenants (id,name) VALUES (?,?)").bind(DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME),
    db.prepare("INSERT OR IGNORE INTO auth_user_tenants (user_id,tenant_id) VALUES (?,?)").bind(userId, DEFAULT_TENANT_ID)
  ]);
}

export async function listUserTenants(env, userId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT t.id,t.name,t.created_at,t.updated_at FROM auth_tenants t JOIN auth_user_tenants ut ON ut.tenant_id=t.id WHERE ut.user_id=? ORDER BY t.name COLLATE NOCASE`).bind(userId).all();
  return results || [];
}

export async function listTenantSubscriptions(env, tenantId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT s.id,s.name,s.created_at,s.updated_at FROM auth_subscriptions s JOIN auth_tenant_subscriptions ts ON ts.subscription_id=s.id WHERE ts.tenant_id=? ORDER BY s.name COLLATE NOCASE`).bind(tenantId).all();
  return Promise.all((results || []).map(async (subscription) => ({ ...subscription, entitlements: await listSubscriptionEntitlements(env, subscription.id, { who }) })));
}

export async function listSubscriptionEntitlements(env, subscriptionId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare("SELECT entitlement,value_json FROM auth_subscription_entitlements WHERE subscription_id=? ORDER BY entitlement").bind(subscriptionId).all();
  return (results || []).map((row) => ({ entitlement: row.entitlement, value: parseJsonValue(row.value_json) }));
}

export function normalizeSubscriptionManifest(manifest = []) {
  return manifest.map((subscription) => ({
    id: String(subscription?.id || "").trim(),
    name: String(subscription?.name || subscription?.id || "").trim(),
    entitlements: Object.fromEntries(Object.entries(subscription?.entitlements || {}).map(([key, value]) => [String(key), value])),
  })).filter((subscription) => /^[a-z0-9][a-z0-9_-]*$/.test(subscription.id) && subscription.name);
}

export async function ensureSubscriptionManifest(env, manifest = [], { who = "system:update" } = {}) {
  if (!env?.DB) return;
  const db = createD1(env, { who });
  for (const subscription of normalizeSubscriptionManifest(manifest)) {
    await db.prepare("INSERT INTO auth_subscriptions (id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=CURRENT_TIMESTAMP").bind(subscription.id, subscription.name).run();
    for (const [entitlement, value] of Object.entries(subscription.entitlements)) {
      await db.prepare("INSERT INTO auth_subscription_entitlements (subscription_id,entitlement,value_json) VALUES (?,?,?) ON CONFLICT(subscription_id,entitlement) DO UPDATE SET value_json=excluded.value_json,updated_at=CURRENT_TIMESTAMP").bind(subscription.id, entitlement, JSON.stringify(value)).run();
    }
  }
}

export async function hasSubscription(env, tenantId, subscriptionId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  return Boolean(await db.prepare("SELECT 1 FROM auth_tenant_subscriptions WHERE tenant_id=? AND subscription_id=?").bind(tenantId, subscriptionId).first());
}

export async function requireSubscription(env, tenantId, subscriptionId, { who = "system:read" } = {}) {
  if (!await hasSubscription(env, tenantId, subscriptionId, { who })) throw new SubscriptionError("Required subscription is not active for this tenant.");
  return true;
}

export async function hasEntitlement(env, tenantId, entitlement, expectedValue, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const rows = await db.prepare("SELECT e.value_json FROM auth_subscription_entitlements e JOIN auth_tenant_subscriptions ts ON ts.subscription_id=e.subscription_id WHERE ts.tenant_id=? AND e.entitlement=?").bind(tenantId, entitlement).all();
  return (rows.results || []).some((row) => expectedValue === undefined || deepEqual(parseJsonValue(row.value_json), expectedValue));
}

export async function requireEntitlement(env, tenantId, entitlement, expectedValue, { who = "system:read" } = {}) {
  if (!await hasEntitlement(env, tenantId, entitlement, expectedValue, { who })) throw new SubscriptionError(`Required entitlement is not active: ${entitlement}.`);
  return true;
}

export async function createImpersonationToken(env, adminUserId, targetUserId, { ttlSeconds = 900 } = {}) {
  if (!env?.AUTH_SESSION_SECRET) throw new Error("AUTH_SESSION_SECRET is required for impersonation.");
  const payload = { adminUserId: String(adminUserId || "admin"), targetUserId: String(targetUserId), exp: Math.floor(Date.now() / 1000) + Math.min(Math.max(Number(ttlSeconds) || 900, 60), 3600) };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await signValue(encoded, env?.AUTH_SESSION_SECRET || "")}`;
}

export async function verifyImpersonationToken(token, env) {
  if (!env?.AUTH_SESSION_SECRET) return null;
  const [encoded, signature] = String(token || "").split(".");
  if (!encoded || !signature || !constantTimeEqual(signature, await signValue(encoded, env?.AUTH_SESSION_SECRET || ""))) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encoded)));
    return payload.exp > Date.now() / 1000 && payload.targetUserId ? payload : null;
  } catch { return null; }
}

export async function hasScope(env, user, scope, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  if (user?.auth_strategy === "http_basic") return true;
  const authUser = await ensureUser(env, user, { who });
  if (!authUser) return false;
  if (Boolean(authUser.is_admin)) return true;
  return Boolean(await db.prepare(`SELECT 1 FROM ${AUTH_GRANT_TABLE} WHERE user_id=? AND scope_name=?`).bind(authUser.id, scope).first());
}

export async function listAuthorizationUsers(env, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} ORDER BY email COLLATE NOCASE`).all();
  return Promise.all(results.map(async (user) => ({ ...user, scopes: (await listUserGrants(env, user.id, { who })).map((grant) => grant.scope_name) })));
}

export async function getAuthorizationUser(env, userId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  return db.prepare(`SELECT id,email,display_name,provider,subject,is_admin,created_at,updated_at FROM ${AUTH_USER_TABLE} WHERE id=?`).bind(userId).first();
}

export async function listAuthorizationScopes(env, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT name,label,description,system FROM ${AUTH_SCOPE_TABLE} ORDER BY name`).all();
  return results;
}

export async function listGroups(env, { who = "system:read" } = {}) { const db = createD1(env, { who }); const result = await db.prepare("SELECT name,display_name,description,created_at,updated_at FROM auth_groups ORDER BY display_name COLLATE NOCASE").all(); return result.results || []; }

export async function listUserGroups(env, userId, { who = "system:read" } = {}) { const db = createD1(env, { who }); const result = await db.prepare("SELECT group_name,granted_at FROM auth_user_groups WHERE user_id=? ORDER BY group_name").bind(userId).all(); return result.results || []; }

export async function replaceUserGroups(env, userId, groups, grantedBy, { who = "system:read" } = {}) { const db = createD1(env, { who }); await db.batch([db.prepare("DELETE FROM auth_user_groups WHERE user_id=?").bind(userId), ...[...new Set(groups)].map((group) => db.prepare("INSERT INTO auth_user_groups (user_id,group_name,granted_by) VALUES (?,?,?)").bind(userId, group, grantedBy || null))]); return listUserGroups(env, userId, { who }); }

export async function listUserGrants(env, userId, { who = "system:read" } = {}) {
  const db = createD1(env, { who });
  const { results } = await db.prepare(`SELECT scope_name,granted_at FROM ${AUTH_GRANT_TABLE} WHERE user_id=? ORDER BY scope_name`).bind(userId).all();
  return results;
}

export async function replaceUserGrants(env, userId, scopes, grantedBy, { who = "system:read" } = {}) {
  const valid = new Set((await listAuthorizationScopes(env, { who })).map((scope) => scope.name));
  const db = createD1(env, { who });
  const requested = [...new Set(scopes)].filter((scope) => valid.has(scope));
  await db.batch([
    db.prepare(`DELETE FROM ${AUTH_GRANT_TABLE} WHERE user_id=?`).bind(userId),
    ...requested.map((scope) => db.prepare(`INSERT INTO ${AUTH_GRANT_TABLE} (user_id,scope_name,granted_by) VALUES (?,?,?)`).bind(userId, scope, grantedBy || null))
  ]);
  return requested;
}

async function stableId(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function parseJsonValue(value) { try { return JSON.parse(value); } catch { return value; } }
function deepEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
async function signValue(value, secret) { const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)); return base64url(new Uint8Array(signature)); }
function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function base64urlDecode(value) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); }
function constantTimeEqual(left, right) { const a = new TextEncoder().encode(String(left)), b = new TextEncoder().encode(String(right)); let result = a.length ^ b.length; for (let index = 0; index < Math.max(a.length, b.length); index += 1) result |= (a[index] || 0) ^ (b[index] || 0); return result === 0; }
