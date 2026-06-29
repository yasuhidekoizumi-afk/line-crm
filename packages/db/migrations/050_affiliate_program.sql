-- ============================================================
-- 050_affiliate_program.sql
-- ORYZAE 自社アフィリエイト成果報酬基盤
--
-- 既存 affiliates / affiliate_clicks は「LINE友だち追加の流入経路」用。
-- 本制度は Shopify 注文成果・現金報酬用なので affiliate_program_* 名前空間で分離する。
-- Pay Forward (?ref / ポイント) とは別制度。競合時は Affiliate (?aff / 現金) を優先する。
-- ============================================================

CREATE TABLE IF NOT EXISTS affiliate_program_partners (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  code              TEXT NOT NULL UNIQUE,
  email             TEXT,
  partner_type      TEXT NOT NULL DEFAULT 'standard' CHECK (partner_type IN ('standard', 'special', 'fixed')),
  commission_type   TEXT NOT NULL DEFAULT 'percentage' CHECK (commission_type IN ('percentage', 'fixed')),
  commission_rate   REAL NOT NULL DEFAULT 0.10,
  fixed_amount      INTEGER,
  cookie_days       INTEGER NOT NULL DEFAULT 30,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_program_partners_code ON affiliate_program_partners(code);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_partners_status ON affiliate_program_partners(status);

CREATE TABLE IF NOT EXISTS affiliate_program_orders (
  id                   TEXT PRIMARY KEY,
  partner_id           TEXT NOT NULL REFERENCES affiliate_program_partners(id) ON DELETE RESTRICT,
  affiliate_code       TEXT NOT NULL,
  shopify_order_id     TEXT NOT NULL UNIQUE,
  shopify_order_number TEXT,
  shopify_customer_id  TEXT,
  customer_email       TEXT,
  subtotal_price       REAL NOT NULL DEFAULT 0,
  total_price          REAL NOT NULL DEFAULT 0,
  currency             TEXT NOT NULL DEFAULT 'JPY',
  financial_status     TEXT,
  cancelled_at         TEXT,
  ordered_at           TEXT NOT NULL,
  attribution_source   TEXT NOT NULL DEFAULT 'cart_attribute' CHECK (attribution_source IN ('cart_attribute', 'note_attribute', 'manual', 'backfill')),
  raw_affiliate_value  TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_program_orders_partner ON affiliate_program_orders(partner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_orders_code ON affiliate_program_orders(affiliate_code);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_orders_ordered ON affiliate_program_orders(ordered_at);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_orders_status ON affiliate_program_orders(financial_status, cancelled_at);

CREATE TABLE IF NOT EXISTS affiliate_program_commissions (
  id                   TEXT PRIMARY KEY,
  affiliate_order_id   TEXT NOT NULL UNIQUE REFERENCES affiliate_program_orders(id) ON DELETE CASCADE,
  partner_id           TEXT NOT NULL REFERENCES affiliate_program_partners(id) ON DELETE RESTRICT,
  basis_amount         REAL NOT NULL DEFAULT 0,
  commission_type      TEXT NOT NULL CHECK (commission_type IN ('percentage', 'fixed')),
  commission_rate      REAL,
  fixed_amount         INTEGER,
  commission_amount    INTEGER NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
  approved_at          TEXT,
  rejected_at          TEXT,
  paid_at              TEXT,
  payout_id            TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_program_commissions_partner ON affiliate_program_commissions(partner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_commissions_status ON affiliate_program_commissions(status);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_commissions_payout ON affiliate_program_commissions(payout_id);

CREATE TABLE IF NOT EXISTS affiliate_program_payouts (
  id                TEXT PRIMARY KEY,
  partner_id        TEXT NOT NULL REFERENCES affiliate_program_partners(id) ON DELETE RESTRICT,
  period_start      TEXT NOT NULL,
  period_end        TEXT NOT NULL,
  total_amount      INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'paid')),
  paid_at           TEXT,
  memo              TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_affiliate_program_payouts_partner ON affiliate_program_payouts(partner_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_payouts_period ON affiliate_program_payouts(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_affiliate_program_payouts_status ON affiliate_program_payouts(status);
