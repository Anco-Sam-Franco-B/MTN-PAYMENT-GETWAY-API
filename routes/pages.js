// Server-rendered pages. Anything that mutates data still goes through the
// JSON API in routes/order.js and server.js.
const express = require("express");
const db = require("../db");
const config = require("../config");

const router = express.Router();

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// RWF has no minor units, so 12000.00 is shown as 12000.
function formatMoney(value) {
  const n = Number(value);
  return config.zeroDecimalCurrency ? String(Math.round(n)) : n.toFixed(2);
}

// Locals every page needs.
const base = () => ({
  currency: config.currency,
  zeroDecimal: config.zeroDecimalCurrency,
  isProduction: config.isProduction,
});

router.get(
  "/",
  wrap(async (req, res) => {
    const { rows } = await db.query(
      "SELECT id, name, price FROM products WHERE active ORDER BY id"
    );
    const products = rows.map((p) => ({ ...p, priceText: formatMoney(p.price) }));
    res.render("shop", { ...base(), title: "Products", products });
  })
);

router.get("/checkout", (req, res) => {
  res.render("checkout", { ...base(), title: "Checkout" });
});

router.get(
  "/pay/:referenceId",
  wrap(async (req, res) => {
    const { referenceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(referenceId)) return res.status(400).send("Invalid reference");

    const { rows: [payment] } = await db.query(
      "SELECT p.order_id, p.amount, p.currency, p.status FROM payments p WHERE p.reference_id = $1",
      [referenceId]
    );
    if (!payment) return res.status(404).send("Payment not found");

    res.render("pay", {
      ...base(),
      title: "Paying",
      referenceId,
      orderId: payment.order_id,
      amount: formatMoney(payment.amount),
      currency: payment.currency || config.currency,
    });
  })
);

router.get("/admin", (req, res) => {
  res.render("admin", { ...base(), title: "Admin" });
});

module.exports = router;
