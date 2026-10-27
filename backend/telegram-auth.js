// Telegramning RASMIY xizmatlari orqali kirish (o'z botimiz xabar yuborishi shart emas):
//
//  1) Telegram Gateway (https://core.telegram.org/gateway/api): telefon raqamga tasdiqlash kodi
//     Telegramning rasmiy "Verification Codes" akkauntidan keladi (SMS o'rniga). Kodni Telegramning
//     o'zi tekshiradi (checkVerificationStatus).
//  2) "Log in with Telegram" (OpenID Connect, https://core.telegram.org/bots/telegram-login):
//     foydalanuvchi Telegram ilovasida tasdiqlaydi, backend id_token ichidan telefon raqamni oladi.
//     Mobil ilova brauzer/Telegramni ochadi va natijani `state` bo'yicha so'rab (polling) sessiyani oladi.
//
// .env:
//   TELEGRAM_GATEWAY_TOKEN        — gateway.telegram.org akkauntidagi access token (kod yuborish uchun)
//   TELEGRAM_OIDC_CLIENT_ID       — BotFather > Bot > Login Widget: Client ID
//   TELEGRAM_OIDC_CLIENT_SECRET   — shu yerdagi Client Secret
//   TELEGRAM_OIDC_REDIRECT_URI    — BotFather'da "Allowed URLs"ga qo'shiladigan manzil
//                                   (standart: <PUBLIC_API_BASE_URL>/api/auth/telegram/oidc/callback)
// Sozlanmagan qism 503 qaytaradi; qolgani ishlayveradi.
const crypto = require("crypto");

const CODE_TTL_SECONDS = 300;
const OIDC_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const CODE_COOLDOWN_MS = 45 * 1000;

function createRateLimiter() {
  const buckets = new Map();
  function hit(key, max, windowMs) {
    const now = Date.now();
    const list = (buckets.get(key) || []).filter((time) => now - time < windowMs);
    if (list.length >= max) {
      buckets.set(key, list);
      return false;
    }
    list.push(now);
    buckets.set(key, list);
    return true;
  }
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, list] of buckets) {
      if (!list.length || now - list[list.length - 1] > 60 * 60 * 1000) buckets.delete(key);
    }
  }, 10 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  return { hit };
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.ip || "unknown";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function resultPage(ok, message) {
  return `<!doctype html><html lang="uz"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Topshirdi</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#f7f9ff;color:#1c1c1e;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}
.card{background:#fff;border-radius:24px;padding:32px 24px;max-width:360px;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.08)}
.icon{font-size:48px}h1{font-size:20px;margin:12px 0 8px}p{color:#636366;margin:0;line-height:1.5}</style></head>
<body><div class="card"><div class="icon">${ok ? "✅" : "⚠️"}</div><h1>${ok ? "Tasdiqlandi" : "Kirish amalga oshmadi"}</h1><p>${escapeHtml(message)}</p></div></body></html>`;
}

