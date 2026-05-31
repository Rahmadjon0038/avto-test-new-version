require("dotenv").config();

const express = require("express");
const path = require("path");
const { openDb, initDb } = require("./db");
const { tickets } = require("./data/tickets");
const { validateInitData } = require("./telegramAuth");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || "./db.sqlite";

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const dbApi = openDb(DB_PATH);

app.get("/img", async (req, res) => {
  const fallback = "/placeholder.svg";
  try {
    const u = String(req.query.u || req.query.url || "");
    if (!u) return res.status(400).send("Missing url");

    let parsed;
    try {
      parsed = new URL(u);
    } catch {
      return res.status(400).send("Bad url");
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return res.status(400).send("Bad protocol");
    }

    const r = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        // Some CDNs block unknown/no UA, keep it browser-like.
        "User-Agent": "Mozilla/5.0 (compatible; JoRabekAvtoTest/1.0)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    if (!r.ok) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.redirect(302, fallback);
    }

    const ct = r.headers.get("content-type") || "application/octet-stream";
    if (!ct.startsWith("image/")) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.redirect(302, fallback);
    }
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const ab = await r.arrayBuffer();
    res.send(Buffer.from(ab));
  } catch (e) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.redirect(302, fallback);
  }
});

function isUserPro(user) {
  if (!user?.pro_until) return false;
  return new Date(user.pro_until).getTime() > Date.now();
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function upsertUserFromTelegram(telegramUser) {
  const telegramId = String(telegramUser.id);
  const existing = await dbApi.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);

  if (!existing) {
    await dbApi.run(
      "INSERT INTO users (telegram_id, first_name, username) VALUES (?, ?, ?)",
      [telegramId, telegramUser.first_name || null, telegramUser.username || null]
    );
  } else {
    await dbApi.run("UPDATE users SET first_name = ?, username = ? WHERE telegram_id = ?", [
      telegramUser.first_name || null,
      telegramUser.username || null,
      telegramId
    ]);
  }

  return dbApi.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
}

