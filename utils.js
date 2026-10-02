// "078 123 4567" or "+250781234567" -> "250781234567"
function normalizePhone(input) {
  let p = String(input || "").replace(/\D/g, "");
  if (p.startsWith("0")) p = "250" + p.slice(1);
  return p;
}

// MTN Rwanda mobile numbers are 078. The 072, 073 and 074 prefixes belong to
// other networks, so they cannot pay a MoMo request at all.
const MTN_RWANDA_MSISDN = /^25078\d{7}$/;

function isMtnRwandaNumber(normalized) {
  return MTN_RWANDA_MSISDN.test(normalized);
}

function rwandaPhoneRequirement() {
  return "Enter an MTN Rwanda mobile number, for example 0781234567. It must start with 078; numbers starting 072, 073 or 074 belong to other networks and cannot pay with MoMo.";
}

module.exports = {
  normalizePhone,
  isMtnRwandaNumber,
  rwandaPhoneRequirement,
};