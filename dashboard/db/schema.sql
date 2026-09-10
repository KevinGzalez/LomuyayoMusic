CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(40) NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','OPERATOR','VIEWER')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  created_by UUID REFERENCES dashboard_users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_users_username_ci ON dashboard_users (LOWER(username));

CREATE TABLE IF NOT EXISTS dashboard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES dashboard_users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash CHAR(64),
  user_agent VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS dashboard_sessions_user ON dashboard_sessions(user_id);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry ON dashboard_sessions(expires_at);

CREATE TABLE IF NOT EXISTS dashboard_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES dashboard_users(id) ON DELETE SET NULL,
  username VARCHAR(40),
  action VARCHAR(60) NOT NULL,
  success BOOLEAN NOT NULL,
  ip_hash CHAR(64),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS dashboard_audit_created ON dashboard_audit_log(created_at DESC);

