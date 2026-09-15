/**
 * Lean, opinionated Worker composition for Cloudflare sites.
 * Site code owns domain routes and data; this owns lifecycle and edge concerns.
 */
import { createImpersonationToken, ensureScopes, ensureSubscriptionManifest, ensureUser, getAuthorizationUser, hasScope, listAuthorizationScopes, listAuthorizationUsers, listGroups, listTenantSubscriptions, listUserGroups, listUserGrants, replaceUserGroups, replaceUserGrants, SubscriptionError } from "./authorization.js";
import { getCircuitBreaker, evaluateCircuitBreaker, listCircuitBreakers, listHealthchecks, listFeatureCatalog, listFeatureHealth, registerFeatureManifests, requestActor, setCircuitBreaker, updateHealthcheck } from "./core.js";
import { createDataReader, DataScopeError, normalizeDataResources, requestDataContext } from "./data.js";
export * from "./core.js";
export * from "./data.js";
export * from "./authorization.js";
export function createWorker({ fetch, scheduled, auth, authorize, scopes = [], subscriptionManifest = [], scopeRoutes = [], middleware = [], features = [], dataResources = [], publicTenantId = null, health, boot, metrics, security = true, adminPage, siteAdminPage }) {
  if (typeof fetch !== "function") throw new TypeError("createWorker requires a fetch handler");
  const provider = auth || features.find((feature) => typeof feature?.getUser === "function");
  const registeredDataResources = normalizeDataResources([...dataResources, ...features.flatMap((feature) => Array.isArray(feature?.dataResources) ? feature.dataResources : [])]);
  const chain = [
            (request, env, ctx, next, state) => adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes, features, adminPage, siteAdminPage }),
    ...features.flatMap((feature) => feature?.middleware ? [feature.middleware.bind(feature)] : []),
    ...middleware,
    ...(auth ? [(request, env, ctx, next) => auth(request, env, ctx, next)] : []),
  ].filter(Boolean);
  return {
    async fetch(request, env, ctx) {
      try {
        if (boot) await boot(env, { request, ctx });
        if (subscriptionManifest.length) await ensureSubscriptionManifest(env, subscriptionManifest, { who: "system:update" });
        const url = new URL(request.url);
        const state = Object.create(null);
        if (provider?.getUser) state.user = await provider.getUser(request, env).catch(() => null);
        state.data = createDataReader(env, { resources: registeredDataResources, context: () => requestDataContext(env, { state, request, publicTenantId }) });
        if (env?.DB && features.some((feature) => typeof feature?.healthcheck === "function" || feature?.healthchecks?.length || feature?.healthChecks?.length || feature?.circuitBreakers?.length || feature?.circuit_breakers?.length)) ctx?.waitUntil?.(registerFeatureManifests(env, features, { who: "system:update" }).then(() => listCircuitBreakers(env, { who: "system:update" }).then((breakers) => Promise.all(breakers.filter(Boolean).map((breaker) => evaluateCircuitBreaker(env, breaker.id, { who: "system:update" }))))).catch((error) => console.error("[EventLog] feature manifest registration failed", error)));
        const dispatch = async (index, currentRequest = request) => {
          const layer = chain[index];
          if (!layer) {
            if (url.pathname === "/health" || url.pathname === "/api/health") {
              const details = health ? await health(env, { request: currentRequest, ctx, state }) : {};
              const featureHealth = env?.DB ? await listFeatureHealth(env, { who: "system:read" }).catch(() => []) : [];
              return healthResponse(env, featureHealth.length ? { ...details, features: featureHealth } : details);
            }
            if (url.pathname === "/api/tenant" && currentRequest.method === "GET") {
              const context = await state.data.context();
              if (!context.userId) return Response.json({ error: "Authentication is required." }, { status: 401 });
              if (context.invalidTenant) return Response.json({ error: "The requested tenant is not available." }, { status: 400 });
              return Response.json({ tenant: context.tenantId ? { id: context.tenantId, name: context.tenants?.find((tenant) => tenant.id === context.tenantId)?.name || null } : null, tenants: context.tenants || [] });
            }
            return fetch(currentRequest, env, ctx, state);
          }
          if (typeof layer !== "function") throw new TypeError("Worker middleware must be a function");
          return layer(currentRequest, env, ctx, (nextRequest = currentRequest) => dispatch(index + 1, nextRequest), state);
        };
        const response = await dispatch(0);
        if (metrics) metrics.request(request, response, env, ctx);
        return security ? secureResponse(response) : response;
      } catch (error) {
        console.error("[worker] request failed", error);
        if (error instanceof DataScopeError || error instanceof SubscriptionError) return secureResponse(Response.json({ error: error.message }, { status: 403, headers: { "Cache-Control": "no-store" } }));
        return secureResponse(Response.json({ error: "Internal server error" }, { status: 500, headers: { "Cache-Control": "no-store" } }));
      }
    },
    ...(scheduled ? { scheduled } : {}),
  };
}


