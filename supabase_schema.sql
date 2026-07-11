-- Mise stock-count app — run this in the Supabase SQL Editor once
-- Run this migration if upgrading: ALTER TABLE containers ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'g';

CREATE TABLE IF NOT EXISTS outlets (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager')),
  name TEXT,
  outlet_id BIGINT REFERENCES outlets(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,
  unit TEXT NOT NULL,
  pack_qty REAL NOT NULL DEFAULT 1,
  price REAL NOT NULL DEFAULT 0,
  barcode TEXT,
  base_unit TEXT NOT NULL,
  cost_per_base REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS containers (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  tare REAL NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'g'
);

CREATE TABLE IF NOT EXISTS recipes (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  yield_qty REAL NOT NULL DEFAULT 0,
  base_unit TEXT NOT NULL DEFAULT 'g',
  cost_per_base REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipe_lines (
  id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS counts (
  id BIGSERIAL PRIMARY KEY,
  outlet_id BIGINT NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed')),
  total_value REAL NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS count_lines (
  id BIGSERIAL PRIMARY KEY,
  count_id BIGINT NOT NULL REFERENCES counts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ref_name TEXT NOT NULL,
  container_name TEXT,
  container_tare REAL DEFAULT 0,
  measured REAL,
  qty REAL NOT NULL DEFAULT 0,
  unit TEXT,
  unit_cost REAL NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  in_qty REAL,
  in_unit TEXT
);
