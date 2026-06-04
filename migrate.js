require('dotenv').config();
const { pool } = require('./index');

const migrations = `
  -- Enable UUID extension
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  -- ── Restaurants ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS restaurants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(200) NOT NULL,
    slug            VARCHAR(200) UNIQUE NOT NULL,       -- used in QR URL: /menu/kabab-souq
    description     TEXT,
    cuisine_type    VARCHAR(100),
    address         TEXT,
    city            VARCHAR(100),
    phone           VARCHAR(30),
    email           VARCHAR(200) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,              -- restaurant owner login
    logo_url        TEXT,
    cover_image_url TEXT,
    google_place_id VARCHAR(200),                       -- for Google Reviews sync
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── Menu categories ──────────────────────────────────
  CREATE TABLE IF NOT EXISTS categories (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    name          VARCHAR(100) NOT NULL,
    sort_order    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── Menu items ───────────────────────────────────────
  CREATE TABLE IF NOT EXISTS menu_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    category_id     UUID REFERENCES categories(id) ON DELETE SET NULL,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    price           NUMERIC(10,2) NOT NULL,
    image_url       TEXT,
    is_vegetarian   BOOLEAN DEFAULT false,
    is_vegan        BOOLEAN DEFAULT false,
    is_gluten_free  BOOLEAN DEFAULT false,
    spice_level     SMALLINT DEFAULT 0 CHECK (spice_level BETWEEN 0 AND 5),
    calories        INTEGER,
    allergens       TEXT[],                             -- e.g. ARRAY['nuts','dairy']
    tags            TEXT[],                             -- e.g. ARRAY['bestseller','new']
    is_available    BOOLEAN DEFAULT true,
    sort_order      INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── QR codes ─────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS qr_codes (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    label         VARCHAR(100),                         -- e.g. "Table 4", "Counter"
    qr_image_url  TEXT,                                 -- stored PNG/SVG
    scan_count    INTEGER DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── QR scan analytics ────────────────────────────────
  CREATE TABLE IF NOT EXISTS scan_events (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    qr_code_id    UUID REFERENCES qr_codes(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_agent    TEXT,
    ip_address    INET,
    scanned_at    TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── Google reviews cache ─────────────────────────────
  CREATE TABLE IF NOT EXISTS google_reviews_cache (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    place_id        VARCHAR(200) NOT NULL,
    overall_rating  NUMERIC(2,1),
    total_reviews   INTEGER,
    reviews_json    JSONB,                              -- full reviews array from Google
    cached_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(restaurant_id)
  );

  -- ── AI recommendation logs ───────────────────────────
  CREATE TABLE IF NOT EXISTS ai_recommendations (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id   UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    user_prefs      JSONB NOT NULL,                     -- what user selected in quiz
    recommendations JSONB NOT NULL,                     -- Gemini response
    created_at      TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── Indexes for performance ──────────────────────────
  CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant ON menu_items(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_menu_items_category   ON menu_items(category_id);
  CREATE INDEX IF NOT EXISTS idx_categories_restaurant ON categories(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_scan_events_restaurant ON scan_events(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_scan_events_time      ON scan_events(scanned_at);
  CREATE INDEX IF NOT EXISTS idx_qr_codes_restaurant   ON qr_codes(restaurant_id);

  -- ── Auto-update updated_at ────────────────────────────
  CREATE OR REPLACE FUNCTION update_updated_at_column()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS update_restaurants_updated_at ON restaurants;
  CREATE TRIGGER update_restaurants_updated_at
    BEFORE UPDATE ON restaurants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

  DROP TRIGGER IF EXISTS update_menu_items_updated_at ON menu_items;
  CREATE TRIGGER update_menu_items_updated_at
    BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🗄️  Running database migrations...');
    await client.query(migrations);
    console.log('✅  Migrations complete.');
  } catch (err) {
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