async function adminBoundary(request, env, ctx, next, state, { provider, authorize, scopes, scopeRoutes, features, adminPage, siteAdminPage }) {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return next(request);
  const strategy = String(env?.AUTH_STRATEGY || "http_basic").trim().toLowerCase();
  if (strategy === "http_basic") {
    const user = basicUser(request, env);
    if (!user) return adminUnauthorized(request);
    state.user = user;
  } else if (strategy === "oauth") {
    const user = provider?.getUser ? await provider.getUser(request, env) : null;
    if (!user) return oauthUnauthorized(request, url);
    state.user = user;
  } else {
    return new Response("Unsupported AUTH_STRATEGY", { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  await ensureScopes(env, scopes, { who: state.user?.auth_strategy === "http_basic" ? "user:admin" : `user:${state.user?.sub || "unknown"}` });
  state.authUser = await ensureUser(env, state.user, { who: state.user?.auth_strategy === "http_basic" ? "user:admin" : `user:${state.user?.sub || "unknown"}` });
  state.requestedBy = requestActor(state);
  const requiredScope = requiredScopeFor(url.pathname, scopeRoutes);
  const scopeAllowed = !requiredScope || await hasScope(env, state.user, requiredScope, { who: requestActor(state) });
  if (!scopeAllowed || (authorize && state.user.auth_strategy !== "http_basic" && !(await authorize({ request, url, user: state.user, env, ctx, state })))) {
    return url.pathname.startsWith("/api/") ? Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } }) : new Response("Administrator access is required.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const platformResponse = await authorizationApi(request, env, url, state, features);
  if (platformResponse) return platformResponse;
  if (request.method === "GET" && isSiteAdminPage(url.pathname) && typeof siteAdminPage === "function") {
    const response = await siteAdminPage({ request, env, url, state, features });
    if (response) return response;
  }
  if (request.method === "GET" && isPlatformAdminPage(url.pathname) && typeof adminPage === "function") {
    if (!(state.user.auth_strategy === "http_basic" || (state.authUser && state.authUser.is_admin))) return new Response("Administrator access is required.", { status: 403, headers: { "Cache-Control": "no-store" } });
    const response = await adminPage({ request, env, url, state, features });
    if (response) return response;
  }
  if (url.pathname === "/admin/features" && request.method === "GET") {
    if (!(state.user.auth_strategy === "http_basic" || (state.authUser && state.authUser.is_admin))) return new Response("Administrator access is required.", { status: 403, headers: { "Cache-Control": "no-store" } });
    return featureCatalogPage(env, features, state);
  }
  return next(request);
}

function isPlatformAdminPage(pathname) {
  return ["/admin/users", "/admin/scopes", "/admin/groups", "/admin/features", "/admin/healthchecks", "/admin/circuit-breakers"].includes(pathname);
}

function isSiteAdminPage(pathname) {
  return pathname === "/admin/site" || pathname.startsWith("/admin/site/");
}

function requiredScopeFor(pathname, routes) {
  const route = routes.find((entry) => typeof entry.match === "function" ? entry.match(pathname) : pathname === entry.path || pathname.startsWith(String(entry.path || "") + "/"));
  return route && route.scope ? route.scope : null;
}

async function authorizationApi(request, env, url, state, features = []) {
  const grantsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/scopes$/);
  const platformPath = url.pathname === "/api/admin/users" || url.pathname === "/api/admin/scopes" || url.pathname === "/api/admin/groups" || url.pathname.startsWith("/api/admin/users/") || url.pathname.startsWith("/api/admin/impersonate") || url.pathname === "/api/admin/status" || url.pathname === "/api/admin/features" || url.pathname === "/api/admin/healthchecks" || url.pathname === "/api/admin/circuit-breakers" || url.pathname.startsWith("/api/admin/healthchecks/") || url.pathname.startsWith("/api/admin/circuit-breakers/") || Boolean(grantsMatch);
  if (!platformPath) return null;
  if (!(state.user.auth_strategy === "http_basic" || (state.authUser && state.authUser.is_admin))) return Response.json({ error: "Administrator access is required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (url.pathname === "/api/admin/impersonate/clear" && request.method === "POST") return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json; charset=utf-8", "Set-Cookie": "__Host-cfgenai_impersonation=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax" } });
  if (url.pathname === "/api/admin/users" && request.method === "GET") return Response.json({ users: await listAuthorizationUsers(env, { who: requestActor(state) }) });
  const impersonateMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/impersonate$/);
  if (impersonateMatch && request.method === "POST") {
    const target = decodeURIComponent(impersonateMatch[1]);
    const targetUser = await getAuthorizationUser(env, target, { who: requestActor(state) });
    if (!targetUser) return Response.json({ error: "User not found." }, { status: 404 });
    const token = await createImpersonationToken(env, state.authUser?.id || state.user?.sub || "admin", targetUser.id);
    return new Response(JSON.stringify({ ok: true, user: { id: targetUser.id, email: targetUser.email, display_name: targetUser.display_name }, expires_in: 900 }), { headers: { "content-type": "application/json; charset=utf-8", "Set-Cookie": `__Host-cfgenai_impersonation=${token}; Max-Age=900; Path=/; Secure; HttpOnly; SameSite=Lax` } });
  }
  if (url.pathname === "/api/admin/scopes" && request.method === "GET") return Response.json({ scopes: await listAuthorizationScopes(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/status" && request.method === "GET") return Response.json({ features: await listFeatureHealth(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/features" && request.method === "GET") return Response.json({ features: await listFeatureCatalog(env, features, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/groups" && request.method === "GET") return Response.json({ groups: await listGroups(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/healthchecks" && request.method === "GET") return Response.json({ healthchecks: await listHealthchecks(env, { who: requestActor(state) }) });
  if (url.pathname === "/api/admin/circuit-breakers" && request.method === "GET") return Response.json({ circuit_breakers: await listCircuitBreakers(env, { who: requestActor(state) }) });
  const healthcheckMatch = url.pathname.match(/\/api\/admin\/healthchecks\/([^/]+)$/);
  if (healthcheckMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const healthcheck = await updateHealthcheck(env, decodeURIComponent(healthcheckMatch[1]), body.state, { who: requestActor(state) }); return healthcheck ? Response.json({ healthcheck }) : Response.json({ error: "Healthcheck not found" }, { status: 404 }); }
  const breakerMatch = url.pathname.match(/\/api\/admin\/circuit-breakers\/([^/]+)$/);
  if (breakerMatch && request.method === "GET") return Response.json({ circuit_breaker: await getCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), { who: requestActor(state) }) });
  if (breakerMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body?.state) return Response.json({ error: "state is required" }, { status: 400 }); const breaker = await setCircuitBreaker(env, decodeURIComponent(breakerMatch[1]), body.state, { who: requestActor(state) }); return breaker ? Response.json({ circuit_breaker: breaker }) : Response.json({ error: "Circuit breaker not found" }, { status: 404 }); }
  const groupsMatch = url.pathname.match(/\/api\/admin\/users\/([^/]+)\/groups$/);
  if (groupsMatch && request.method === "GET") return Response.json({ groups: await listUserGroups(env, decodeURIComponent(groupsMatch[1]), { who: requestActor(state) }) });
  if (groupsMatch && request.method === "PUT") { const body = await request.json().catch(() => null); if (!body || !Array.isArray(body.groups)) return Response.json({ error: "groups must be an array" }, { status: 400 }); return Response.json({ groups: await replaceUserGroups(env, decodeURIComponent(groupsMatch[1]), body.groups, state.authUser && state.authUser.id, { who: requestActor(state) }) }); }
  if (grantsMatch && request.method === "GET") return Response.json({ grants: await listUserGrants(env, decodeURIComponent(grantsMatch[1]), { who: requestActor(state) }) });
  if (grantsMatch && request.method === "PUT") {
    const body = await request.json().catch(() => null);
    if (!body || !Array.isArray(body.scopes)) return Response.json({ error: "scopes must be an array" }, { status: 400 });
    const grants = await replaceUserGrants(env, decodeURIComponent(grantsMatch[1]), body.scopes, state.authUser && state.authUser.id, { who: requestActor(state) });
    return Response.json({ grants });
  }
  return null;
}

