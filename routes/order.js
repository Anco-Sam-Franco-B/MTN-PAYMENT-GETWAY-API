const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const config = require("../config");
const { normalizePhone } = require("../utils");

const router = express.Router();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- helpers ----------

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: "Server error" });
  });

// Protects list / read / update / delete. Send header: x-admin-key: <ADMIN_API_KEY>
function requireAdmin(req, res, next) {
  const key = Buffer.from(process.env.ADMIN_API_KEY || "");
  const given = Buffer.from(String(req.get("x-admin-key") || ""));
  if (!key.length || key.length !== given.length || !crypto.timingSafeEqual(key, given)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function tx(fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Invalid id");
  return id;
}

// [{productId, quantity}] -> Map(productId -> quantity). Duplicates are merged.
function parseItems(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) {
    throw new HttpError(400, "items must be a non-empty array (max 50)");
  }
  const items = new Map();
  for (const it of raw) {
    const productId = Number(it && it.productId);
    const quantity = Number(it && it.quantity);
    if (!Number.isInteger(productId) || productId < 1) throw new HttpError(400, "Invalid productId");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new HttpError(400, "quantity must be a whole number from 1 to 100");
    }
    items.set(productId, (items.get(productId) || 0) + quantity);
  }
  return items;
}

function parseCustomer(body) {
  const out = {};
  if (body.customerName !== undefined) {
    const name = String(body.customerName).trim();
    if (name.length > 100) throw new HttpError(400, "customerName is too long");
    out.customer_name = name || null;
  }
  if (body.customerPhone !== undefined) {
    const phone = normalizePhone(body.customerPhone);
    if (phone && !/^\d{9,15}$/.test(phone)) throw new HttpError(400, "Invalid customerPhone");
    // Check the MoMo prefix here too, not just at /pay. Otherwise an order gets
    // created for a number that can never be paid, and it sits UNPAID forever.
    if (phone && config.isProduction && !config.acceptsPhone(phone)) {
      throw new HttpError(400, config.phoneRequirement());
    }
    out.customer_phone = phone || null;
  }
  return out;
}

// Prices come from the products table, never from the client.
async function priceItems(client, items) {
  const ids = [...items.keys()];
  const { rows } = await client.query(
    "SELECT id, name, price FROM products WHERE id = ANY($1::int[]) AND active",
    [ids]
  );
  if (rows.length !== ids.length) {
    throw new HttpError(400, "One or more products do not exist or are unavailable");
  }
  let cents = 0;
  const lines = rows.map((p) => {
    const quantity = items.get(p.id);
    cents += Math.round(Number(p.price) * 100) * quantity;
    return { productId: p.id, name: p.name, unitPrice: p.price, quantity };
  });
  return { lines, total: (cents / 100).toFixed(2) };
}

async function writeItems(client, orderId, lines) {
  for (const l of lines) {
    await client.query(
      "INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)",
      [orderId, l.productId, l.name, l.unitPrice, l.quantity]
    );
  }
}

async function fetchOrder(q, id, { withPayments = false } = {}) {
  const { rows: [order] } = await q.query("SELECT * FROM orders WHERE id = $1", [id]);
  if (!order) return null;
  const items = await q.query(
    "SELECT product_id, name, unit_price, quantity FROM order_items WHERE order_id = $1 ORDER BY id",
    [id]
  );
  order.items = items.rows;
  if (withPayments) {
    const pays = await q.query(
      "SELECT reference_id, amount, currency, status, created_at FROM payments WHERE order_id = $1 ORDER BY id DESC",
      [id]
    );
    order.payments = pays.rows;
  }
  return order;
}

// Locks the row so two requests can't change the same order at once.
async function lockOrder(client, id) {
  const { rows: [order] } = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
  if (!order) throw new HttpError(404, "Order not found");
  return order;
}

async function assertEditable(client, order) {
  if (order.status !== "UNPAID") throw new HttpError(409, `Order is ${order.status}, it can no longer be changed`);
  const { rowCount } = await client.query(
    "SELECT 1 FROM payments WHERE order_id = $1 AND status = 'PENDING'",
    [order.id]
  );
  if (rowCount) throw new HttpError(409, "A payment is in progress for this order");
}

