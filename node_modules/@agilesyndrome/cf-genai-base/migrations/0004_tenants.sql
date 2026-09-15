CREATE TABLE IF NOT EXISTS auth_tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_tenant_subscriptions (
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES auth_subscriptions(id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, subscription_id)
);

CREATE INDEX IF NOT EXISTS auth_tenant_subscriptions_subscription_idx
  ON auth_tenant_subscriptions(subscription_id);

CREATE TABLE IF NOT EXISTS auth_user_tenants (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES auth_tenants(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS auth_user_tenants_tenant_idx
  ON auth_user_tenants(tenant_id);

INSERT OR IGNORE INTO auth_tenants (id, name)
VALUES ('easley-family', 'Easley Family');

INSERT OR IGNORE INTO auth_user_tenants (user_id, tenant_id)
SELECT id, 'easley-family' FROM auth_users;
