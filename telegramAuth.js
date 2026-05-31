const crypto = require("crypto");

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}

function buildDataCheckString(fields) {
  const keys = Object.keys(fields)
    .filter((k) => k !== "hash")
    .sort();
  return keys.map((k) => `${k}=${fields[k]}`).join("\n");
}

function timingSafeEqualHex(a, b) {
  const aBuf = Buffer.from(a, "hex");
  const bBuf = Buffer.from(b, "hex");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Validates Telegram Mini App initData.
 * Source algorithm: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
function validateInitData(initData, botToken, { maxAgeSeconds = 60 * 60 * 24 } = {}) {
  if (!initData) return { ok: false, error: "Missing initData" };
  if (!botToken) return { ok: false, error: "Missing BOT_TOKEN" };

  const fields = parseInitData(initData);
  if (!fields.hash) return { ok: false, error: "Missing hash" };
  if (!fields.auth_date) return { ok: false, error: "Missing auth_date" };

  const authDate = Number(fields.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, error: "Invalid auth_date" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAgeSeconds) return { ok: false, error: "initData is too old" };

  const dataCheckString = buildDataCheckString(fields);
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!timingSafeEqualHex(calculatedHash, fields.hash)) {
    return { ok: false, error: "Bad initData hash" };
  }

  let user = null;
  try {
    user = fields.user ? JSON.parse(fields.user) : null;
  } catch {
    return { ok: false, error: "Invalid user JSON" };
  }

  return { ok: true, user, fields };
}

module.exports = { validateInitData };

