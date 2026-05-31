require("dotenv").config();

const crypto = require("crypto");
const { Telegraf, Markup } = require("telegraf");
const { openDb, initDb } = require("./db");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || "");
const ADMIN_USERNAME = String(process.env.ADMIN_USERNAME || "astroCoder1").replace(/^@/, "");
const BASE_URL = process.env.BASE_URL || "";
const CARD_NUMBER = process.env.CARD_NUMBER || "8600 xxxx xxxx xxxx";
const DB_PATH = process.env.DB_PATH || "./db.sqlite";

if (!BOT_TOKEN) {
  console.error("Missing BOT_TOKEN in .env");
  process.exit(1);
}
if (!ADMIN_TELEGRAM_ID) {
  console.error("Missing ADMIN_TELEGRAM_ID in .env");
  process.exit(1);
}
if (!BASE_URL) {
  console.error("Missing BASE_URL in .env (public https url, e.g. ngrok)");
  process.exit(1);
}

const dbApi = openDb(DB_PATH);
const bot = new Telegraf(BOT_TOKEN);

function isAdmin(ctx) {
  return String(ctx.from?.id || "") === ADMIN_TELEGRAM_ID;
}

function supportsWebAppUrl(url) {
  return /^https:\/\//i.test(String(url || ""));
}

function replyMenuKeyboard(admin) {
  if (admin) {
    return Markup.keyboard([["Admin panel"]]).resize().persistent();
  }
  return Markup.keyboard([["Promo kod sotib olish"]]).resize().persistent();
}

function startInlineKeyboard(webappUrl) {
  const webAppSupported = supportsWebAppUrl(webappUrl);
  const btn = webAppSupported
    ? Markup.button.webApp("Testni boshlash", webappUrl)
    : Markup.button.url("🌐 Saytni ochish (local)", webappUrl);
  return Markup.inlineKeyboard([btn]);
}

async function sendStartButton(ctx, webappUrl) {
  await ctx.reply("👇 Web ilovani ochish", startInlineKeyboard(webappUrl));
}

function makePromoCode() {
  // 5-digit numeric code
  return String(Math.floor(10000 + Math.random() * 90000));
}

async function ensureUser(ctx) {
  const u = ctx.from;
  const telegramId = String(u.id);
  const existing = await dbApi.get("SELECT * FROM users WHERE telegram_id = ?", [telegramId]);
  if (!existing) {
    await dbApi.run("INSERT INTO users (telegram_id, first_name, username) VALUES (?, ?, ?)", [
      telegramId,
      u.first_name || null,
      u.username || null
    ]);
  } else {
    await dbApi.run("UPDATE users SET first_name = ?, username = ? WHERE telegram_id = ?", [
      u.first_name || null,
      u.username || null,
      telegramId
    ]);
  }
}

bot.start(async (ctx) => {
  await ensureUser(ctx);
  const webappUrl = `${BASE_URL.replace(/\/$/, "")}/webapp`;
  const startPayload = ctx.startPayload || "";

  if (startPayload === "webapp") {
    if (!supportsWebAppUrl(webappUrl)) {
      await ctx.reply(
        "⚠️ Web App tugmasi faqat HTTPS bilan ishlaydi.\nHozir BASE_URL HTTP bo‘lgani uchun saytni brauzerda oching.",
        replyMenuKeyboard(isAdmin(ctx))
      );
      await ctx.reply("Saytni ochish:", startInlineKeyboard(webappUrl));
      return;
    }
    await ctx.reply(
      "✅ Telegram orqali kirish tayyor.\nEndi “Testni boshlash” tugmasini bosing (Web App).",
      replyMenuKeyboard(isAdmin(ctx))
    );
    await sendStartButton(ctx, webappUrl);
    return;
  }

  if (startPayload === "buy") {
    await ctx.reply(
      `Promo kod sotib olish uchun quyidagi kartaga to‘lov qiling:\n\n${CARD_NUMBER}\n\nKeyin to‘lov screenshotini shu chatga yuboring.\n\nAdmin: @${ADMIN_USERNAME}\n\n(So‘ng web ilovaga qaytish uchun pastdagi tugmani bosing)`,
      startInlineKeyboard(webappUrl)
    );
    return;
  }

  await ctx.reply(isAdmin(ctx) ? "Admin panelga xush kelibsiz." : "Jo‘rabek Avto Test botiga xush kelibsiz!", replyMenuKeyboard(isAdmin(ctx)));
  await sendStartButton(ctx, webappUrl);
});

bot.command("myid", async (ctx) => {
  const telegramId = String(ctx.from?.id || "");
  const username = ctx.from?.username ? `@${ctx.from.username}` : "(no username)";
  await ctx.reply(`Sizning Telegram ID: ${telegramId}\nUsername: ${username}`);
});

bot.command("hide", async (ctx) => {
  await ctx.reply("✅ Tugmalar yopildi. Qayta chiqarish uchun /menu yozing.", Markup.removeKeyboard());
});

bot.command("menu", async (ctx) => {
  const webappUrl = `${BASE_URL.replace(/\/$/, "")}/webapp`;
  await ctx.reply("📋 Menu:", replyMenuKeyboard(isAdmin(ctx)));
  await sendStartButton(ctx, webappUrl);
});

