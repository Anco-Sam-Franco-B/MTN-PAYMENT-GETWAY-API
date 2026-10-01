-- Run this in the Neon SQL Editor

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  total NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (status IN ('UNPAID','PAID')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id),
  reference_id UUID NOT NULL UNIQUE,
  phone VARCHAR(15) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCESSFUL','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_order_status ON payments (order_id, status);
