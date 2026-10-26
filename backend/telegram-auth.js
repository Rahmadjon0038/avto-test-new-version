// Telegram bot orqali kirish.
//
// Ikki usul:
//  1) Kod bilan: ilova telefon raqamni yuboradi -> bot Telegramga 6 xonali kod yuboradi -> ilova kodni
//     tasdiqlaydi. (Bot faqat o'z raqamini ulashgan foydalanuvchiga yoza oladi, shuning uchun raqam
//     birinchi marta botda "Kontakt yuborish" tugmasi orqali bog'lanadi.)
//  2) "Telegram orqali kirish": ilova bir martalik token oladi, Telegramda bot havolasi ochiladi,
//     foydalanuvchi "Tasdiqlash"ni bosadi, ilova tokenni so'rab (polling) sessiyani oladi.
//
// Sozlash (.env): TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME (@ siz). Sozlanmagan bo'lsa endpointlar
// 503 qaytaradi va hech narsa ishga tushmaydi.
const crypto = require("crypto");

const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const CODE_COOLDOWN_MS = 45 * 1000;
const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000;

function createRateLimiter() {
  const buckets = new Map();
  // key uchun `windowMs` ichida ko'pi bilan `max` ta harakat.
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
  // Xotira cheksiz o'smasligi uchun eskirgan kalitlar vaqti-vaqti bilan tozalanadi.
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

function createTelegramAuth({ dbApi, normalizeUzPhone, respondWithAuthUser, secret, env = process.env }) {
  const botToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  const botUsername = String(env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  const apiBase = String(env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/+$/, "");
  const enabled = Boolean(botToken && botUsername);
  const limiter = createRateLimiter();
  // phone -> vaqt: kod so'ralgan, lekin raqam hali botga ulanmagan. Ulangach kod avtomatik yuboriladi.
  const pendingCodeRequests = new Map();

  const hmac = (value) => crypto.createHmac("sha256", String(secret || "topshirdi")).update(String(value)).digest("hex");
  const safeEqual = (a, b) => {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  };
  const botUrl = (payload) => `https://t.me/${botUsername}${payload ? `?start=${payload}` : ""}`;

  async function tg(method, body, { timeoutMs = 15000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase}/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      });
      const data = await response.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.description || `Telegram ${method} xatosi (${response.status})`);
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensureTables() {
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS telegram_accounts (
        telegram_id BIGINT PRIMARY KEY,
        chat_id BIGINT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        first_name TEXT,
        username TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS login_codes (
        id BIGSERIAL PRIMARY KEY,
        phone TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        consumed BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await dbApi.run(`CREATE INDEX IF NOT EXISTS login_codes_phone_idx ON login_codes (phone, created_at DESC);`);
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS telegram_login_tokens (
        id BIGSERIAL PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        telegram_id BIGINT,
        phone TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Raqami hali bog'lanmagan foydalanuvchi "Telegram orqali kirish"ni bosganda token shu yerda kutadi.
    await dbApi.run(`
      CREATE TABLE IF NOT EXISTS telegram_pending_logins (
        telegram_id BIGINT PRIMARY KEY,
        token_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  }

  // --- Kod yaratish va yuborish -----------------------------------------------------------
  async function issueAndSendCode(account) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    await dbApi.run("UPDATE login_codes SET consumed = TRUE WHERE phone = ? AND consumed = FALSE", [account.phone]);
    await dbApi.run("INSERT INTO login_codes (phone, code_hash, expires_at) VALUES (?, ?, ?)", [
      account.phone,
      hmac(`${account.phone}:${code}`),
      new Date(Date.now() + CODE_TTL_MS).toISOString()
    ]);
    await tg("sendMessage", {
      chat_id: Number(account.chat_id),
      parse_mode: "HTML",
      text:
        `🔐 <b>Topshirdi</b> tasdiqlash kodi: <code>${code}</code>\n\n` +
        `Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.`
    });
  }

  async function findAccountByPhone(phone) {
    return dbApi.get("SELECT * FROM telegram_accounts WHERE phone = ?", [phone]);
  }

  async function findOrCreateUser(phone, fallbackName) {
    let user = await dbApi.get("SELECT * FROM users WHERE phone = ?", [phone]);
    if (user) return user;
    user = await dbApi.get(
      "INSERT INTO users (full_name, phone) VALUES (?, ?) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING *",
      [String(fallbackName || "").trim() || null, phone]
    );
    return user;
  }

  function isAdminUser(user) {
    return Boolean(user && (user.is_admin === true || String(user.id) === "1"));
  }

  // --- HTTP endpointlar -------------------------------------------------------------------
  function requireEnabled(res) {
    if (enabled) return true;
    res.status(503).json({ error: "Telegram orqali kirish hozircha sozlanmagan" });
    return false;
  }

  async function handleRequestCode(req, res) {
    if (!requireEnabled(res)) return;
    let phone;
    try {
      phone = normalizeUzPhone(req.body?.phone);
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Telefon raqam noto‘g‘ri" });
    }
    if (!limiter.hit(`ip:${clientIp(req)}`, 20, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }
    if (!limiter.hit(`cooldown:${phone}`, 1, CODE_COOLDOWN_MS)) {
      return res.status(429).json({ error: "Kod yaqinda yuborilgan. Bir ozdan keyin qayta urinib ko‘ring", retryAfter: 45 });
    }
    if (!limiter.hit(`phone:${phone}`, 5, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Bu raqam uchun urinishlar soni oshib ketdi. 1 soatdan keyin urinib ko‘ring" });
    }

    const account = await findAccountByPhone(phone);
    if (!account) {
      // Raqam hali Telegram botga ulanmagan: foydalanuvchi botni ochib raqamini ulashadi, shundan
      // keyin kod o'zi yuboriladi.
      pendingCodeRequests.set(phone, Date.now());
      return res.json({ ok: true, sent: false, needsTelegram: true, botUrl: botUrl("phone"), expiresIn: PENDING_REQUEST_TTL_MS / 1000 });
    }
    try {
      await issueAndSendCode(account);
    } catch (error) {
      console.error("[telegram] kod yuborilmadi:", error?.message || error);
      return res.status(502).json({ error: "Telegramga kod yuborib bo‘lmadi. Botni to‘xtatmaganingizni tekshiring" });
    }
    res.json({ ok: true, sent: true, needsTelegram: false, expiresIn: CODE_TTL_MS / 1000 });
  }

  async function handleVerifyCode(req, res) {
    if (!requireEnabled(res)) return;
    let phone;
    try {
      phone = normalizeUzPhone(req.body?.phone);
    } catch (error) {
      return res.status(400).json({ error: error?.message || "Telefon raqam noto‘g‘ri" });
    }
    const code = String(req.body?.code || "").replace(/\D/g, "");
    if (code.length !== 6) return res.status(400).json({ error: "Kod 6 ta raqamdan iborat" });
    if (!limiter.hit(`verify-ip:${clientIp(req)}`, 60, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }

    const row = await dbApi.get(
      "SELECT * FROM login_codes WHERE phone = ? AND consumed = FALSE AND expires_at > NOW() ORDER BY id DESC LIMIT 1",
      [phone]
    );
    if (!row) return res.status(400).json({ error: "Kod eskirgan yoki yuborilmagan. Yangi kod so‘rang" });
    if (Number(row.attempts) >= MAX_CODE_ATTEMPTS) {
      await dbApi.run("UPDATE login_codes SET consumed = TRUE WHERE id = ?", [row.id]);
      return res.status(429).json({ error: "Urinishlar soni tugadi. Yangi kod so‘rang" });
    }
    if (!safeEqual(row.code_hash, hmac(`${phone}:${code}`))) {
      await dbApi.run("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?", [row.id]);
      return res.status(400).json({ error: "Kod noto‘g‘ri" });
    }
    // Kod faqat bir marta: atomik "ishlatildi" belgisi (bir vaqtda ikki so'rov o'tib ketmasin).
    const consumed = await dbApi.get("UPDATE login_codes SET consumed = TRUE WHERE id = ? AND consumed = FALSE RETURNING id", [row.id]);
    if (!consumed) return res.status(400).json({ error: "Kod allaqachon ishlatilgan" });

    const account = await findAccountByPhone(phone);
    const user = await findOrCreateUser(phone, account?.first_name);
    if (isAdminUser(user)) {
      return res.status(403).json({ error: "Admin akkaunt faqat parol bilan kiradi" });
    }
    await respondWithAuthUser(req, res, user);
  }

  async function handleStartLogin(req, res) {
    if (!requireEnabled(res)) return;
    if (!limiter.hit(`start-ip:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring" });
    }
    const token = crypto.randomBytes(24).toString("hex");
    await dbApi.run("INSERT INTO telegram_login_tokens (token_hash, expires_at) VALUES (?, ?)", [
      hmac(token),
      new Date(Date.now() + TOKEN_TTL_MS).toISOString()
    ]);
    res.json({ ok: true, token, botUrl: botUrl(`login_${token}`), expiresIn: TOKEN_TTL_MS / 1000 });
  }

  async function handleLoginStatus(req, res) {
    if (!requireEnabled(res)) return;
    const token = String(req.query.token || req.body?.token || "").trim();
    if (!/^[a-f0-9]{48}$/.test(token)) return res.status(400).json({ error: "Token noto‘g‘ri" });
    if (!limiter.hit(`status:${hmac(token).slice(0, 16)}`, 200, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Juda tez-tez so‘ralmoqda" });
    }

    const row = await dbApi.get("SELECT * FROM telegram_login_tokens WHERE token_hash = ?", [hmac(token)]);
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ status: "expired", error: "Havola eskirgan. Qaytadan urinib ko‘ring" });
    }
    if (row.status === "rejected") return res.status(410).json({ status: "rejected", error: "Kirish bekor qilindi" });
    if (row.status === "claimed") return res.status(410).json({ status: "expired", error: "Havola allaqachon ishlatilgan" });
    if (row.status !== "confirmed") return res.json({ ok: true, status: "pending" });

    // Atomik: sessiyani bitta so'rov oladi.
    const claimed = await dbApi.get(
      "UPDATE telegram_login_tokens SET status = 'claimed' WHERE id = ? AND status = 'confirmed' RETURNING *",
      [row.id]
    );
    if (!claimed) return res.status(410).json({ status: "expired", error: "Havola allaqachon ishlatilgan" });

    const account = await dbApi.get("SELECT * FROM telegram_accounts WHERE telegram_id = ?", [claimed.telegram_id]);
    const phone = claimed.phone || account?.phone;
    if (!phone) return res.status(400).json({ error: "Telefon raqam topilmadi" });
    const user = await findOrCreateUser(phone, account?.first_name);
    if (isAdminUser(user)) return res.status(403).json({ error: "Admin akkaunt faqat parol bilan kiradi" });
    await respondWithAuthUser(req, res, user);
  }

  // --- Bot (long polling) -----------------------------------------------------------------
  const contactKeyboard = {
    keyboard: [[{ text: "📱 Raqamni yuborish", request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true
  };

  async function send(chatId, text, extra = {}) {
    return tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
  }

  async function askLoginConfirmation(chatId, tokenRow) {
    await send(chatId, "Topshirdi ilovasiga kirishni tasdiqlaysizmi?\n\nBu so‘rovni siz yubormagan bo‘lsangiz, <b>Bekor qilish</b> ni bosing.", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Tasdiqlash", callback_data: `ok:${tokenRow.id}` },
            { text: "✖️ Bekor qilish", callback_data: `no:${tokenRow.id}` }
          ]
        ]
      }
    });
  }

  async function findLiveToken(tokenPlain) {
    if (!/^[a-f0-9]{48}$/.test(tokenPlain)) return null;
    return dbApi.get(
      "SELECT * FROM telegram_login_tokens WHERE token_hash = ? AND status = 'pending' AND expires_at > NOW()",
      [hmac(tokenPlain)]
    );
  }

  async function handleStartCommand(message, payload) {
    const chatId = message.chat.id;
    const fromId = message.from.id;
    const account = await dbApi.get("SELECT * FROM telegram_accounts WHERE telegram_id = ?", [fromId]);

    if (payload.startsWith("login_")) {
      const tokenRow = await findLiveToken(payload.slice(6));
      if (!tokenRow) return send(chatId, "Bu havola eskirgan. Ilovada qaytadan «Telegram orqali kirish» ni bosing.");
      if (account) return askLoginConfirmation(chatId, tokenRow);
      await dbApi.run(
        "INSERT INTO telegram_pending_logins (telegram_id, token_id) VALUES (?, ?) ON CONFLICT (telegram_id) DO UPDATE SET token_id = EXCLUDED.token_id, created_at = NOW()",
        [fromId, tokenRow.id]
      );
      return send(chatId, "Kirish uchun telefon raqamingizni tasdiqlang. Pastdagi tugmani bosing 👇", { reply_markup: contactKeyboard });
    }

    if (account) {
      return send(chatId, "Raqamingiz allaqachon bog‘langan ✅\nIlovada telefon raqamingizni kiritib, kodni oling yoki «Telegram orqali kirish» tugmasidan foydalaning.");
    }
    return send(chatId, "Salom! Topshirdi ilovasiga Telegram orqali kirish uchun telefon raqamingizni tasdiqlang 👇", { reply_markup: contactKeyboard });
  }

  async function handleContact(message) {
    const chatId = message.chat.id;
    const contact = message.contact;
    // Faqat o'z raqami: boshqa odamning kontaktini yuborib akkauntni egallashning oldini oladi.
    if (!contact || Number(contact.user_id) !== Number(message.from.id)) {
      return send(chatId, "Iltimos, faqat o‘zingizning raqamingizni tugma orqali yuboring 👇", { reply_markup: contactKeyboard });
    }
    let phone;
    try {
      phone = normalizeUzPhone(contact.phone_number);
    } catch {
      return send(chatId, "Hozircha faqat O‘zbekiston (+998) raqamlari qo‘llab-quvvatlanadi.", { reply_markup: { remove_keyboard: true } });
    }
    const fullName = [message.from.first_name, message.from.last_name].filter(Boolean).join(" ");
    // Bitta raqam — bitta Telegram akkaunt: eski bog'lanish (agar boshqa akkauntda bo'lsa) almashtiriladi.
    await dbApi.run("DELETE FROM telegram_accounts WHERE phone = ? AND telegram_id <> ?", [phone, message.from.id]);
    const account = await dbApi.get(
      `INSERT INTO telegram_accounts (telegram_id, chat_id, phone, first_name, username)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (telegram_id) DO UPDATE SET chat_id = EXCLUDED.chat_id, phone = EXCLUDED.phone,
         first_name = EXCLUDED.first_name, username = EXCLUDED.username, updated_at = NOW()
       RETURNING *`,
      [message.from.id, chatId, phone, fullName || null, message.from.username || null]
    );
    await send(chatId, "Raqamingiz tasdiqlandi ✅", { reply_markup: { remove_keyboard: true } });

    const pending = await dbApi.get(
      "SELECT t.* FROM telegram_pending_logins p JOIN telegram_login_tokens t ON t.id = p.token_id WHERE p.telegram_id = ? AND t.status = 'pending' AND t.expires_at > NOW()",
      [message.from.id]
    );
    await dbApi.run("DELETE FROM telegram_pending_logins WHERE telegram_id = ?", [message.from.id]);
    if (pending) return askLoginConfirmation(chatId, pending);

    const requestedAt = pendingCodeRequests.get(phone);
    if (requestedAt && Date.now() - requestedAt < PENDING_REQUEST_TTL_MS) {
      pendingCodeRequests.delete(phone);
      await issueAndSendCode(account);
    } else {
      await send(chatId, "Endi ilovaga qaytib, telefon raqamingiz uchun kod so‘rang.");
    }
  }

  async function handleCallback(query) {
    const [action, idRaw] = String(query.data || "").split(":");
    const chatId = query.message?.chat?.id;
    const tokenId = Number(idRaw);
    if (!["ok", "no"].includes(action) || !Number.isFinite(tokenId)) {
      return tg("answerCallbackQuery", { callback_query_id: query.id });
    }
    const account = await dbApi.get("SELECT * FROM telegram_accounts WHERE telegram_id = ?", [query.from.id]);
    if (action === "no") {
      await dbApi.run("UPDATE telegram_login_tokens SET status = 'rejected' WHERE id = ? AND status = 'pending'", [tokenId]);
      await tg("answerCallbackQuery", { callback_query_id: query.id, text: "Bekor qilindi" });
      if (chatId) await send(chatId, "Kirish bekor qilindi.");
      return;
    }
    if (!account) {
      await tg("answerCallbackQuery", { callback_query_id: query.id, text: "Avval raqamingizni tasdiqlang" });
      return;
    }
    const updated = await dbApi.get(
      "UPDATE telegram_login_tokens SET status = 'confirmed', telegram_id = ?, phone = ? WHERE id = ? AND status = 'pending' AND expires_at > NOW() RETURNING id",
      [query.from.id, account.phone, tokenId]
    );
    await tg("answerCallbackQuery", { callback_query_id: query.id, text: updated ? "Tasdiqlandi" : "Havola eskirgan" });
    if (chatId) {
      await send(chatId, updated ? "Tasdiqlandi ✅ Ilovaga qayting — kirish avtomatik bajariladi." : "Bu havola eskirgan. Ilovada qaytadan urinib ko‘ring.");
    }
  }

  async function handleUpdate(update) {
    const message = update.message;
    if (update.callback_query) return handleCallback(update.callback_query);
    if (!message || message.chat?.type !== "private" || !message.from || message.from.is_bot) return;
    if (message.contact) return handleContact(message);
    const text = String(message.text || "").trim();
    if (text.startsWith("/start")) return handleStartCommand(message, text.slice(6).trim());
    return send(message.chat.id, "Topshirdi ilovasiga kirish uchun /start ni bosing.");
  }

  let polling = false;
  async function startPolling() {
    if (!enabled || polling) return;
    polling = true;
    let offset = 0;
    console.log(`[telegram] bot ishga tushdi: @${botUsername}`);
    // Webhook o'rnatilgan bo'lsa getUpdates ishlamaydi; bu bot faqat shu backend uchun.
    await tg("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    while (polling) {
      try {
        const updates = await tg("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, { timeoutMs: 35000 });
        for (const update of updates || []) {
          offset = Math.max(offset, Number(update.update_id) + 1);
          try {
            await handleUpdate(update);
          } catch (error) {
            console.error("[telegram] update xatosi:", error?.message || error);
          }
        }
      } catch (error) {
        console.error("[telegram] polling xatosi:", error?.message || error);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  function stopPolling() {
    polling = false;
  }

  function registerRoutes(app) {
    const wrap = (handler) => (req, res) =>
      handler(req, res).catch((error) => {
        console.error("[telegram] so'rov xatosi:", error?.message || error);
        if (!res.headersSent) res.status(500).json({ error: "Server xatosi" });
      });
    app.post("/api/auth/telegram/request-code", wrap(handleRequestCode));
    app.post("/api/auth/telegram/verify-code", wrap(handleVerifyCode));
    app.post("/api/auth/telegram/start", wrap(handleStartLogin));
    app.get("/api/auth/telegram/status", wrap(handleLoginStatus));
    // Ilova sozlamani bilib olishi uchun (tugmani ko'rsatish yoki yashirish).
    app.get("/api/auth/telegram/config", (_req, res) => res.json({ enabled, botUsername: enabled ? botUsername : null }));
  }

  return { enabled, ensureTables, registerRoutes, startPolling, stopPolling, _handleUpdate: handleUpdate };
}

module.exports = { createTelegramAuth };