async function sendAdminPanel(ctx) {
  const pendingCountRow = await dbApi.get(
    "SELECT COUNT(*) as cnt FROM promo_requests WHERE status = 'pending'",
    []
  );
  const pendingCount = pendingCountRow?.cnt || 0;

  await ctx.reply(
    `🛠 Admin panel\n\n` +
      `Kutilayotgan promo so‘rovlar: ${pendingCount}\n\n` +
      `Qanday ishlaydi:\n` +
      `1) User "Promo kod sotib olish" -> to‘laydi -> screenshot yuboradi\n` +
      `2) Screenshot shu yerga keladi\n` +
      `3) "Tasdiqlash" bosilsa promo kod avtomatik yaratiladi va userga yuboriladi\n\n` +
      `Quyidagi tugma orqali pending so‘rovlarni ko‘ring:`,
    Markup.inlineKeyboard([Markup.button.callback("📥 Pending so‘rovlar", "admin:pending")])
  );
}

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Bu bo‘lim faqat admin uchun.");
  await sendAdminPanel(ctx);
});

bot.hears("Admin panel", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Bu bo‘lim faqat admin uchun.");
  await sendAdminPanel(ctx);
});

bot.action("admin:pending", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("Not allowed");

  const rows = await dbApi.all(
    `
    SELECT telegram_id, screenshot_file_id, created_at
    FROM promo_requests
    WHERE status = 'pending'
    ORDER BY id DESC
    LIMIT 5
  `,
    []
  );

  if (!rows.length) {
    await ctx.answerCbQuery("Pending yo‘q");
    await ctx.reply("Hozir pending so‘rovlar yo‘q.");
    return;
  }

  await ctx.answerCbQuery("Yuborildi");
  for (const r of rows) {
    await ctx.telegram.sendPhoto(ADMIN_TELEGRAM_ID, r.screenshot_file_id, {
      caption: `🧾 Pending\ntelegram_id: ${r.telegram_id}\ncreated_at: ${r.created_at}\n\nTasdiqlaysizmi?`,
      reply_markup: Markup.inlineKeyboard([
        Markup.button.callback("Tasdiqlash", `approve:${r.telegram_id}`),
        Markup.button.callback("Rad etish", `reject:${r.telegram_id}`)
      ]).reply_markup
    });
  }
});

bot.hears("Promo kod sotib olish", async (ctx) => {
  if (isAdmin(ctx)) {
    return ctx.reply("Siz adminsiz. Userlar promo sotib olishni o‘zlari ishlatadi. Admin uchun: /admin");
  }
  await ensureUser(ctx);
  await ctx.reply(
    `Promo kod sotib olish uchun quyidagi kartaga to‘lov qiling:\n\n${CARD_NUMBER}\n\nKeyin to‘lov screenshotini shu chatga yuboring.\n\nAdmin: @${ADMIN_USERNAME}`
  );
});

bot.on("photo", async (ctx) => {
  await ensureUser(ctx);
  const telegramId = String(ctx.from.id);
  const username = ctx.from.username ? `@${ctx.from.username}` : "(no username)";
  const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
  if (!photo) return;

  await dbApi.run(
    "INSERT INTO promo_requests (telegram_id, status, screenshot_file_id) VALUES (?, 'pending', ?)",
    [telegramId, photo.file_id]
  );

  const caption = `🧾 Promo request\ntelegram_id: ${telegramId}\nuser: ${username}\n\nTasdiqlaysizmi?`;
  await ctx.telegram.sendPhoto(ADMIN_TELEGRAM_ID, photo.file_id, {
    caption,
    reply_markup: Markup.inlineKeyboard([
      Markup.button.callback("Tasdiqlash", `approve:${telegramId}`),
      Markup.button.callback("Rad etish", `reject:${telegramId}`)
    ]).reply_markup
  });

  await ctx.reply("Screenshot qabul qilindi. Admin tekshiradi.");
  await ctx.reply(`Agar uzoq vaqt javob bo‘lmasa, adminga yozing: @${ADMIN_USERNAME}`);
});

bot.action(/approve:(.+)/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_TELEGRAM_ID) return ctx.answerCbQuery("Not allowed");
  const telegramId = String(ctx.match[1]);

  const code = makePromoCode();
  await dbApi.run("INSERT INTO promo_codes (code, telegram_id, activated) VALUES (?, ?, 0)", [code, telegramId]);
  await dbApi.run(
    "UPDATE promo_requests SET status = 'approved' WHERE telegram_id = ? AND status = 'pending'",
    [telegramId]
  );

  const webappUrl = `${BASE_URL.replace(/\/$/, "")}/webapp`;
  await ctx.telegram.sendMessage(
    telegramId,
    `✅ To‘lov tasdiqlandi!\nSizning promo kodingiz: ${code}\n\nWeb App ichida “PRO ga o‘tish” -> promo kodni kiriting.\n\nPastdagi tugma orqali web ilovani oching:`,
    { reply_markup: startInlineKeyboard(webappUrl).reply_markup }
  );
  await ctx.editMessageCaption((ctx.update.callback_query.message.caption || "") + `\n\n✅ Approved. Code: ${code}`);
  await ctx.answerCbQuery("Approved");
});

bot.action(/reject:(.+)/, async (ctx) => {
  if (String(ctx.from.id) !== ADMIN_TELEGRAM_ID) return ctx.answerCbQuery("Not allowed");
  const telegramId = String(ctx.match[1]);

  await dbApi.run(
    "UPDATE promo_requests SET status = 'rejected' WHERE telegram_id = ? AND status = 'pending'",
    [telegramId]
  );
  await ctx.telegram.sendMessage(telegramId, "❌ To‘lov rad etildi. Iltimos, qayta urinib ko‘ring yoki admin bilan bog‘laning.");
  await ctx.editMessageCaption((ctx.update.callback_query.message.caption || "") + "\n\n❌ Rejected.");
  await ctx.answerCbQuery("Rejected");
});

async function start() {
  await initDb(dbApi);
  await bot.launch();
  console.log("Bot started (long polling).");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

start().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