function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function basicUser(request, env) {
  const token = String(env?.ADMIN_TOKEN || env?.admin_token || "");
  if (!token) return null;
  const header = request.headers.get("Authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  let decoded;
  try { decoded = atob(header.slice(6).trim()); } catch { return null; }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  if (!constantTimeEqual(decoded.slice(0, separator), "admin") || !constantTimeEqual(decoded.slice(separator + 1), token)) return null;
  return { sub: "basic:admin", email: "", name: "admin", roles: ["admin"], auth_strategy: "http_basic" };
}

function adminUnauthorized(request) {
  const headers = { "Cache-Control": "no-store", "WWW-Authenticate": "Basic realm=\"admin\", charset=\"UTF-8\"" };
  return new URL(request.url).pathname.startsWith("/api/") ? Response.json({ error: "Authentication is required." }, { status: 401, headers }) : new Response("Authentication is required.", { status: 401, headers });
}

function oauthUnauthorized(request, url) {
  if (url.pathname.startsWith("/api/")) return Response.json({ error: "Authentication is required." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return Response.redirect(url.origin + "/auth/login?return_to=" + encodeURIComponent(safeReturnTo(url.pathname + url.search)), 302);
}

function safeReturnTo(value) { return value?.startsWith("/") && !value.startsWith("//") && !value.startsWith("/auth/") ? value : "/"; }
function constantTimeEqual(a, b) { const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b); let n = aa.length ^ bb.length; for (let i = 0; i < Math.max(aa.length, bb.length); i++) n |= (aa[i] || 0) ^ (bb[i] || 0); return n === 0; }

export function validateBoot(env, { bindings = [], required = [] } = {}) {
  const missingBindings = bindings.filter((name) => !env?.[name]);
  const missingValues = required.filter((name) => !env?.[name] || String(env[name]).startsWith("replace-with-"));
  return { ok: missingBindings.length === 0 && missingValues.length === 0, missingBindings, missingValues };
}

export function assertBoot(env, spec = {}) {
  const result = validateBoot(env, spec);
  if (!result.ok) throw new Error(`Worker boot validation failed: ${[...result.missingBindings, ...result.missingValues].join(", ")}`);
  return result;
}

export function secureResponse(response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function methodNotAllowed(allow = "GET") {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: allow } });
}

