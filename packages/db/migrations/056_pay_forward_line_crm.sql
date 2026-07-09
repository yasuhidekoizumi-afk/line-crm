-- 056: Pay Forward を現行 line-crm ポイント台帳へ統合

CREATE TABLE IF NOT EXISTS pay_forward_codes (
  code                TEXT PRIMARY KEY,
  referrer_customer_id TEXT NOT NULL UNIQUE,
  is_active          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS pay_forward_referrals (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL REFERENCES pay_forward_codes(code),
  referrer_customer_id TEXT NOT NULL,
  referred_customer_id TEXT NOT NULL UNIQUE,
  status               TEXT NOT NULL DEFAULT 'claimed'
                         CHECK (status IN ('claimed', 'reward_sent', 'ineligible')),
  claim_points         INTEGER NOT NULL DEFAULT 1000,
  claim_transaction_id TEXT,
  claimed_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  first_order_id       TEXT UNIQUE,
  first_order_amount   INTEGER,
  reward_points        INTEGER NOT NULL DEFAULT 0,
  reward_transaction_id TEXT,
  reward_sent_at       TEXT,
  ineligible_reason    TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_pay_forward_referrals_code
  ON pay_forward_referrals(code);

CREATE INDEX IF NOT EXISTS idx_pay_forward_referrals_referrer
  ON pay_forward_referrals(referrer_customer_id);

CREATE INDEX IF NOT EXISTS idx_pay_forward_referrals_status
  ON pay_forward_referrals(status);