function createTelegramAuth({ dbApi, normalizeUzPhone, respondWithAuthUser, secret, env = process.env }) {
  const gatewayToken = String(env.TELEGRAM_GATEWAY_TOKEN || "").trim();
  const gatewayBase = String(env.TELEGRAM_GATEWAY_BASE || "https://gatewayapi.telegram.org").replace(/\/+$/, "");
  const oidcClientId = String(env.TELEGRAM_OIDC_CLIENT_ID || "").trim();
  const oidcClientSecret = String(env.TELEGRAM_OIDC_CLIENT_SECRET || "").trim();
  const oidcBase = String(env.TELEGRAM_OIDC_BASE || "https://oauth.telegram.org").replace(/\/+$/, "");
  const oidcIssuer = String(env.TELEGRAM_OIDC_ISSUER || "https://oauth.telegram.org");
  const publicApiBase = String(env.PUBLIC_API_BASE_URL || env.BACKEND_URL || "https://api.topshirdi.uz").replace(/\/+$/, "");
  const oidcRedirectUri = String(env.TELEGRAM_OIDC_REDIRECT_URI || `${publicApiBase}/api/auth/telegram/oidc/callback`);
  const codeEnabled = Boolean(gatewayToken);
  const loginEnabled = Boolean(oidcClientId && oidcClientSecret);
  const limiter = createRateLimiter();

  const sha = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
  const b64url = (buffer) => Buffer.from(buffer).toString("base64url");

  // --- Telegram Gateway ---------------------------------------------------------------------
  async function gateway(method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(`${gatewayBase}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${gatewayToken}` },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!data?.ok) {
        const error = new Error(String(data?.error || `Gateway ${method} xatosi (${response.status})`));
        error.gatewayError = String(data?.error || "");
        throw error;
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureTables() {
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS phone_verifications (
        id BIGSERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        request_id TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await dbApi.run(`CREATE INDEX IF NOT EXISTS phone_verifications_phone_idx ON phone_verifications (phone, id DESC);`);
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS telegram_oidc_states (
        id BIGSERIAL PRIMARY KEY,
        state_hash TEXT NOT NULL UNIQUE,
        code_verifier TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        phone TEXT,
        full_name TEXT,
        error TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  async function findOrCreateUser(phone, fullName) {
    const existing = await dbApi.get("SELECT * FROM users WHERE phone = ?", [phone]);
    if (existing) return existing;
    return dbApi.get(
      "INSERT INTO users (full_name, phone) VALUES (?, ?) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING *",
      [String(fullName || "").trim() || null, phone]
    );
  }

  // Telegram orqali kirish parolsiz: admin akkaunti shu yo'l bilan egallab olinmasligi uchun yopiq.
  const isAdminUser = (user) => Boolean(user && (user.is_admin === true || String(user.id) === "1"));

  function normalizePhoneOrNull(value) {
    try {
      return normalizeUzPhone(value);
    } catch {
      return null;
    }
  }

  // --- Kod bilan kirish ---------------------------------------------------------------------
  async function handleRequestCode(req, res) {
    if (!codeEnabled) return res.status(503).json({ error: "Telegram orqali kod hozircha sozlanmagan" });
    const phone = normalizePhoneOrNull(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Telefon raqam formati noto‘g‘ri. Masalan: +998-97-212-00-38" });
    if (!limiter.hit(`ip:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }
    if (!limiter.hit(`cooldown:${phone}`, 1, CODE_COOLDOWN_MS)) {
      return res.status(429).json({ error: "Kod yaqinda yuborilgan. Bir ozdan keyin qayta urinib ko‘ring", retryAfter: 45 });
    }
    if (!limiter.hit(`phone:${phone}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Bu raqam uchun urinishlar soni oshib ketdi. 1 soatdan keyin urinib ko‘ring" });
    }

    let result;
    try {
      result = await gateway("sendVerificationMessage", { phone_number: phone, code_length: 6, ttl: CODE_TTL_SECONDS });
    } catch (error) {
      const code = error.gatewayError || "";
      console.error("[telegram] kod yuborilmadi:", error.message);
      if (/PHONE_NUMBER/i.test(code)) {
        return res.status(400).json({ error: "Bu raqam Telegramda topilmadi. Telegramdagi raqamingizni kiriting yoki boshqa usuldan foydalaning" });
      }
      return res.status(502).json({ error: "Kodni yuborib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring" });
    }
    await dbApi.run("UPDATE phone_verifications SET consumed = TRUE WHERE phone = ? AND consumed = FALSE", [phone]);
    await dbApi.run("INSERT INTO phone_verifications (phone, request_id, expires_at) VALUES (?, ?, ?)", [
      phone,
      String(result.request_id),
      new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString()
    ]);
    res.json({ ok: true, sent: true, expiresIn: CODE_TTL_SECONDS });
  }

  async function handleVerifyCode(req, res) {
    if (!codeEnabled) return res.status(503).json({ error: "Telegram orqali kod hozircha sozlanmagan" });
    const phone = normalizePhoneOrNull(req.body?.phone);
    if (!phone) return res.status(400).json({ error: "Telefon raqam formati noto‘g‘ri" });
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (code.length !== 6) return res.status(400).json({ error: "Kod 6 ta raqamdan iborat" });
    if (!limiter.hit(`verify-ip:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }

    const row = await dbApi.get(
      "SELECT * FROM phone_verifications WHERE phone = ? AND consumed = FALSE AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [phone]
    );
    if (!row) return res.status(400).json({ error: "Kod eskirgan yoki yuborilmagan. Yangi kod so‘rang" });
    if (Number(row.attempts) >= MAX_CODE_ATTEMPTS) {
      await dbApi.run("UPDATE phone_verifications SET consumed = TRUE WHERE id = ?", [row.id]);
      return res.status(429).json({ error: "Urinishlar soni tugadi. Yangi kod so‘rang" });
    }

    let status;
    try {
      const result = await gateway("checkVerificationStatus", { request_id: row.request_id, code });
      status = result?.verification_status?.status;
    } catch (error) {
      console.error("[telegram] kod tekshirilmadi:", error.message);
      return res.status(502).json({ error: "Kodni tekshirib bo‘lmadi. Birozdan keyin qayta urinib ko‘ring" });
    }

    if (status !== "code_valid") {
      if (status === "code_max_attempts_exceeded" || status === "expired") {
        await dbApi.run("UPDATE phone_verifications SET consumed = TRUE WHERE id = ?", [row.id]);
        return res.status(400).json({ error: "Kod eskirgan yoki urinishlar tugagan. Yangi kod so‘rang" });
      }
      await dbApi.run("UPDATE phone_verifications SET attempts = attempts + 1 WHERE id = ?", [row.id]);
      return res.status(400).json({ error: "Kod noto‘g‘ri" });
    }
    // Faqat bir marta: atomik "ishlatildi".
    const consumed = await dbApi.get("UPDATE phone_verifications SET consumed = TRUE WHERE id = ? AND consumed = FALSE RETURNING id", [row.id]);
    if (!consumed) return res.status(400).json({ error: "Kod allaqachon ishlatilgan" });

    const user = await findOrCreateUser(phone, null);
    if (isAdminUser(user)) return res.status(403).json({ error: "Admin akkaunt faqat parol bilan kiradi" });
    await respondWithAuthUser(req, res, user);
  }

  // --- "Telegram orqali kirish" (OpenID Connect) --------------------------------------------
  async function handleOidcStart(req, res) {
    if (!loginEnabled) return res.status(503).json({ error: "Telegram orqali kirish hozircha sozlanmagan" });
    if (!limiter.hit(`oidc-ip:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }
    const state = crypto.randomBytes(24).toString("hex");
    const verifier = b64url(crypto.randomBytes(32));
    await dbApi.run("INSERT INTO telegram_oidc_states (state_hash, code_verifier, expires_at) VALUES (?, ?, ?)", [
      sha(state),
      verifier,
      new Date(Date.now() + OIDC_TTL_MS).toISOString()
    ]);
    const params = new URLSearchParams({
      client_id: oidcClientId,
      redirect_uri: oidcRedirectUri,
      response_type: "code",
      scope: "openid profile phone",
      state,
      code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256"
    });
    res.json({ ok: true, state, authUrl: `${oidcBase}/auth?${params.toString()}`, expiresIn: OIDC_TTL_MS / 1000 });
  }

  async function exchangeCode(code, verifier) {
    const response = await fetch(`${oidcBase}/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${oidcClientId}:${oidcClientSecret}`).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidcRedirectUri,
        client_id: oidcClientId,
        code_verifier: verifier
      }).toString(),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.id_token) throw new Error(data?.error_description || data?.error || `token xatosi (${response.status})`);
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    const jwks = createRemoteJWKSet(new URL(`${oidcBase}/.well-known/jwks.json`));
    const { payload } = await jwtVerify(data.id_token, jwks, { issuer: oidcIssuer, audience: oidcClientId });
    return payload;
  }

  async function handleOidcCallback(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.type("html");
    if (!loginEnabled) return res.status(503).send(resultPage(false, "Telegram orqali kirish sozlanmagan."));
    const state = String(req.query.state || "");
    const stateHash = sha(state);
    const row = state ? await dbApi.get("SELECT * FROM telegram_oidc_states WHERE state_hash = ?", [stateHash]) : null;
    if (!row || row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).send(resultPage(false, "Havola eskirgan yoki allaqachon ishlatilgan. Ilovada qaytadan urinib ko‘ring."));
    }
    const fail = async (message) => {
      await dbApi.run("UPDATE telegram_oidc_states SET status = 'failed', error = ? WHERE id = ?", [message, row.id]);
      return res.status(400).send(resultPage(false, message));
    };
    if (req.query.error || !req.query.code) return fail("Telegramda kirish bekor qilindi yoki ruxsat berilmadi.");

    let claims;
    try {
      claims = await exchangeCode(String(req.query.code), row.code_verifier);
    } catch (error) {
      console.error("[telegram] OIDC xatosi:", error?.message || error);
      return fail("Telegram javobini tekshirib bo‘lmadi. Qaytadan urinib ko‘ring.");
    }
    const phone = normalizePhoneOrNull(claims.phone_number);
    if (!phone) return fail("Telefon raqamingiz olinmadi. Telegramda raqamga ruxsat bering (faqat +998 raqamlar qabul qilinadi).");

    await dbApi.run("UPDATE telegram_oidc_states SET status = 'done', phone = ?, full_name = ? WHERE id = ? AND status = 'pending'", [
      phone,
      String(claims.name || "").trim() || null,
      row.id
    ]);
    res.send(resultPage(true, "Ilovaga qayting: kirish avtomatik bajariladi."));
  }

  async function handleOidcStatus(req, res) {
    if (!loginEnabled) return res.status(503).json({ error: "Telegram orqali kirish hozircha sozlanmagan" });
    const state = String(req.query.state || "").trim();
    if (!/^[a-f0-9]{48}$/.test(state)) return res.status(400).json({ error: "State noto‘g‘ri" });
    if (!limiter.hit(`oidc-status:${sha(state).slice(0, 16)}`, 300, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda tez-tez so‘ralmoqda" });
    }
    const row = await dbApi.get("SELECT * FROM telegram_oidc_states WHERE state_hash = ?", [sha(state)]);
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ status: "expired", error: "Havola eskirgan. Qaytadan urinib ko‘ring" });
    }
    if (row.status === "failed") return res.status(410).json({ status: "failed", error: row.error || "Kirish amalga oshmadi" });
    if (row.status === "claimed") return res.status(410).json({ status: "expired", error: "Havola allaqachon ishlatilgan" });
    if (row.status !== "done") return res.json({ ok: true, status: "pending" });

    const claimed = await dbApi.get("UPDATE telegram_oidc_states SET status = 'claimed' WHERE id = ? AND status = 'done' RETURNING *", [row.id]);
    if (!claimed) return res.status(410).json({ status: "expired", error: "Havola allaqachon ishlatilgan" });
    const user = await findOrCreateUser(claimed.phone, claimed.full_name);
    if (isAdminUser(user)) return res.status(403).json({ error: "Admin akkaunt faqat parol bilan kiradi" });
    await respondWithAuthUser(req, res, user);
  }

  function registerRoutes(app) {
    const wrap = (handler) => (req, res) =>
      handler(req, res).catch((error) => {
        console.error("[telegram] so'rov xatosi:", error?.message || error);
        if (!res.headersSent) res.status(500).json({ error: "Server xatosi" });
      });
    app.get("/api/auth/telegram/config", (_req, res) => res.json({ codeEnabled, loginEnabled }));
    app.post("/api/auth/telegram/request-code", wrap(handleRequestCode));
    app.post("/api/auth/telegram/verify-code", wrap(handleVerifyCode));
    app.post("/api/auth/telegram/oidc/start", wrap(handleOidcStart));
    app.get("/api/auth/telegram/oidc/callback", wrap(handleOidcCallback));
    app.get("/api/auth/telegram/oidc/status", wrap(handleOidcStatus));
  }

  return { codeEnabled, loginEnabled, ensureTables, registerRoutes };
}

module.exports = { createTelegramAuth };