function requireTelegramUser(req, res, next) {
  const initData = req.headers["x-telegram-init-data"] || req.body?.initData || req.query?.initData;

  if (!initData) {
    const token = req.query?.token;
    if (token) {
      const v = verifyBrowserToken(token);
      if (v.ok) {
        req.telegramUser = v.user;
        setSessionCookie(req, res, v.user);
        return next();
      }
    }
    const sessionUser = getSessionUser(req);
    if (sessionUser?.id) {
      req.telegramUser = sessionUser;
      return next();
    }
    if (process.env.NODE_ENV === "development") {
      // TODO: In production, always require initData.
      const devId = process.env.DEV_TELEGRAM_ID;
      if (!devId) return res.status(401).json({ error: "Missing initData (set DEV_TELEGRAM_ID in dev)" });
      req.telegramUser = { id: Number(devId), first_name: "Dev", username: "dev" };
      return next();
    }
    return res.status(401).json({ error: "Missing initData" });
  }

  const v = validateInitData(String(initData), process.env.BOT_TOKEN);
  if (!v.ok) return res.status(401).json({ error: v.error });
  if (!v.user?.id) return res.status(401).json({ error: "Missing user in initData" });
  req.telegramUser = v.user;
  return next();
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  const parts = header.split(";");
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function base64UrlEncode(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = str.replaceAll("-", "+").replaceAll("_", "/") + pad;
  return Buffer.from(b64, "base64");
}

function signSession(payloadB64) {
  const secret = process.env.SESSION_SECRET || process.env.BOT_TOKEN || "";
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function isSecureRequest(req) {
  if (req.secure) return true;
  const xfProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return xfProto === "https";
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 1 day
const BROWSER_TOKEN_MAX_AGE_SECONDS = 60 * 10; // 10 minutes

function setSessionCookie(req, res, telegramUser) {
  const payload = {
    id: telegramUser.id,
    first_name: telegramUser.first_name || null,
    username: telegramUser.username || null,
    iat: Math.floor(Date.now() / 1000)
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = signSession(payloadB64);
  const value = `${payloadB64}.${sig}`;
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`
  ]);
}

function makeBrowserToken(telegramUser) {
  const payload = {
    id: telegramUser.id,
    first_name: telegramUser.first_name || null,
    username: telegramUser.username || null,
    exp: Math.floor(Date.now() / 1000) + BROWSER_TOKEN_MAX_AGE_SECONDS
  };
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const sig = signSession(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyBrowserToken(token) {
  const raw = String(token || "");
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return { ok: false, error: "Bad token" };
  const expected = signSession(payloadB64);
  if (expected !== sig) return { ok: false, error: "Bad token signature" };
  try {
    const json = base64UrlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(json);
    const exp = Number(payload.exp);
    if (!Number.isFinite(exp)) return { ok: false, error: "Bad token exp" };
    if (Math.floor(Date.now() / 1000) > exp) return { ok: false, error: "Token expired" };
    if (!payload?.id) return { ok: false, error: "Bad token payload" };
    return { ok: true, user: payload };
  } catch {
    return { ok: false, error: "Bad token payload" };
  }
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const raw = cookies.session;
  if (!raw) return null;
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return null;
  const expected = signSession(payloadB64);
  if (expected !== sig) return null;
  try {
    const json = base64UrlDecode(payloadB64).toString("utf8");
    const parsed = JSON.parse(json);
    if (!parsed?.id) return null;
    const iat = Number(parsed.iat);
    if (!Number.isFinite(iat)) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - iat > SESSION_MAX_AGE_SECONDS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validateTelegramLogin(payload, botToken, { maxAgeSeconds = 60 * 60 * 24 } = {}) {
  if (!payload?.hash) return { ok: false, error: "Missing hash" };
  if (!payload?.auth_date) return { ok: false, error: "Missing auth_date" };

  const authDate = Number(payload.auth_date);
  if (!Number.isFinite(authDate)) return { ok: false, error: "Invalid auth_date" };
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - authDate > maxAgeSeconds) return { ok: false, error: "Login data is too old" };

  const data = { ...payload };
  delete data.hash;
  const keys = Object.keys(data).sort();
  const dataCheckString = keys.map((k) => `${k}=${data[k]}`).join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calculatedHash !== payload.hash) return { ok: false, error: "Bad login hash" };

  return { ok: true };
}

app.get("/webapp", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/telegram-login", async (req, res) => {
  const payload = req.body || {};
  if (!process.env.BOT_TOKEN) return res.status(500).json({ error: "Missing BOT_TOKEN" });

  const v = validateTelegramLogin(payload, process.env.BOT_TOKEN);
  if (!v.ok) return res.status(401).json({ error: v.error });
  if (!payload.id) return res.status(400).json({ error: "Missing id" });

  const tgUser = { id: Number(payload.id), first_name: payload.first_name, username: payload.username };
  const user = await upsertUserFromTelegram(tgUser);
  setSessionCookie(req, res, tgUser);
  res.json({ ok: true, user });
});

app.post("/api/auth", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  setSessionCookie(req, res, req.telegramUser);
  res.json({ user, isPro: isUserPro(user) });
});

app.get("/api/me", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  setSessionCookie(req, res, req.telegramUser);
  res.json({ user, isPro: isUserPro(user) });
});

app.post("/api/browser-token", requireTelegramUser, async (req, res) => {
  const token = makeBrowserToken(req.telegramUser);
  res.json({ ok: true, token });
});

app.get("/api/tickets", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  const pro = isUserPro(user);
  const list = tickets.map((t, idx) => {
    const openForFree = idx < 3;
    const locked = !pro && !openForFree;
    return { id: t.id, title: t.title, locked };
  });
  res.json({ tickets: list, isPro: pro });
});

app.get("/api/tickets/:ticketId", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  const pro = isUserPro(user);

  const ticket = tickets.find((t) => t.id === String(req.params.ticketId));
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const idx = tickets.findIndex((t) => t.id === ticket.id);
  const openForFree = idx < 3;
  if (!pro && !openForFree) return res.status(403).json({ error: "Ticket locked. Activate PRO." });

  res.json({ ticket, isPro: pro });
});

app.get("/api/progress/:ticketId", requireTelegramUser, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const ticketId = String(req.params.ticketId);

  const row = await dbApi.get(
    "SELECT * FROM test_progress WHERE telegram_id = ? AND ticket_id = ?",
    [telegramId, ticketId]
  );
  if (!row) return res.json({ progress: null });

  res.json({
    progress: {
      ticketId: row.ticket_id,
      answers: JSON.parse(row.answers || "{}"),
      completed: !!row.completed,
      score: row.score,
      updatedAt: row.updated_at
    }
  });
});

function getAllQuestionsPool() {
  const pool = [];
  for (const t of tickets) {
    for (const q of t.questions) {
      pool.push({
        ticketId: t.id,
        ticketTitle: t.title,
        question: q
      });
    }
  }
  return pool;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function buildExamQuestions(count = 50) {
  const pool = getAllQuestionsPool();
  shuffleInPlace(pool);
  const out = [];
  if (pool.length === 0) return out;

  while (out.length < count) {
    for (const p of pool) {
      out.push({
        ticketId: p.ticketId,
        ticketTitle: p.ticketTitle,
        ...p.question
      });
      if (out.length >= count) break;
    }
  }
  return out.slice(0, count);
}

app.post("/api/exam/start", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  if (!isUserPro(user)) return res.status(403).json({ error: "Imtihon uchun PRO kerak" });

  const telegramId = String(req.telegramUser.id);
  const questions = buildExamQuestions(50);
  if (questions.length !== 50) return res.status(400).json({ error: "Imtihon savollari yetarli emas" });

  const selection = questions.map((q) => ({ ticketId: q.ticketId, questionId: q.id }));
  const payload = { selection, answers: {} };

  await dbApi.run(
    `
    INSERT INTO test_progress (telegram_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, 'exam', ?, 0, 0, datetime('now'))
    ON CONFLICT(telegram_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = 0,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [telegramId, JSON.stringify(payload)]
  );

  res.json({ ok: true, exam: { questionsCount: 50 } });
});

app.get("/api/exam", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  if (!isUserPro(user)) return res.status(403).json({ error: "Imtihon uchun PRO kerak" });

  const telegramId = String(req.telegramUser.id);
  const row = await dbApi.get("SELECT * FROM test_progress WHERE telegram_id = ? AND ticket_id = 'exam'", [
    telegramId
  ]);
  if (!row) return res.status(404).json({ error: "Exam not started" });

  const parsed = JSON.parse(row.answers || "{}");
  const selection = Array.isArray(parsed.selection) ? parsed.selection : [];
  const answers = parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {};

  const pool = getAllQuestionsPool();
  const byKey = new Map(pool.map((p) => [`${p.ticketId}:${p.question.id}`, p]));

  const questions = selection
    .map((s) => {
      const key = `${s.ticketId}:${s.questionId}`;
      const p = byKey.get(key);
      if (!p) return null;
      return { ticketId: p.ticketId, ticketTitle: p.ticketTitle, ...p.question };
    })
    .filter(Boolean);

  res.json({
    exam: {
      questions,
      answers,
      completed: !!row.completed,
      score: row.score,
      updatedAt: row.updated_at
    }
  });
});

app.post("/api/exam/progress", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  if (!isUserPro(user)) return res.status(403).json({ error: "Imtihon uchun PRO kerak" });

  const telegramId = String(req.telegramUser.id);
  const newAnswers = req.body?.answers;
  if (!newAnswers || typeof newAnswers !== "object") return res.status(400).json({ error: "answers object required" });

  const row = await dbApi.get("SELECT * FROM test_progress WHERE telegram_id = ? AND ticket_id = 'exam'", [
    telegramId
  ]);
  if (!row) return res.status(404).json({ error: "Exam not started" });

  const parsed = JSON.parse(row.answers || "{}");
  const selection = Array.isArray(parsed.selection) ? parsed.selection : [];

  const pool = getAllQuestionsPool();
  const byKey = new Map(pool.map((p) => [`${p.ticketId}:${p.question.id}`, p]));

  let correct = 0;
  let answeredCount = 0;
  for (const s of selection) {
    const p = byKey.get(`${s.ticketId}:${s.questionId}`);
    if (!p) continue;
    const a = newAnswers[p.question.id];
    if (a === undefined || a === null) continue;
    answeredCount += 1;
    if (Number(a) === p.question.correctIndex) correct += 1;
  }

  const completed = answeredCount === selection.length && selection.length === 50;
  const payload = { selection, answers: newAnswers };

  await dbApi.run(
    `
    UPDATE test_progress
    SET answers = ?, completed = ?, score = ?, updated_at = ?
    WHERE telegram_id = ? AND ticket_id = 'exam'
  `,
    [JSON.stringify(payload), completed ? 1 : 0, correct, new Date().toISOString(), telegramId]
  );

  res.json({ ok: true, completed, score: correct, total: selection.length });
});

app.post("/api/exam/reset", requireTelegramUser, async (req, res) => {
  const user = await upsertUserFromTelegram(req.telegramUser);
  if (!isUserPro(user)) return res.status(403).json({ error: "Imtihon uchun PRO kerak" });

  const telegramId = String(req.telegramUser.id);
  await dbApi.run("DELETE FROM test_progress WHERE telegram_id = ? AND ticket_id = 'exam'", [telegramId]);
  res.json({ ok: true });
});

app.post("/api/progress/:ticketId", requireTelegramUser, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const ticketId = String(req.params.ticketId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "answers object required" });

  const ticket = tickets.find((t) => t.id === ticketId);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  let correct = 0;
  let answeredCount = 0;
  for (const q of ticket.questions) {
    const a = answers[q.id];
    if (a === undefined || a === null) continue;
    answeredCount += 1;
    if (Number(a) === q.correctIndex) correct += 1;
  }

  const completed = answeredCount === ticket.questions.length;
  const nowIso = new Date().toISOString();

  await dbApi.run(
    `
    INSERT INTO test_progress (telegram_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(telegram_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = excluded.completed,
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
    [telegramId, ticketId, JSON.stringify(answers), completed ? 1 : 0, correct, nowIso]
  );

  res.json({ ok: true, completed, score: correct, total: ticket.questions.length });
});

app.post("/api/progress/:ticketId/reset", requireTelegramUser, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const ticketId = String(req.params.ticketId);

  await dbApi.run(
    `
    INSERT INTO test_progress (telegram_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, 0, 0, datetime('now'))
    ON CONFLICT(telegram_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = 0,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [telegramId, ticketId, JSON.stringify({})]
  );

  res.json({ ok: true });
});

