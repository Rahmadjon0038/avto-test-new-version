// Telegramning RASMIY xizmatlari orqali kirish (o'z botimiz xabar yuborishi shart emas):
//
//  1) Telegram Gateway (https://core.telegram.org/gateway/api): telefon raqamga tasdiqlash kodi
//     Telegramning rasmiy "Verification Codes" akkauntidan keladi (SMS o'rniga). Kodni Telegramning
//     o'zi tekshiradi (checkVerificationStatus).
//  2) "Log in with Telegram" (OpenID Connect, https://core.telegram.org/bots/telegram-login):
//     foydalanuvchi Telegram ilovasida tasdiqlaydi, backend id_token ichidan telefon raqamni oladi.
//     Mobil ilova brauzer/Telegramni ochadi va natijani `state` bo'yicha so'rab (polling) sessiyani oladi.
//  3) Bot orqali kirish (BEPUL): ilova t.me/<bot>?start=<state> ni ochadi, foydalanuvchi botda
//     "Start" va "Kirish" tugmasini bosadi, bot "muvaffaqiyatli kirdingiz" deb yozadi, ilova esa
//     `state` bo'yicha so'rab (polling) kirib oladi. Foydalanuvchi Telegram ID (users.telegram_id)
//     bilan aniqlanadi, telefon raqam so'ralmaydi. Bot yangilanishlari webhook orqali keladi:
//     POST /api/auth/telegram/bot/webhook.
//
// .env:
//   TELEGRAM_BOT_TOKEN            — BotFather bergan bot tokeni (bot orqali kirish uchun)
//   TELEGRAM_BOT_USERNAME         — ixtiyoriy (bo'sh bo'lsa getMe orqali olinadi)
//   TELEGRAM_BOT_WEBHOOK_URL      — ixtiyoriy (standart: <PUBLIC_API_BASE_URL>/api/auth/telegram/bot/webhook)
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
  // Docker ichida PUBLIC_API_BASE_URL ichki manzil (http://backend:4000) bo'ladi: Telegram uchun (webhook,
  // OIDC redirect) u yaroqsiz, faqat ochiq https manzil ishlatiladi.
  const configuredBase = String(env.PUBLIC_API_BASE_URL || env.BACKEND_URL || "").replace(/\/+$/, "");
  const publicApiBase = /^https:\/\//i.test(configuredBase) ? configuredBase : "https://api.topshirdi.uz";
  const oidcRedirectUri = String(env.TELEGRAM_OIDC_REDIRECT_URI || `${publicApiBase}/api/auth/telegram/oidc/callback`);
  const botToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  let botUsername = String(env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "").trim();
  const botApiBase = String(env.TELEGRAM_BOT_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
  const botWebhookUrl = String(env.TELEGRAM_BOT_WEBHOOK_URL || `${publicApiBase}/api/auth/telegram/bot/webhook`);
  // Telegram har bir webhook so'rovida shu maxfiy qiymatni qaytaradi: begona so'rovlarni ajratish uchun.
  const botWebhookSecret = botToken
    ? crypto.createHmac("sha256", String(secret || "telegram")).update(botToken).digest("hex").slice(0, 48)
    : "";
  const isBotReady = () => Boolean(botToken && botUsername);
  const configuredSite = String(env.BASE_URL || env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");
  const siteUrl = /^https:\/\//i.test(configuredSite) ? configuredSite : "https://topshirdi.uz";
  // Botdagi admin(lar): Telegram ID'lar (vergul bilan). Faqat ular "Reklama yuborish" menyusini ko'radi.
  const botAdminIds = new Set(
    String(env.TELEGRAM_ADMIN_IDS || "7013085087")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const isBotAdmin = (telegramId) => botAdminIds.has(String(telegramId));
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
    // Bot orqali kirishda shu jadval ham ishlatiladi (code_verifier = 'bot').
    await dbApi.run(`ALTER TABLE telegram_oidc_states ADD COLUMN IF NOT EXISTS tg_user_id BIGINT;`);
    await dbApi.run(`ALTER TABLE telegram_oidc_states ADD COLUMN IF NOT EXISTS chat_id BIGINT;`);
    // Kirish qayerdan boshlangan: 'web' (sayt) yoki 'app' (mobil ilova) — bot "qaytish" tugmasini shunga qarab beradi.
    await dbApi.run(`ALTER TABLE telegram_oidc_states ADD COLUMN IF NOT EXISTS source TEXT;`);
    await dbApi.run(`CREATE INDEX IF NOT EXISTS telegram_oidc_states_tg_user_idx ON telegram_oidc_states (tg_user_id, id DESC);`);
    // Bot orqali kirgan foydalanuvchilar Telegram ID bilan aniqlanadi (telefon keyinroq, kerak bo'lsa, ulanadi).
    await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT;`);
    await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_key ON users (telegram_id);`);
  }

  async function findOrCreateUser(phone, fullName) {
    const existing = await dbApi.get("SELECT * FROM users WHERE phone = ?", [phone]);
    if (existing) return existing;
    return dbApi.get(
      "INSERT INTO users (full_name, phone) VALUES (?, ?) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING *",
      [String(fullName || "").trim() || null, phone]
    );
  }

  // Telegram ismi saqlanmaydi: ism bo'sh qoladi (ilovada standart nom), foydalanuvchi xohlasa o'zi yozadi.
  async function findOrCreateTelegramUser(telegramId, fullName) {
    const existing = await dbApi.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
    if (existing) return existing;
    return dbApi.get(
      "INSERT INTO users (full_name, telegram_id) VALUES (?, ?) ON CONFLICT (telegram_id) DO UPDATE SET telegram_id = EXCLUDED.telegram_id RETURNING *",
      [String(fullName || "").trim() || null, telegramId]
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
    if (!loginEnabled && !botToken) return res.status(503).json({ error: "Telegram orqali kirish hozircha sozlanmagan" });
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
    const user =
      claimed.code_verifier === "bot"
        ? await findOrCreateTelegramUser(claimed.tg_user_id, null)
        : await findOrCreateUser(claimed.phone, claimed.full_name);
    if (isAdminUser(user)) return res.status(403).json({ error: "Admin akkaunt faqat parol bilan kiradi" });
    await respondWithAuthUser(req, res, user);
  }

  // --- Bot orqali kirish --------------------------------------------------------------------
  async function botApi(method, body) {
    const response = await fetch(`${botApiBase}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => null);
    if (!data?.ok) throw new Error(data?.description || `Bot API ${method} xatosi (${response.status})`);
    return data.result;
  }

  async function botSend(chatId, text, replyMarkup) {
    try {
      await botApi("sendMessage", {
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {})
      });
    } catch (error) {
      console.error("[telegram] bot xabar yubormadi:", error?.message || error);
    }
  }

  // Botni ishga tushirish: username'ni aniqlaydi va webhook'ni ro'yxatdan o'tkazadi.
  async function startBot() {
    if (!botToken) return;
    try {
      if (!botUsername) botUsername = String((await botApi("getMe"))?.username || "").trim();
      await botApi("setWebhook", {
        url: botWebhookUrl,
        secret_token: botWebhookSecret,
        allowed_updates: ["message", "callback_query"]
      });
      console.log(`[telegram] bot @${botUsername} tayyor, webhook: ${botWebhookUrl}`);
    } catch (error) {
      console.error("[telegram] bot ishga tushmadi:", error?.message || error);
    }
  }

  async function handleBotStart(req, res) {
    if (!isBotReady()) return res.status(503).json({ error: "Telegram bot orqali kirish hozircha sozlanmagan" });
    if (!limiter.hit(`bot-ip:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }
    const state = crypto.randomBytes(24).toString("hex");
    const source = req.body?.source === "web" ? "web" : "app";
    await dbApi.run("INSERT INTO telegram_oidc_states (state_hash, code_verifier, source, expires_at) VALUES (?, 'bot', ?, ?)", [
      sha(state),
      source,
      new Date(Date.now() + OIDC_TTL_MS).toISOString()
    ]);
    res.json({ ok: true, state, authUrl: `https://t.me/${botUsername}?start=${state}`, expiresIn: OIDC_TTL_MS / 1000 });
  }

  const NO_KEYBOARD = { remove_keyboard: true };
  const HELP_TEXT = "Topshirdi ilovasini oching va «Telegram orqali kirish» tugmasini bosing — shunda shu yerga qaytib kelasiz.";

  async function handleBotStartCommand(message, payload) {
    const chatId = message.chat.id;
    if (!/^[a-f0-9]{48}$/.test(payload)) return botSend(chatId, HELP_TEXT, NO_KEYBOARD);
    const row = await dbApi.get("SELECT * FROM telegram_oidc_states WHERE state_hash = ? AND code_verifier = 'bot'", [sha(payload)]);
    if (!row || row.status !== "pending" || new Date(row.expires_at).getTime() < Date.now()) {
      return botSend(chatId, "Havola eskirgan yoki allaqachon ishlatilgan. Ilovada «Telegram orqali kirish» tugmasini qaytadan bosing.", NO_KEYBOARD);
    }
    await dbApi.run("UPDATE telegram_oidc_states SET tg_user_id = ?, chat_id = ? WHERE id = ?", [message.from.id, chatId, row.id]);
    return botSend(
      chatId,
      row.source === "web" ? "Topshirdi saytiga kirish uchun «Kirish» tugmasini bosing." : "Topshirdi ilovasiga kirish uchun «Kirish» tugmasini bosing.",
      { inline_keyboard: [[{ text: "✅ Kirish", callback_data: `login:${payload}` }]] }
    );
  }

  async function handleBotCallback(query) {
    const answer = (text) => botApi("answerCallbackQuery", { callback_query_id: query.id, ...(text ? { text, show_alert: true } : {}) }).catch(() => {});
    const match = /^login:([a-f0-9]{48})$/.exec(String(query.data || ""));
    if (!match) return answer();
    const row = await dbApi.get("SELECT * FROM telegram_oidc_states WHERE state_hash = ? AND code_verifier = 'bot'", [sha(match[1])]);
    const valid =
      row &&
      row.status === "pending" &&
      new Date(row.expires_at).getTime() > Date.now() &&
      String(row.tg_user_id) === String(query.from.id);
    if (!valid) return answer("Havola eskirgan yoki allaqachon ishlatilgan. Ilovada qaytadan urinib ko‘ring.");
    const done = await dbApi.get(
      "UPDATE telegram_oidc_states SET status = 'done' WHERE id = ? AND status = 'pending' RETURNING id",
      [row.id]
    );
    if (!done) return answer("Havola allaqachon ishlatilgan.");
    await answer();
    const chatId = query.message?.chat?.id;
    if (chatId && query.message?.message_id) {
      // Kirish qayerdan boshlangan bo'lsa, o'sha yerga qaytaruvchi tugma: saytga yoki ilovaga.
      // Ilova tugmasi sayt sahifasiga (/open) olib boradi, u esa ilovani ochadi (topshirdi:// manzili orqali).
      const isWeb = row.source === "web";
      await botApi("editMessageText", {
        chat_id: chatId,
        message_id: query.message.message_id,
        text: isWeb
          ? "✅ Muvaffaqiyatli kirildi!\n\nSaytga qayting — kirish avtomatik bajariladi."
          : "✅ Muvaffaqiyatli kirildi!\n\nIlovaga qayting — kirish avtomatik bajariladi.",
        reply_markup: {
          inline_keyboard: [[{ text: isWeb ? "🌐 Saytga qaytish" : "📱 Ilovaga qaytish", url: isWeb ? `${siteUrl}/app` : `${siteUrl}/open` }]]
        }
      }).catch(() => {});
    }
  }

  // --- Admin: reklama yuborish ---------------------------------------------------------------
  // Oqim: admin "📢 Reklama yuborish" ni bosadi -> xabarni (matn/rasm/video) yuboradi -> bot uni admin'ga
  // ko'rsatib, "Yuborish" tasdig'ini so'raydi -> tasdiqlansa botni ishlatgan hamma foydalanuvchilarga nusxa yuboriladi.
  const BROADCAST_BUTTON = "📢 Reklama yuborish";
  const ADMIN_KEYBOARD = { keyboard: [[{ text: BROADCAST_BUTTON }]], resize_keyboard: true, is_persistent: true };
  const broadcastDrafts = new Map(); // adminId -> { step: "await" } | { step: "confirm", id, messageId, chatId, count }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Botga yozgan (chat ochgan) hamma foydalanuvchi: Telegram orqali kirganlar va botni ochganlar. Adminlar chiqarib tashlanadi.
  async function listBroadcastRecipients() {
    const rows = await dbApi.all(
      `SELECT DISTINCT id FROM (
         SELECT telegram_id AS id FROM users WHERE telegram_id IS NOT NULL
         UNION
         SELECT chat_id AS id FROM telegram_oidc_states WHERE chat_id IS NOT NULL
       ) recipients`
    );
    return rows.map((row) => String(row.id)).filter((id) => !botAdminIds.has(id));
  }

  async function copyToChat(chatId, fromChatId, messageId) {
    try {
      await botApi("copyMessage", { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId });
    } catch (error) {
      // Telegram tezlikni cheklasa ("retry after N"), ko'rsatilgan vaqt kutib, bir marta qayta uriniladi.
      const wait = /retry after (\d+)/i.exec(String(error?.message || ""));
      if (!wait) throw error;
      await sleep((Number(wait[1]) + 1) * 1000);
      await botApi("copyMessage", { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId });
    }
  }

  async function runBroadcast(draft, adminChatId) {
    const recipients = await listBroadcastRecipients();
    let delivered = 0;
    let failed = 0;
    for (const id of recipients) {
      try {
        await copyToChat(id, draft.chatId, draft.messageId);
        delivered += 1;
      } catch {
        failed += 1; // bot bloklangan yoki chat yopilgan
      }
      await sleep(50); // Telegram chegarasi (~30 xabar/soniya) ichida qolish uchun
    }
    console.log(`[telegram] reklama yuborildi: ${delivered} ta yetkazildi, ${failed} ta yetkazilmadi`);
    await botSend(
      adminChatId,
      `✅ Reklama yuborildi.\n\nYetkazildi: ${delivered}\nYetkazilmadi: ${failed} (bot bloklangan yoki chat yopilgan)`,
      ADMIN_KEYBOARD
    );
  }

  // true qaytarsa, xabar admin oqimida ishlatilgan (oddiy bot javobi berilmaydi).
  async function handleAdminMessage(message) {
    const chatId = message.chat.id;
    const adminId = String(message.from.id);
    const text = String(message.text || "").trim();
    const draft = broadcastDrafts.get(adminId);

    if (/^\/(?:start|admin)(?:@\w+)?$/.test(text)) {
      broadcastDrafts.delete(adminId);
      await botSend(chatId, "Salom, admin! Reklama yuborish uchun pastdagi tugmani bosing.", ADMIN_KEYBOARD);
      return true;
    }
    if (text === BROADCAST_BUTTON || /^\/broadcast(?:@\w+)?$/.test(text)) {
      broadcastDrafts.set(adminId, { step: "await" });
      await botSend(
        chatId,
        "Reklama xabarini yuboring: matn, rasm yoki video (izoh bilan). U foydalanuvchilarga aynan shu ko‘rinishda boradi.\n\nBekor qilish: /cancel",
        { remove_keyboard: true }
      );
      return true;
    }
    if (/^\/cancel(?:@\w+)?$/.test(text)) {
      broadcastDrafts.delete(adminId);
      await botSend(chatId, "Bekor qilindi.", ADMIN_KEYBOARD);
      return true;
    }
    if (draft?.step === "await") {
      const recipients = await listBroadcastRecipients();
      const id = crypto.randomBytes(6).toString("hex");
      broadcastDrafts.set(adminId, { step: "confirm", id, chatId, messageId: message.message_id, count: recipients.length });
      await botSend(chatId, "Xabar shunday ko‘rinadi:");
      await copyToChat(chatId, chatId, message.message_id).catch(() => botSend(chatId, "(xabarni ko‘rsatib bo‘lmadi)"));
      await botSend(chatId, `Jami ${recipients.length} ta foydalanuvchiga yuboriladi. Tasdiqlaysizmi?`, {
        inline_keyboard: [
          [
            { text: `✅ Yuborish (${recipients.length})`, callback_data: `bc:go:${id}` },
            { text: "❌ Bekor qilish", callback_data: `bc:no:${id}` }
          ]
        ]
      });
      return true;
    }
    return false;
  }

  async function handleBroadcastCallback(query) {
    const answer = (text) => botApi("answerCallbackQuery", { callback_query_id: query.id, ...(text ? { text, show_alert: true } : {}) }).catch(() => {});
    const adminId = String(query.from.id);
    const match = /^bc:(go|no):([a-f0-9]{12})$/.exec(String(query.data || ""));
    if (!match || !isBotAdmin(adminId)) return answer();
    const draft = broadcastDrafts.get(adminId);
    if (!draft || draft.step !== "confirm" || draft.id !== match[2]) {
      return answer("Bu so‘rov eskirgan. Reklamani qaytadan boshlang.");
    }
    broadcastDrafts.delete(adminId); // ikki marta yuborilmasin
    const chatId = query.message?.chat?.id || draft.chatId;
    await answer();
    if (match[1] === "no") return botSend(chatId, "Bekor qilindi.", ADMIN_KEYBOARD);
    await botSend(chatId, `Yuborilmoqda: ${draft.count} ta foydalanuvchi. Tugagach xabar beraman.`, ADMIN_KEYBOARD);
    // Uzoq davom etishi mumkin: webhook javobini kutdirmaslik uchun fonda ishlaydi.
    void runBroadcast(draft, chatId).catch((error) => {
      console.error("[telegram] reklama xatosi:", error?.message || error);
      void botSend(chatId, "Reklama yuborishda xatolik yuz berdi. Loglarni tekshiring.", ADMIN_KEYBOARD);
    });
  }

  async function processBotUpdate(update) {
    if (update?.callback_query?.from?.id) {
      if (!limiter.hit(`bot-user:${update.callback_query.from.id}`, 30, 10 * 60 * 1000)) return;
      if (String(update.callback_query.data || "").startsWith("bc:")) return handleBroadcastCallback(update.callback_query);
      return handleBotCallback(update.callback_query);
    }
    const message = update?.message;
    if (!message || message.chat?.type !== "private" || !message.from?.id) return;
    if (!limiter.hit(`bot-user:${message.from.id}`, 30, 10 * 60 * 1000)) return;
    if (isBotAdmin(message.from.id) && (await handleAdminMessage(message))) return;
    const match = /^\/start(?:@\w+)?(?:\s+(\S+))?$/.exec(String(message.text || "").trim());
    if (match) return handleBotStartCommand(message, match[1] || "");
    return botSend(message.chat.id, HELP_TEXT, NO_KEYBOARD);
  }

  async function handleBotWebhook(req, res) {
    const given = Buffer.from(String(req.headers["x-telegram-bot-api-secret-token"] || ""));
    const expected = Buffer.from(botWebhookSecret);
    if (!botToken || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
      return res.sendStatus(403);
    }
    // Telegram'ga darrov javob beramiz (qayta yuborishni oldini olish), ishlov keyin.
    res.sendStatus(200);
    try {
      await processBotUpdate(req.body);
    } catch (error) {
      console.error("[telegram] bot yangilanishi xatosi:", error?.message || error);
    }
  }

  function registerRoutes(app) {
    const wrap = (handler) => (req, res) =>
      handler(req, res).catch((error) => {
        console.error("[telegram] so'rov xatosi:", error?.message || error);
        if (!res.headersSent) res.status(500).json({ error: "Server xatosi" });
      });
    app.get("/api/auth/telegram/config", (_req, res) => res.json({ codeEnabled, loginEnabled, botEnabled: isBotReady() }));
    app.post("/api/auth/telegram/request-code", wrap(handleRequestCode));
    app.post("/api/auth/telegram/verify-code", wrap(handleVerifyCode));
    app.post("/api/auth/telegram/oidc/start", wrap(handleOidcStart));
    app.get("/api/auth/telegram/oidc/callback", wrap(handleOidcCallback));
    app.get("/api/auth/telegram/oidc/status", wrap(handleOidcStatus));
    app.post("/api/auth/telegram/bot/start", wrap(handleBotStart));
    app.get("/api/auth/telegram/bot/status", wrap(handleOidcStatus));
    app.post("/api/auth/telegram/bot/webhook", wrap(handleBotWebhook));
  }

  return { codeEnabled, loginEnabled, ensureTables, registerRoutes, startBot };
}

module.exports = { createTelegramAuth };
