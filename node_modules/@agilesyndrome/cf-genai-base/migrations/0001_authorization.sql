CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, subject)
);

CREATE INDEX IF NOT EXISTS auth_users_email_idx ON auth_users(email COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS auth_scopes (
  name TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_user_scopes (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  scope_name TEXT NOT NULL REFERENCES auth_scopes(name) ON DELETE CASCADE,
  granted_by TEXT,
  granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, scope_name)
);

CREATE INDEX IF NOT EXISTS auth_user_scopes_scope_idx ON auth_user_scopes(scope_name);
