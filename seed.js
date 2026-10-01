// Usage:
//   npm run seed            seed products + demo orders (skips if data already exists)
//   npm run seed -- --reset wipe orders/payments/order_items first, then seed
//
// Prices are in RWF for MTN Rwanda. RWF has no minor units, so keep them whole.
require("dotenv").config();
const crypto = require("crypto");
const db = require("./db");
const config = require("./config");
const { normalizePhone } = require("./utils");

const PRODUCTS = [
  { name: "Kigali Blend Coffee 250g", price: "12000" },
  { name: "Handwoven Basket", price: "25000" },
  { name: "Black Tea - 100 leaves", price: "6000" },
  { name: "Leather Card Holder", price: "18000" },
  { name: "Avocado Soap Bar", price: "4500" },
  { name: "Independence Day T-Shirt", price: "15000" },
  { name: "Ceramic Mug", price: "9000" },
  { name: "Spice Set (3 jars)", price: "21000" },
  { name: "Bamboo Cutlery Set", price: "13500" },
  { name: "Gourmet Honey 500g", price: "11000" },
];

// Each order: items reference a product by its index in PRODUCTS above.
// Sample customers. Only MTN Rwanda (078) numbers can pay a MoMo request, so
// every seeded number uses that prefix. These are fake details, not real people.
const CUSTOMERS = [
  ["Aline Uwase", "0781234567"],
  ["Eric Habimana", "0782988776"],
  ["Diane Mukamana", "0785551234"],
  ["Jean-Bosco Nzigi", "0784441122"],
  ["Claudine Iradukunda", "0788887766"],
  ["Patrick Sekandi", "0782223344"],
  ["Grace Mukeshimana", "0787776655"],
  ["Thierry Nshimiyimana", "0781119988"],
  ["Sandrine Ingabire", "0783334455"],
  ["Fabrice Gatete", "0786667788"],
];

const ORDERS = [
  { items: [[0, 2], [6, 1]], ageDays: 12, state: "paid" },
  { items: [[2, 1]], ageDays: 10, state: "paid" },
  { items: [[1, 1], [8, 1], [4, 2]], ageDays: 9, state: "paid" },
  { items: [[5, 3]], ageDays: 7, state: "paid" },
  { items: [[9, 1], [6, 2]], ageDays: 5, state: "pending" },
  { items: [[3, 1]], ageDays: 4, state: "pending" },
  { items: [[0, 1], [2, 1], [4, 1]], ageDays: 3, state: "unpaid" },
  { items: [[7, 1], [6, 1]], ageDays: 2, state: "unpaid" },
  { items: [[5, 1], [8, 2], [4, 1]], ageDays: 1, state: "cancelled" },
  { items: [[1, 2], [9, 1], [6, 1]], ageDays: 0, state: "unpaid" },
];

// The payer is the customer, so the payment row uses their own number.
const roundCents = (v) => Math.round(Number(v) * 100);
async function main() {
  const reset = process.argv.includes("--reset");
  if (reset) {
    await db.query("TRUNCATE order_items, payments, orders, products RESTART IDENTITY CASCADE");
    console.log("Wiped products, orders, order_items, payments.");
  }

  const { rows: [{ n: existing }] } = await db.query("SELECT count(*)::int AS n FROM products");
  if (existing > 0) {
    console.log("Database already has products. Run with --reset to start clean.");
    await db.end();
    return;
  }

  const client = await db.connect();
  const currency = config.currency;
  try {
    await client.query("BEGIN");

    const values = [];
    const params = [];
    for (const [i, p] of PRODUCTS.entries()) {
      values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
      params.push(p.name, p.price);
    }
    const inserted = await client.query(
      `INSERT INTO products (name, price) VALUES ${values.join(", ")} RETURNING id, name, price`,
      params
    );

    const byIndex = new Map(inserted.rows.map((r, i) => [i, r]));

    let paid = 0;
    let pending = 0;
    let unpaid = 0;
    let cancelled = 0;

    for (const [i, spec] of ORDERS.entries()) {
      const [name, phone] = CUSTOMERS[i % CUSTOMERS.length];
      const lines = spec.items.map(([idx, qty]) => ({ ...byIndex.get(idx), quantity: qty }));

      // Same maths as routes/order.js priceItems so the snapshot total always matches.
      const cents = lines.reduce((sum, l) => sum + roundCents(l.price) * l.quantity, 0);
      const total = (cents / 100).toFixed(2);
      const createdAt = new Date(Date.now() - spec.ageDays * 86400000 - i * 60000);

      const status = { paid: "PAID", pending: "UNPAID", unpaid: "UNPAID", cancelled: "CANCELLED" }[spec.state];
      const msisdn = normalizePhone(phone); // same format the API stores

      const { rows: [order] } = await client.query(
        `INSERT INTO orders (total, status, customer_name, customer_phone, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [total, status, name, msisdn, createdAt]
      );

      for (const l of lines) {
        await client.query(
          "INSERT INTO order_items (order_id, product_id, name, unit_price, quantity) VALUES ($1,$2,$3,$4,$5)",
          [order.id, l.id, l.name, l.price, l.quantity]
        );
      }

      if (spec.state !== "unpaid") {
        const payStatus = { paid: "SUCCESSFUL", pending: "PENDING", cancelled: "FAILED" }[spec.state];
        await client.query(
          `INSERT INTO payments (order_id, reference_id, phone, amount, currency, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
          [
            order.id,
            crypto.randomUUID(),
            msisdn,
            total,
            currency,
            payStatus,
            createdAt,
          ]
        );
      }

      if (spec.state === "paid") paid++;
      else if (spec.state === "pending") pending++;
      else if (spec.state === "cancelled") cancelled++;
      else unpaid++;
    }

    await client.query("COMMIT");
    console.log(`Seeded ${inserted.rows.length} products and ${ORDERS.length} orders:`);
    console.log(`  ${paid} PAID, ${pending} UNPAID with a PENDING payment, ${unpaid} UNPAID unpaid, ${cancelled} CANCELLED`);
    console.log(`  currency: ${currency}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