// ---------- routes ----------

// Create (public: the customer's checkout calls this)
router.post("/", wrap(async (req, res) => {
  const items = parseItems(req.body.items);
  const customer = parseCustomer(req.body);

  const orderId = await tx(async (client) => {
    const { lines, total } = await priceItems(client, items);
    const { rows: [order] } = await client.query(
      "INSERT INTO orders (total, customer_name, customer_phone) VALUES ($1,$2,$3) RETURNING id",
      [total, customer.customer_name || null, customer.customer_phone || null]
    );
    await writeItems(client, order.id, lines);
    return order.id;
  });

  res.status(201).json(await fetchOrder(db, orderId));
}));

// List: GET /orders?status=UNPAID&page=1&limit=20
router.get("/", requireAdmin, wrap(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const params = [];
  let where = "";
  if (req.query.status) {
    if (!["UNPAID", "PAID", "CANCELLED"].includes(req.query.status)) {
      throw new HttpError(400, "Invalid status");
    }
    params.push(req.query.status);
    where = "WHERE status = $1";
  }

  const count = await db.query(`SELECT count(*)::int AS n FROM orders ${where}`, params);
  const { rows } = await db.query(
    `SELECT id, total, status, customer_name, customer_phone, created_at
       FROM orders ${where}
       ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, (page - 1) * limit]
  );
  res.json({ orders: rows, page, limit, total: count.rows[0].n });
}));

// Read one (with items and payments)
router.get("/:id", requireAdmin, wrap(async (req, res) => {
  const order = await fetchOrder(db, parseId(req.params.id), { withPayments: true });
  if (!order) throw new HttpError(404, "Order not found");
  res.json(order);
}));

// Update customer details, replace items, or cancel: PATCH /orders/:id
// Body (all optional): { customerName, customerPhone, items: [{productId, quantity}], status: "CANCELLED" }
router.patch("/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseId(req.params.id);
  const customer = parseCustomer(req.body);
  const hasItems = req.body.items !== undefined;
  const items = hasItems ? parseItems(req.body.items) : null;

  let status = null;
  if (req.body.status !== undefined) {
    if (req.body.status !== "CANCELLED") {
      throw new HttpError(400, 'status can only be set to "CANCELLED" (PAID is set by the payment flow)');
    }
    status = "CANCELLED";
  }
  if (!Object.keys(customer).length && !hasItems && !status) {
    throw new HttpError(400, "Nothing to update");
  }

  await tx(async (client) => {
    const order = await lockOrder(client, id);
    await assertEditable(client, order);

    const sets = [];
    const vals = [];
    const add = (col, val) => {
      vals.push(val);
      sets.push(`${col} = $${vals.length}`);
    };

    for (const [col, val] of Object.entries(customer)) add(col, val);
    if (status) add("status", status);

    if (hasItems) {
      const { lines, total } = await priceItems(client, items);
      await client.query("DELETE FROM order_items WHERE order_id = $1", [id]);
      await writeItems(client, id, lines);
      add("total", total);
    }

    vals.push(id);
    await client.query(
      `UPDATE orders SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`,
      vals
    );
  });

  res.json(await fetchOrder(db, id, { withPayments: true }));
}));

// Delete: only orders that never had a payment attempt. Otherwise cancel instead.
router.delete("/:id", requireAdmin, wrap(async (req, res) => {
  const id = parseId(req.params.id);

  await tx(async (client) => {
    await lockOrder(client, id);
    const { rowCount } = await client.query("SELECT 1 FROM payments WHERE order_id = $1", [id]);
    if (rowCount) {
      throw new HttpError(409, "This order has payment records and cannot be deleted. Cancel it instead.");
    }
    await client.query("DELETE FROM orders WHERE id = $1", [id]); // order_items cascade
  });

  res.sendStatus(204);
}));

module.exports = router;