export function healthResponse(env, details = {}) {
  return Response.json({ ok: true, version: String(env.BUILD_SHA || "unknown").slice(0, 7), build_number: env.BUILD_NUMBER ? String(env.BUILD_NUMBER) : null, ...details }, { headers: { "Cache-Control": "no-store" } });
}

export function createMetrics({ tokenEnv = "POSTHOG_TOKEN", host = "https://us.i.posthog.com" } = {}) {
  return {
    request(request, response, env, ctx) {
      if (!env?.[tokenEnv] || !ctx?.waitUntil || new URL(request.url).pathname === "/health") return;
      const event = response.status >= 500 ? "server_error" : "request";
      ctx.waitUntil(track(env, event, { path: new URL(request.url).pathname, method: request.method, status: response.status }, { tokenEnv, host }));
    },
    track: (env, event, properties, ctx) => ctx?.waitUntil?.(track(env, event, properties, { tokenEnv, host })),
  };
}

async function track(env, event, properties, { tokenEnv, host }) {
  try {
    const token = String(env?.[tokenEnv] || "");
    if (!token) return;
    await fetch(`${host.replace(/\/+$/, "")}/capture/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ api_key: token, event, properties: { ...properties, distinct_id: properties?.distinct_id || "anonymous" } }) });
  } catch (error) {
    console.error("[metrics] delivery failed", error);
  }
}


async function featureCatalogPage(env, features, state) {
  const catalog = await listFeatureCatalog(env, features, { who: requestActor(state) });
  return new Response(featureCatalogMarkup(catalog), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function featureCatalogMarkup(catalog) {
  const rows = catalog.map((item) => {
    const checks = item.healthchecks.length ? "<ul>" + item.healthchecks.map((check) => "<li><strong>" + escapeHtml(check.display_name) + "</strong>: " + escapeHtml(check.state) + "</li>").join("") + "</ul>" : "<span>None registered</span>";
    const breakers = item.circuit_breakers.length ? "<ul>" + item.circuit_breakers.map((breaker) => "<li><strong>" + escapeHtml(breaker.display_name) + "</strong>: " + escapeHtml(breaker.state) + "</li>").join("") + "</ul>" : "<span>None registered</span>";
    const packageLabel = item.package_name ? escapeHtml(item.package_name) : "Unknown package";
    const versionLabel = item.version ? escapeHtml(item.version) : "Unknown version";
    return "<tr><td><strong>" + escapeHtml(item.display_name) + "</strong><br><code>" + escapeHtml(item.feature) + "</code></td><td>" + packageLabel + "<br>" + versionLabel + "</td><td><span class=\"state state-" + escapeHtml(item.health) + "\">" + escapeHtml(item.health) + "</span></td><td>" + (item.circuit_breaker ? escapeHtml(item.circuit_breaker.state) : "None") + "</td><td>" + checks + "</td><td>" + breakers + "</td></tr>";
  }).join("");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Features</title><style>body{font:15px/1.45 system-ui,sans-serif;color:#20231f;background:#f7f7f5;margin:0;padding:2rem}main{max-width:1200px;margin:auto;background:#fff;padding:1.5rem;border:1px solid #d8ddd5;border-radius:.6rem}nav{display:flex;gap:1rem;margin-bottom:1.5rem}a{color:#2f6f52}table{width:100%;border-collapse:collapse}th,td{padding:.7rem;border-bottom:1px solid #d8ddd5;text-align:left;vertical-align:top}th{font-size:.8rem;color:#687067;text-transform:uppercase}ul{margin:.25rem 0;padding-left:1.2rem}code{color:#687067}.state{font-weight:700}.state-green{color:#26734d}.state-yellow{color:#9a6b00}.state-red{color:#b3261e}</style></head><body><main><nav><a href=\"/admin\">Admin</a><a href=\"/admin/features\" aria-current=\"page\">Features</a><a href=\"/admin/users\">Users</a><a href=\"/admin/groups\">Groups</a></nav><h1>Installed features</h1><p>Runtime modules, package versions, healthchecks, and circuit breakers.</p><table><thead><tr><th>Feature</th><th>Package/version</th><th>Health</th><th>Roll-up breaker</th><th>Healthchecks</th><th>Circuit breakers</th></tr></thead><tbody>" + rows + "</tbody></table></main></body></html>";
}

function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll(String.fromCharCode(39), "&#39;"); }
