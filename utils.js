// "078 123 4567" or "+250781234567" -> "250781234567"
function normalizePhone(input) {
  let p = String(input || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "250" + p.slice(1);
  return p;
}

// Which prefixes are payable is environment config, so it lives in config.js.
module.exports = { normalizePhone };