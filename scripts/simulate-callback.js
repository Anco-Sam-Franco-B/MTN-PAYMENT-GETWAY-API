// Sends a fake MoMo callback to your running server so you can test the callback
// path without a public URL. MoMo's sandbox cannot reach localhost, which is why
// CALLBACK_URL is usually empty during development.
//
// Usage:
//   npm run momo:callback                       needs a reference id
//   npm run momo:callback -- <referenceId>
//   npm run momo:callback -- --order 7          use the newest PENDING payment of order 7
require("dotenv").config();

const BASE = `http://localhost:${process.env.PORT || 3000}`;

async function findReference(orderId) {
  const db = require("../db");
  const { rows } = await db.query(
    "SELECT reference_id FROM payments WHERE order_id = $1 AND status = 'PENDING' ORDER BY id DESC LIMIT 1",
    [orderId]
  );
  await db.end();
  if (!rows.length) throw new Error(`No PENDING payment found for order ${orderId}`);
  return rows[0].reference_id;
}

async function main() {
  const args = process.argv.slice(2);
  const orderIndex = args.indexOf("--order");
  const referenceId = orderIndex !== -1
    ? await findReference(Number(args[orderIndex + 1]))
    : args.find((a) => /^[0-9a-f-]{36}$/i.test(a));

  if (!referenceId) {
    console.error("Pass a reference id (UUID) or --order <id>.");
    process.exit(1);
  }

  // The body deliberately contains a bogus status: the server must ignore it and
  // confirm the real outcome with MoMo.
  const payload = {
    amount: "100.00",
    currency: process.env.MOMO_CURRENCY || "EUR",
    externalId: "1",
    paymentId: "MOCK-PAYMENT-ID",
    referenceId,
    status: "SUCCESSFUL",
  };

  console.log("POST", `${BASE}/momo/callback`);
  console.log(JSON.stringify(payload, null, 2));

  const res = await fetch(`${BASE}/momo/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("Server replied:", res.status);
  console.log("Watch the server log for the resolved status.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
