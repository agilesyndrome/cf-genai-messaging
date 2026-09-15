-- Application-defined subscription capabilities. Base stores the contract;
-- applications decide which subscriptions and entitlement keys they expose.
CREATE TABLE IF NOT EXISTS auth_subscription_entitlements (
  subscription_id TEXT NOT NULL REFERENCES auth_subscriptions(id) ON DELETE CASCADE,
  entitlement TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT 'true',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subscription_id, entitlement)
);

CREATE INDEX IF NOT EXISTS auth_subscription_entitlements_key_idx
  ON auth_subscription_entitlements(entitlement);
