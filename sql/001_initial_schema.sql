-- ============================================================
-- BizControl – Raw SQL Schema (PostgreSQL)
-- ============================================================

-- extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- studios
CREATE TABLE studios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  domain TEXT NULL UNIQUE,
  logo_url TEXT NULL,
  primary_color TEXT NULL,
  subscription_plan TEXT NOT NULL DEFAULT 'free',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  studio_id UUID NOT NULL REFERENCES studios(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','artist','staff')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (studio_id, email)
);

-- studio_settings
CREATE TABLE studio_settings (
  studio_id UUID PRIMARY KEY REFERENCES studios(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
  currency TEXT NOT NULL DEFAULT 'ILS',
  language TEXT NOT NULL DEFAULT 'he',
  default_deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- useful indexes
CREATE INDEX idx_users_studio_id ON users(studio_id);
CREATE INDEX idx_users_email ON users(email);