app.post("/api/promo/activate", requireTelegramUser, async (req, res) => {
  const telegramId = String(req.telegramUser.id);
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "Promo code required" });

  const row = await dbApi.get("SELECT * FROM promo_codes WHERE code = ?", [code]);
  if (!row) return res.status(404).json({ error: "Promo code not found" });
  if (String(row.telegram_id) !== telegramId) return res.status(403).json({ error: "Bu promo kod sizga tegishli emas" });
  if (row.activated) return res.status(400).json({ error: "Bu promo kod allaqachon ishlatilgan" });

  const user = await upsertUserFromTelegram(req.telegramUser);
  const currentProUntil = user.pro_until ? new Date(user.pro_until) : null;
  const base = currentProUntil && currentProUntil.getTime() > Date.now() ? currentProUntil : new Date();
  const newProUntil = addDays(base, 30);

  await dbApi.run("UPDATE users SET pro_until = ? WHERE telegram_id = ?", [newProUntil.toISOString(), telegramId]);
  await dbApi.run(
    "UPDATE promo_codes SET activated = 1, expires_at = ? WHERE id = ?",
    [newProUntil.toISOString(), row.id]
  );

  const updatedUser = await dbApi.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
  res.json({ ok: true, user: updatedUser, isPro: isUserPro(updatedUser), proUntil: updatedUser.pro_until });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

async function start() {
  await initDb(dbApi);
  app.listen(PORT, () => {
    console.log(`Web server listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
