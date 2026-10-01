// Single place that reads and validates the MoMo configuration, so a missing or
// wrong production value fails at boot instead of mid-payment.
require("dotenv").config();

const momoEnv = String(process.env.MOMO_ENV || "sandbox").toLowerCase();
const isProduction = momoEnv === "production";
const isSandbox = momoEnv === "sandbox";

if (!isProduction && !isSandbox) {
  throw new Error(`MOMO_ENV must be "sandbox" or "production", got "${process.env.MOMO_ENV}"`);
}

// MTN's X-Target-Environment is NOT the same thing as the environment name.
// Sandbox sends "sandbox"; production sends a per-market id, e.g. "mtnrwanda"
// for MTN Rwanda. Sending the literal string "production" is a documented error
// (NOT_ALLOWED_TARGET_ENVIRONMENT), which is why these are two separate values.
const targetEnv = String(process.env.MOMO_TARGET_ENV || (isProduction ? "" : momoEnv)).trim();

if (isProduction) {
  if (!targetEnv) {
    throw new Error(
      "MOMO_TARGET_ENV is required in production. For MTN Rwanda it is \"mtnrwanda\"."
    );
  }
  if (targetEnv.toLowerCase() === "production") {
    throw new Error(
      'MOMO_TARGET_ENV must not be "production". Use the per-market id, e.g. "mtnrwanda" for MTN Rwanda.'
    );
  }
}

const baseUrl = String(process.env.MOMO_BASE_URL || (isProduction ? "https://proxy.momoapi.mtn.com" : "https://sandbox.momodeveloper.mtn.com"))
  .replace(/\/+$/, "");

const currency = String(process.env.MOMO_CURRENCY || (isProduction ? "RWF" : "EUR")).toUpperCase();
const callbackUrl = String(process.env.CALLBACK_URL || "").trim();
const adminKey = String(process.env.ADMIN_API_KEY || "");

// Currencies with no minor units. MoMo rejects decimals for these, so amounts
// must be sent as whole numbers.
const ZERO_DECIMAL_CURRENCIES = new Set(["RWF", "UGX", "XAF", "XOF", "ZMW", "SZL", "GNF", "LRD"]);

function requireSecret(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

const missing = [];
if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
if (!process.env.SUBSCRIPTION_KEY) missing.push("SUBSCRIPTION_KEY");
if (!process.env.MOMO_API_USER) missing.push("MOMO_API_USER");
if (!process.env.MOMO_API_KEY) missing.push("MOMO_API_KEY");
if (!adminKey) missing.push("ADMIN_API_KEY");
if (missing.length) {
  throw new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
}

if (isProduction) {
  if (!callbackUrl) {
    // Not fatal: MoMo falls back to the host registered on the Partner Portal.
    console.warn(
      "[config] CALLBACK_URL is empty. MoMo will call the Payment Server URL registered on the MTN Partner Portal instead."
    );
  } else if (!/^https:\/\//i.test(callbackUrl)) {
    console.warn("[config] CALLBACK_URL is not https. Production callbacks should use https.");
  } else if (/\/momo\/callback\/?$/.test(callbackUrl) === false) {
    console.warn(
      `[config] CALLBACK_URL does not end in /momo/callback. MoMo will POST to exactly this URL, and this app only serves the callback at /momo/callback.`
    );
  }
  if (adminKey.length < 24) {
    console.warn("[config] ADMIN_API_KEY is short. Use a long random value in production.");
  }
}

module.exports = {
  momoEnv,
  isProduction,
  isSandbox,
  baseUrl,
  targetEnv,
  currency,
  callbackUrl,
  adminKey,
  zeroDecimalCurrency: ZERO_DECIMAL_CURRENCIES.has(currency),
  isZeroDecimalCurrency(code) {
    return ZERO_DECIMAL_CURRENCIES.has(String(code || "").toUpperCase());
  },
  requireSecret,
  // Safe to print: no secrets.
  describe() {
    return [
      `MOMO environment : ${momoEnv}`,
      `Base URL         : ${baseUrl}`,
      `X-Target-Env     : ${targetEnv}`,
      `Currency         : ${currency}${ZERO_DECIMAL_CURRENCIES.has(currency) ? " (whole amounts only)" : ""}`,
      `Callback URL     : ${callbackUrl || "(none - using Partner Portal value)"}`,
    ].join("\n");
  },
};
