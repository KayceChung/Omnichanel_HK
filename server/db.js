require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platforms (
      id           SERIAL PRIMARY KEY,
      name         VARCHAR(50)  NOT NULL UNIQUE,
      display_name VARCHAR(100) NOT NULL,
      created_at   TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id          SERIAL PRIMARY KEY,
      title       VARCHAR(500) NOT NULL,
      description TEXT,
      base_price  NUMERIC(10,2),
      currency    VARCHAR(10)  DEFAULT 'USD',
      status      VARCHAR(50)  DEFAULT 'draft',
      created_at  TIMESTAMPTZ  DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS platform_listings (
      id            SERIAL PRIMARY KEY,
      product_id    INTEGER REFERENCES products(id)  ON DELETE CASCADE,
      platform_id   INTEGER REFERENCES platforms(id),
      external_id   VARCHAR(255),
      status        VARCHAR(50) DEFAULT 'pending',
      platform_data JSONB,
      last_synced_at TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(product_id, platform_id)
    );

    CREATE TABLE IF NOT EXISTS klook_activities (
      id          SERIAL PRIMARY KEY,
      activity_id VARCHAR(50)  NOT NULL UNIQUE,
      name        VARCHAR(255),
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           SERIAL PRIMARY KEY,
      type         VARCHAR(100) NOT NULL,
      platform_id  INTEGER REFERENCES platforms(id),
      product_id   INTEGER REFERENCES products(id),
      listing_id   INTEGER REFERENCES platform_listings(id),
      payload      JSONB,
      status       VARCHAR(50) DEFAULT 'pending',
      result       JSONB,
      error        TEXT,
      claimed_at   TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO platforms (name, display_name) VALUES
      ('klook',   'Klook'),
      ('12go',    '12Go Asia'),
      ('tripcom', 'Trip.com'),
      ('seatos',  'SeatOS (12Go)')
    ON CONFLICT (name) DO NOTHING;
  `);
}

module.exports = { pool, init };
