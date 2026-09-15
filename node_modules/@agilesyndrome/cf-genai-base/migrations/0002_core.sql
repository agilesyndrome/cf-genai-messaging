CREATE TABLE IF NOT EXISTS core_healthchecks (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  component TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'yellow' CHECK (state IN ('red', 'yellow', 'green')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(feature, component)
);

CREATE INDEX IF NOT EXISTS core_healthchecks_state_idx ON core_healthchecks(state);

CREATE TABLE IF NOT EXISTS core_circuit_breakers (
  id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'off' CHECK (state IN ('off', 'tripped', 'on')),
  healthcheck_mode TEXT NOT NULL DEFAULT 'any' CHECK (healthcheck_mode IN ('any', 'all')),
  allow_self_healing INTEGER NOT NULL DEFAULT 0 CHECK (allow_self_healing IN (0, 1)),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(feature, name)
);

CREATE TABLE IF NOT EXISTS core_circuit_breaker_healthchecks (
  circuit_breaker_id TEXT NOT NULL REFERENCES core_circuit_breakers(id) ON DELETE CASCADE,
  healthcheck_id TEXT NOT NULL REFERENCES core_healthchecks(id) ON DELETE CASCADE,
  PRIMARY KEY(circuit_breaker_id, healthcheck_id)
);

CREATE INDEX IF NOT EXISTS core_circuit_breaker_healthchecks_healthcheck_idx
  ON core_circuit_breaker_healthchecks(healthcheck_id);

CREATE TABLE IF NOT EXISTS core_circuit_breaker_dependencies (
  circuit_breaker_id TEXT NOT NULL REFERENCES core_circuit_breakers(id) ON DELETE CASCADE,
  dependency_id TEXT NOT NULL REFERENCES core_circuit_breakers(id) ON DELETE CASCADE,
  PRIMARY KEY(circuit_breaker_id, dependency_id)
);

CREATE INDEX IF NOT EXISTS core_circuit_breaker_dependencies_dependency_idx
  ON core_circuit_breaker_dependencies(dependency_id);