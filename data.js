// MTN MoMo Collection API: Request to Pay (Node.js 18+, no dependencies)
// Run: SUBSCRIPTION_KEY=your_key node momo-collection.js

const crypto = require("crypto");

const BASE = "https://sandbox.momodeveloper.mtn.com";
const SUB_KEY = process.env.SUBSCRIPTION_KEY; // Collection product primary key
const TARGET_ENV = "sandbox"; // use your production environment name when live
const CALLBACK_HOST = "example.com"; // sandbox only: any host you own

// ---- 1. Sandbox only: create API user + API key (do this once, then save them) ----
async function createApiUserAndKey() {
  const apiUser = crypto.randomUUID();

  let res = await fetch(`${BASE}/v1_0/apiuser`, {
    method: "POST",
    headers: {
      "X-Reference-Id": apiUser,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ providerCallbackHost: CALLBACK_HOST }),
  });
  if (res.status !== 201) throw new Error(`Create user failed: ${res.status} ${await res.text()}`);

  res = await fetch(`${BASE}/v1_0/apiuser/${apiUser}/apikey`, {
    method: "POST",
    headers: { "Ocp-Apim-Subscription-Key": SUB_KEY },
  });
  if (!res.ok) throw new Error(`Create key failed: ${res.status} ${await res.text()}`);
  const { apiKey } = await res.json();

  return { apiUser, apiKey };
}

// ---- 2. Get access token (valid ~1 hour, so cache it in real apps) ----
async function getToken(apiUser, apiKey) {
  const basic = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");
  const res = await fetch(`${BASE}/collection/token/`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
    },
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  const { access_token } = await res.json();
  return access_token;
}

// ---- 3. Request to Pay: customer gets a prompt on their phone ----
async function requestToPay(token, { amount, currency, phone, orderId }) {
  const referenceId = crypto.randomUUID(); // store this against the order
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": referenceId,
      "X-Target-Environment": TARGET_ENV,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
      "Content-Type": "application/json",
      // "X-Callback-Url": "https://yourshop.com/momo/callback", // optional
    },
    body: JSON.stringify({
      amount: String(amount),
      currency, // sandbox: "EUR"; Rwanda production: "RWF"
      externalId: String(orderId),
      payer: { partyIdType: "MSISDN", partyId: phone }, // digits only, with country code
      payerMessage: "Payment for order " + orderId,
      payeeNote: "Order " + orderId,
    }),
  });
  if (res.status !== 202) throw new Error(`Request to pay failed: ${res.status} ${await res.text()}`);
  return referenceId;
}

// ---- 4. Check the result ----
async function getStatus(token, referenceId) {
  const res = await fetch(`${BASE}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": TARGET_ENV,
      "Ocp-Apim-Subscription-Key": SUB_KEY,
    },
  });
  if (!res.ok) throw new Error(`Status failed: ${res.status} ${await res.text()}`);
  return res.json(); // { status: "PENDING" | "SUCCESSFUL" | "FAILED", ... }
}

async function waitForResult(token, referenceId, tries = 20, delayMs = 3000) {
  for (let i = 0; i < tries; i++) {
    const result = await getStatus(token, referenceId);
    if (result.status !== "PENDING") return result;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { status: "PENDING" }; // still unresolved; check again later
}

// ---- Demo ----
(async () => {
  if (!SUB_KEY) throw new Error("Set SUBSCRIPTION_KEY first");

  const { apiUser, apiKey } = await createApiUserAndKey();
  console.log("API user:", apiUser, "\nAPI key:", apiKey);

  const token = await getToken(apiUser, apiKey);

  // 46733123450 is a sandbox test number that approves the payment
  const referenceId = await requestToPay(token, {
    amount: 100,
    currency: "EUR",
    phone: "46733123450",
    orderId: "ORDER-1001",
  });
  console.log("Reference ID:", referenceId);

  const result = await waitForResult(token, referenceId);
  console.log("Result:", result);

  if (result.status === "SUCCESSFUL") {
    // mark the order as paid in your database here
  }
})().catch((err) => console.error(err.message));