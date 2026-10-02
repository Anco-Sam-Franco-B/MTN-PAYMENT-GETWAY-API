const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const config = require("./config");
const db = require("./db");
const momo = require("./momo");
const { normalizePhone } = require("./utils");

const app = express();
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("trust proxy", 1); // Render terminates TLS in front of us

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
      },
    },
    // The EJS pages are same-origin; strict COEP would block nothing useful here.
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

// The EJS pages are served by this same app, so CORS is only needed for a
// separate frontend host. Leaving FRONTEND_ORIGIN empty disables it.
const frontendOrigin = String(process.env.FRONTEND_ORIGIN || "").trim();
if (frontendOrigin) app.use(cors({ origin: frontendOrigin }));

app.use("/css", express.static(path.join(__dirname, "public", "css"), { maxAge: "1h" }));
app.use("/js", express.static(path.join(__dirname, "public", "js"), { maxAge: "1h" }));

// Render health check, and a quick way to confirm the database is reachable.
app.get("/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ ok: true, environment: config.momoEnv, currency: config.currency });
  } catch (err) {
    res.status(503).json({ ok: false, error: "database unavailable" });
  }
});

app.use("/orders", require("./routes/order"));

// Update payment + order exactly once, even if callback and polling race.
async function applyResult(paymentId, orderId, status) {
  if (status !== "SUCCESSFUL" && status !== "FAILED") return;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      "UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 AND status = 'PENDING'",
      [status, paymentId]
    );
    if (r.rowCount && status === "SUCCESSFUL") {
      await client.query("UPDATE orders SET status = 'PAID' WHERE id = $1", [orderId]);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// 1) Start a payment. The amount comes from YOUR database, never from the client.
app.post("/pay", async (req, res) => {
  if (!config.paymentsReady) {
    return res.status(503).json({
      error: "Payments are not configured on this server yet",
      detail: `Missing ${config.missingMomo.join(", ")}`,
    });
  }
  try {
    const orderId = Number(req.body.orderId);
    const phone = normalizePhone(req.body.phone);

    if (!Number.isInteger(orderId) || orderId < 1) {
      return res.status(400).json({ error: "Valid orderId is required" });
    }
    // Rwanda's MoMo runs on MTN, whose mobile prefixes are 078 and 079. Airtel's
    // 072 and 073 cannot pay a MoMo request, so reject them here with a clear
    // message instead of letting MoMo fail the transaction later.
    if (config.isProduction && !config.acceptsPhone(phone)) {
      return res.status(400).json({ error: config.phoneRequirement() });
    }

    const { rows: [order] } = await db.query(
      "SELECT id, total, status FROM orders WHERE id = $1",
      [orderId]
    );
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "UNPAID") return res.status(409).json({ error: `Order is ${order.status}` });

    const currency = config.currency;
    const referenceId = await momo.requestToPay({
      amount: order.total, // NUMERIC comes back as a string like "5000.00"
      currency,
      phone,
      orderId: order.id,
    });

    await db.query(
      "INSERT INTO payments (order_id, reference_id, phone, amount, currency) VALUES ($1,$2,$3,$4,$5)",
      [order.id, referenceId, phone, order.total, currency]
    );

    res.status(202).json({ message: "Approve the payment on your phone", referenceId });
  } catch (err) {
    console.error("[pay] " + err.message);
    // Give the customer something actionable instead of a dead end, without
    // leaking MTN's raw response (it can contain account detail).
    const reason = /token failed: 401|invalid_client/i.test(err.message)
      ? "MTN rejected this server's credentials. Check SUBSCRIPTION_KEY, MOMO_API_USER and MOMO_API_KEY."
      : /token failed/i.test(err.message)
      ? "This server could not authenticate with MTN."
      : /requestToPay failed: 4\d\d/i.test(err.message)
      ? "MTN refused the payment request. Check the amount, currency and phone number."
      : /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|fetch failed/i.test(err.message)
      ? "Could not reach MTN's servers. Please try again."
      : "Could not start payment. Please try again.";
    res.status(502).json({ error: reason });
  }
});

// 2) Status check. Frontend polls this every few seconds after /pay.
app.get("/pay/status/:referenceId", async (req, res) => {
  try {
    const { referenceId } = req.params;
    if (!/^[0-9a-f-]{36}$/i.test(referenceId)) {
      return res.status(400).json({ error: "Invalid reference" });
    }

    const { rows: [p] } = await db.query(
      "SELECT * FROM payments WHERE reference_id = $1",
      [referenceId]
    );
    if (!p) return res.status(404).json({ error: "Payment not found" });

    if (p.status === "PENDING") {
      const live = await momo.getStatus(p.reference_id);
      await applyResult(p.id, p.order_id, live.status);
      return res.json({ status: live.status, orderId: p.order_id });
    }
    res.json({ status: p.status, orderId: p.order_id });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Could not check payment" });
  }
});

// 3) MoMo callback. The body is never trusted: it is only used to find our own
//    payment row, and the outcome is always confirmed with MoMo before we write.
async function callback(req, res) {
  res.sendStatus(200); // acknowledge fast; MoMo retries if we answer slowly

  const body = req.body || {};
  const referenceId = String(body.referenceId || "").trim();
  const externalId = Number(body.externalId);
  const reported = String(body.status || "").trim();

  try {
    let payments = [];
    if (referenceId) {
      if (!/^[0-9a-f-]{36}$/i.test(referenceId)) {
        console.warn("Callback ignored: referenceId is not a UUID");
        return;
      }
      const { rows } = await db.query("SELECT * FROM payments WHERE reference_id = $1", [referenceId]);
      payments = rows;
    } else if (Number.isInteger(externalId)) {
      // Older callbacks omit referenceId, so fall back to the order.
      const { rows } = await db.query(
        "SELECT * FROM payments WHERE order_id = $1 AND status = 'PENDING'",
        [externalId]
      );
      payments = rows;
    } else {
      console.warn("Callback ignored: no usable referenceId or externalId");
      return;
    }

    console.log(
      `Callback: reference=${referenceId || "-"} externalId=${body.externalId || "-"} reported=${reported || "-"} matches=${payments.length}`
    );

    for (const p of payments) {
      const live = await momo.getStatus(p.reference_id);
      await applyResult(p.id, p.order_id, live.status);
    }
  } catch (err) {
    console.error("Callback error:", err.message);
  }
}
app.put("/momo/callback", callback);
app.post("/momo/callback", callback);

app.use("/", require("./routes/pages"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// Anything a page route throws lands here instead of leaking a stack trace.
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send("Something went wrong.");
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on port", process.env.PORT || 3000);
  console.log(config.describe());
  if (config.isProduction && !config.callbackUrl) {
    console.log("Note: the pay page still works because it polls /pay/status/:referenceId.");
  }
});