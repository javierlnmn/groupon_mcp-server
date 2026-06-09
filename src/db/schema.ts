/**
 * SQLite schema for the data layer DB.
 */
export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  region TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS merchants (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  location_id INTEGER NOT NULL REFERENCES locations(id)
);

CREATE TABLE IF NOT EXISTS deals (
  id          INTEGER PRIMARY KEY,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  merchant_id INTEGER NOT NULL REFERENCES merchants(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  fine_print  TEXT,
  valid_until TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS deal_options (
  id             INTEGER PRIMARY KEY,
  deal_id        INTEGER NOT NULL REFERENCES deals(id),
  title          TEXT    NOT NULL,
  price          REAL    NOT NULL CHECK (price >= 0),
  original_price REAL    NOT NULL CHECK (original_price >= price),
  discount_pct   INTEGER GENERATED ALWAYS AS
                   (CAST(ROUND((original_price - price) * 100.0 / original_price) AS INTEGER)) STORED
);

CREATE TABLE IF NOT EXISTS deal_reviews (
  id         INTEGER PRIMARY KEY,
  deal_id    INTEGER NOT NULL REFERENCES deals(id),
  user_id    INTEGER NOT NULL REFERENCES users(id),
  rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deals_category    ON deals(category_id);
CREATE INDEX IF NOT EXISTS idx_deals_location    ON deals(location_id);
CREATE INDEX IF NOT EXISTS idx_options_deal      ON deal_options(deal_id);
CREATE INDEX IF NOT EXISTS idx_options_discount  ON deal_options(discount_pct);
CREATE INDEX IF NOT EXISTS idx_deal_reviews_deal ON deal_reviews(deal_id);

CREATE VIRTUAL TABLE IF NOT EXISTS deals_fts USING fts5(
  title,
  description,
  content='deals',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
`;

/**
 * Table row shapes. Persistence source of truth.
 */

export interface UserRow {
  id: number;
  name: string;
}

export interface CategoryRow {
  id: number;
  slug: string;
  name: string;
}

export interface LocationRow {
  id: number;
  slug: string;
  name: string;
  region: string;
}

export interface MerchantRow {
  id: number;
  name: string;
  location_id: number;
}

export interface DealRow {
  id: number;
  title: string;
  description: string;
  category_id: number;
  merchant_id: number;
  location_id: number;
  fine_print: string | null;
  valid_until: string | null;
  is_active: boolean;
}

export interface DealOptionRow {
  id: number;
  deal_id: number;
  title: string;
  price: number;
  original_price: number;
  discount_pct: number;
}

export interface DealReviewRow {
  id: number;
  deal_id: number;
  user_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}
