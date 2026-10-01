const crypto = require("crypto");
const config = require("./config");

let cached = { token: null, expiresAt: 0 };

// MoMo rejects decimal amounts for currencies without minor units (RWF, UGX,
// XAF, ...). Rounding is the right behaviour here because the total always comes
// from our own products table, so the amount we send is the amount we charge.
function formatAmount(amount, currency) {
  const code = String(currency || config.currency).toUpperCase();
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Refusing to send a non-positive amount: ${amount}`);
  }
  if (config.isZeroDecimalCurrency(code)) {
    return String(Math.round(value));
  }
  return value.toFixed(2);
}

async function getToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;

  const basic = Buffer.from(
    `${config.requireSecret("MOMO_API_USER")}:${config.requireSecret("MOMO_API_KEY")}`
  ).toString("base64");

  const headers = {
    Authorization: `Basic ${basic}`,
    "Ocp-Apim-Subscription-Key": config.requireSecret("SUBSCRIPTION_KEY"),
  };
  if (config.isProduction) {
    // Production wants the target environment on the token call too.
    headers["X-Target-Environment"] = config.targetEnv;
  }

  const res = await fetch(`${config.baseUrl}/collection/token/`, {
    method: "POST",
    headers,
    ...(config.isProduction ? { body: "{}" } : {}),
  });
  if (!res.ok) throw new Error(`MoMo token failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  // refresh 60s before real expiry
  cached = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return cached.token;
}

async function requestToPay({ amount, currency, phone, orderId }) {
  const token = await getToken();
  const referenceId = crypto.randomUUID();
  const payCurrency = (currency || config.currency).toUpperCase();
  const sendAmount = formatAmount(amount, payCurrency);

  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Reference-Id": referenceId,
    "X-Target-Environment": config.targetEnv,
    "Ocp-Apim-Subscription-Key": config.requireSecret("SUBSCRIPTION_KEY"),
    "Content-Type": "application/json",
  };
  if (config.callbackUrl) headers["X-Callback-Url"] = config.callbackUrl;

  const res = await fetch(`${config.baseUrl}/collection/v1_0/requesttopay`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      amount: sendAmount,
      currency: payCurrency,
      externalId: String(orderId),
      payer: { partyIdType: "MSISDN", partyId: phone },
      payerMessage: `Payment for order ${orderId}`,
      payeeNote: `Order ${orderId}`,
    }),
  });
  if (res.status !== 202) {
    throw new Error(`MoMo requestToPay failed: ${res.status} ${await res.text()}`);
  }
  return referenceId;
}

async function getStatus(referenceId) {
  const token = await getToken();
  const res = await fetch(`${config.baseUrl}/collection/v1_0/requesttopay/${referenceId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Target-Environment": config.targetEnv,
      "Ocp-Apim-Subscription-Key": config.requireSecret("SUBSCRIPTION_KEY"),
    },
  });
  if (!res.ok) throw new Error(`MoMo status failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = { requestToPay, getStatus, formatAmount };
