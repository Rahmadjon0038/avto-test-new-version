const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { openDb, initDb } = require("./db");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const bcrypt = require("bcryptjs");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (error) {
  console.warn("[backend] nodemailer module not installed; phone-based temporary password reset is active.");
}
const { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const PORT = Number(process.env.PORT || 3000);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "15mb";
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || "https://topshirdi.uz,https://www.topshirdi.uz,https://api.topshirdi.uz")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use((req, res, next) => {
  const origin = String(req.headers.origin || "").trim();
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Topic-Id, X-File-Name, X-Video-Title, X-Video-Description, X-Video-Category, X-Premium-Only, X-Title, X-Video-File-Name"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const dbApi = openDb();
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || ""
  }
});

const TOPICS_SEED_PATH = path.join(__dirname, "..", "data", "topics.json");
const CUSTOM_TESTS_SEED_PATH = path.join(__dirname, "..", "data", "custom-tests.json");
const GOOGLE_CLIENT_IDS = new Set(
  String(
    process.env.GOOGLE_CLIENT_IDS ||
      "844953821020-2dcgvd7i32rvpj552gkgopat9278tnfe.apps.googleusercontent.com,1020-ctqhbkt1gnfi3jiahg4jmfkjum2e91qk.apps.googleusercontent.com,844953821020-u94ktl35es9aquthb8rh5rmg7etossra.apps.googleusercontent.com"
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const APPLE_AUDIENCES = new Set(
  String(process.env.APPLE_AUDIENCES || process.env.APPLE_CLIENT_IDS || "uz.roadtest.app")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
let appleJwks = null;

function normalizeTicketStatus(value) {
  const status = String(value || "COMPLETED").trim().toUpperCase();
  return status === "DRAFT" ? "DRAFT" : "COMPLETED";
}

function normalizeTicketRow(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    titleI18n: normalizeTitleI18n(row.title_i18n, row.title),
    ticketNumber: Number(row.ticket_number || 0),
    status: normalizeTicketStatus(row.status),
    questions: parseQuestionsValue(row.questions),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined
  };
}

function parseQuestionsValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseJsonValue(value, fallback) {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const SUPPORTED_LANGUAGES = ["uz_latn", "uz_cyrl", "ru"];
const SUPPORTED_LANGUAGE_SET = new Set(SUPPORTED_LANGUAGES);
const DEFAULT_LANGUAGE = "uz_latn";

function normalizeLanguageCode(value, fallback = DEFAULT_LANGUAGE) {
  const raw = String(value || "").trim().toLowerCase().replace(/-/g, "_");
  if (!raw) return fallback;
  return SUPPORTED_LANGUAGE_SET.has(raw) ? raw : fallback;
}

function normalizeTitleI18n(value, fallbackTitle = "") {
  const source = parseJsonValue(value, {});
  const normalized = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    const raw = source?.[lang];
    const text =
      typeof raw === "string"
        ? raw
        : String(raw?.text || raw?.title || raw?.value || "").trim();
    if (text) normalized[lang] = text;
  }
  if (!Object.keys(normalized).length) {
    const fallback = String(fallbackTitle || "").trim();
    if (fallback) normalized[DEFAULT_LANGUAGE] = fallback;
  }
  return normalized;
}

function normalizeQuestionI18n(value, baseQuestion = null) {
  const source = parseJsonValue(value, {});
  const normalized = {};
  for (const lang of SUPPORTED_LANGUAGES) {
    const raw = source?.[lang];
    if (!raw || typeof raw !== "object") continue;
    const options = Array.isArray(raw.options) ? raw.options.map((option) => String(option || "").trim()) : [];
    const text = String(raw.text || "").trim();
    const image = String(raw.image || "").trim();
    const audio = String(raw.audio || "").trim();
    const explanation = String(raw.explanation || "").trim();
    const correctIndex = Number.isFinite(Number(raw.correctIndex))
      ? Number(raw.correctIndex)
      : Number(baseQuestion?.correctIndex || 0);
    const hasContent = Boolean(text || image || audio || explanation || options.some(Boolean) || Number.isFinite(Number(raw.correctIndex)));
    if (!hasContent) continue;
    normalized[lang] = {
      text,
      image,
      audio,
      options,
      correctIndex,
      explanation
    };
  }
  return normalized;
}

function hasQuestionI18n(value) {
  return Object.keys(parseJsonValue(value, {})).some((lang) => SUPPORTED_LANGUAGE_SET.has(String(lang || "").trim().toLowerCase().replace(/-/g, "_")));
}

function localizeQuestion(question, lang) {
  const normalizedLang = normalizeLanguageCode(lang, "");
  if (!normalizedLang || !question || typeof question !== "object") return question;
  const localized = parseJsonValue(question.i18n, {})?.[normalizedLang];
  if (!localized || typeof localized !== "object") return question;

  const next = { ...question };
  if (localized.text !== undefined && String(localized.text).trim()) next.text = String(localized.text);
  if (localized.image !== undefined && String(localized.image).trim()) next.image = String(localized.image);
  if (localized.audio !== undefined && String(localized.audio).trim()) next.audio = String(localized.audio);
  if (Array.isArray(localized.options) && localized.options.some((option) => String(option || "").trim())) {
    next.options = localized.options.map((option) => String(option || "").trim());
  }
  if (localized.explanation !== undefined && String(localized.explanation).trim()) {
    next.explanation = String(localized.explanation);
  }
  if (Number.isFinite(Number(localized.correctIndex))) next.correctIndex = Number(localized.correctIndex);
  return next;
}

function localizeQuestions(questions, lang) {
  return Array.isArray(questions) ? questions.map((question) => (question ? localizeQuestion(question, lang) : question)) : [];
}

function localizeTopic(topic, lang) {
  const normalizedLang = normalizeLanguageCode(lang, "");
  if (!normalizedLang || !topic || typeof topic !== "object") return topic;
  const title = String(topic.title_i18n?.[normalizedLang] || "").trim();
  return {
    ...topic,
    title: title || topic.title,
    questions: localizeQuestions(topic.questions, normalizedLang)
  };
}

function localizeTicket(ticket, lang) {
  const normalizedLang = normalizeLanguageCode(lang, "");
  if (!normalizedLang || !ticket || typeof ticket !== "object") return ticket;
  const title = String(ticket.title_i18n?.[normalizedLang] || "").trim();
  return {
    ...ticket,
    title: title || ticket.title,
    questions: localizeQuestions(ticket.questions, normalizedLang)
  };
}

function normalizeQuestions(value, currentQuestions = null) {
  const questions = parseQuestionsValue(value);
  const currentById = new Map(
    Array.isArray(currentQuestions)
      ? currentQuestions
          .filter(Boolean)
          .map((question, index) => [String(question?.id || `${index + 1}`), question])
      : []
  );
  return questions
    .map((question, index) => ({
      id: String(question?.id || `${index + 1}`),
      image: String(
        question?.image !== undefined && String(question?.image).trim()
          ? question.image
          : currentById.get(String(question?.id || `${index + 1}`))?.image || ""
      ),
      audio: String(
        question?.audio !== undefined && String(question?.audio).trim()
          ? question.audio
          : currentById.get(String(question?.id || `${index + 1}`))?.audio || ""
      ),
      text: String(
        question?.text !== undefined && String(question?.text).trim()
          ? question.text
          : currentById.get(String(question?.id || `${index + 1}`))?.text || ""
      ),
      options: Array.isArray(question?.options) && question.options.some((option) => String(option || "").trim())
        ? question.options.map((option) => String(option || "").trim())
        : Array.isArray(currentById.get(String(question?.id || `${index + 1}`))?.options)
          ? currentById.get(String(question?.id || `${index + 1}`)).options.map((option) => String(option || "").trim())
          : [],
      correctIndex: Number.isFinite(Number(question?.correctIndex))
        ? Number(question.correctIndex)
        : Number.isFinite(Number(currentById.get(String(question?.id || `${index + 1}`))?.correctIndex))
          ? Number(currentById.get(String(question?.id || `${index + 1}`))?.correctIndex)
          : 0,
      explanation: String(
        question?.explanation !== undefined && String(question?.explanation).trim()
          ? question.explanation
          : currentById.get(String(question?.id || `${index + 1}`))?.explanation || ""
      ),
      i18n: normalizeQuestionI18n(question?.i18n, question)
    }))
    .filter((question) => question.text || question.options.some(Boolean) || Object.keys(question.i18n || {}).length > 0);
}

function normalizeTicket(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    titleI18n: normalizeTitleI18n(row.title_i18n, row.title),
    questions: normalizeQuestions(row.questions),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined
  };
}

function normalizeTicketQuestionRow(row) {
  const question = parseJsonValue(row.question, {});
  return {
    id: Number(row.id),
    ticketId: String(row.ticket_id || ""),
    questionId: String(row.question_id || ""),
    order: Number(row.order || 0),
    topicId: Number(row.topic_id || 0),
    topicSlug: String(row.topic_slug || ""),
    topicTitle: String(row.topic_title || ""),
    questionIndex: Number(row.question_index || 0),
    question
  };
}

function normalizeTicketSlotQuestion(question, fallbackOrder = 0, currentQuestion = null) {
  if (!question || typeof question !== "object") return null;
  const current = currentQuestion && typeof currentQuestion === "object" ? currentQuestion : null;
  const text = String(question.text || "").trim();
  const image = String(question.image || "").trim();
  const audio = String(question.audio || "").trim();
  const explanation = String(question.explanation || "").trim();
  const options = Array.isArray(question.options) ? question.options.map((option) => String(option || "").trim()) : [];
  const i18n = normalizeQuestionI18n(
    question.i18n && Object.keys(parseJsonValue(question.i18n, {})).length
      ? question.i18n
      : current?.i18n || {},
    question
  );
  const hasContent = Boolean(text || image || audio || explanation || options.some(Boolean) || Object.keys(i18n || {}).length > 0);
  if (!hasContent && !String(question.id || question.questionId || "").trim()) return null;
  return {
    id: String(question.id || question.questionId || `slot-${fallbackOrder}`),
    questionId: String(question.questionId || question.id || ""),
    order: Number.isFinite(Number(question.order)) ? Number(question.order) : Number(fallbackOrder || 0),
    topicId: Number(question.topicId || 0),
    topicSlug: String(question.topicSlug || ""),
    topicTitle: String(question.topicTitle || ""),
    questionIndex: Number(question.questionIndex || 0),
    text: text || String(current?.text || ""),
    image: image || String(current?.image || ""),
    audio: audio || String(current?.audio || ""),
    options: options.some(Boolean)
      ? options
      : Array.isArray(current?.options)
        ? current.options.map((option) => String(option || "").trim())
        : [],
    correctIndex: Number.isFinite(Number(question.correctIndex))
      ? Number(question.correctIndex)
      : Number.isFinite(Number(current?.correctIndex))
        ? Number(current.correctIndex)
        : 0,
    explanation: explanation || String(current?.explanation || ""),
    i18n
  };
}

function mergeTicketSlotQuestions(value, currentQuestions = null) {
  const raw = Array.isArray(value) ? value : [];
  const currentSlots = Array.isArray(currentQuestions) ? currentQuestions : [];
  return Array.from({ length: 20 }, (_, index) => {
    const source = raw[index];
    const current = currentSlots[index] || null;
    if ((!source || typeof source !== "object") && !current) return null;

    const next = source && typeof source === "object" ? source : {};
    const hasSourceI18n = Boolean(next.i18n && Object.keys(parseJsonValue(next.i18n, {})).length);
    const currentI18n = current?.i18n && typeof current.i18n === "object" ? parseJsonValue(current.i18n, {}) : {};
    const nextI18n = hasSourceI18n ? parseJsonValue(next.i18n, {}) : currentI18n;

    const text = String(next.text || "").trim() || String(current?.text || "").trim();
    const image = String(next.image || "").trim() || String(current?.image || "").trim();
    const audio = String(next.audio || "").trim() || String(current?.audio || "").trim();
    const explanation = String(next.explanation || "").trim() || String(current?.explanation || "").trim();
    const options = Array.isArray(next.options) && next.options.some((option) => String(option || "").trim())
      ? next.options.map((option) => String(option || "").trim())
      : Array.isArray(current?.options)
        ? current.options.map((option) => String(option || "").trim())
        : [];
    const correctIndex = Number.isFinite(Number(next.correctIndex))
      ? Number(next.correctIndex)
      : Number.isFinite(Number(current?.correctIndex))
        ? Number(current.correctIndex)
        : 0;

    const questionId = String(next.questionId || next.id || current?.questionId || current?.id || `slot-${index + 1}`);
    const id = String(next.id || current?.id || questionId || `slot-${index + 1}`);

    return {
      id,
      questionId,
      order: Number.isFinite(Number(next.order)) ? Number(next.order) : Number(index + 1),
      topicId: Number(next.topicId || current?.topicId || 0),
      topicSlug: String(next.topicSlug || current?.topicSlug || ""),
      topicTitle: String(next.topicTitle || current?.topicTitle || ""),
      questionIndex: Number.isFinite(Number(next.questionIndex)) ? Number(next.questionIndex) : Number(current?.questionIndex || 0),
      text,
      image,
      audio,
      options,
      correctIndex,
      explanation,
      i18n: nextI18n && Object.keys(nextI18n).length ? nextI18n : {}
    };
  });
}

function normalizeTicketSlotQuestions(value, currentQuestions = null) {
  return mergeTicketSlotQuestions(value, currentQuestions);
}

function extractTopicQuestionId(questionKey) {
  const raw = String(questionKey || "").trim();
  if (!raw) return "";
  const parts = raw.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : raw;
}

async function getTopicQuestionSnapshot(topicId, questionKey) {
  const key = String(topicId || "").trim();
  const questionId = extractTopicQuestionId(questionKey);
  if (!key || !questionId) return null;

  const topic = await getTopicFromDb(key);
  if (!topic || !Array.isArray(topic.questions)) return null;

  const rawQuestion = topic.questions.find((question) => String(question?.id || "") === questionId) || null;
  if (!rawQuestion) return null;
  return normalizeQuestions([rawQuestion])[0] || null;
}

async function hydrateTicketSlotQuestions(rawQuestions, questionRows = []) {
  const rawSlots = normalizeTicketSlotQuestions(rawQuestions, rawQuestions);
  const rowsByOrder = new Map(
    Array.isArray(questionRows)
      ? questionRows
          .filter(Boolean)
          .map((row) => [Number(row.order || 0), row])
      : []
  );
  const topicQuestionCache = new Map();

  const results = [];
  for (let index = 0; index < 20; index += 1) {
    const rawSlot = rawSlots[index] || null;
    const row = rowsByOrder.get(index + 1) || null;
    if (!rawSlot && !row) {
      results.push(null);
      continue;
    }

    const bankQuestion = row ? row.question : null;
    let topicQuestion = null;
    const sourceTopicId = Number(
      row?.topicId ||
        rawSlot?.topicId ||
        bankQuestion?.topicId ||
        0
    );
    const sourceQuestionId = String(
      row?.questionId ||
        rawSlot?.questionId ||
        bankQuestion?.questionId ||
        bankQuestion?.id ||
        rawSlot?.id ||
        ""
    );

    if (sourceTopicId && sourceQuestionId) {
      const cacheKey = `${sourceTopicId}:${sourceQuestionId}`;
      if (topicQuestionCache.has(cacheKey)) {
        topicQuestion = topicQuestionCache.get(cacheKey);
      } else {
        topicQuestion = await getTopicQuestionSnapshot(sourceTopicId, sourceQuestionId);
        topicQuestionCache.set(cacheKey, topicQuestion);
      }
    }

    results.push(
      normalizeTicketSlotQuestion(
        rawSlot || bankQuestion || topicQuestion || null,
        index + 1,
        topicQuestion || bankQuestion || rawSlot || null
      )
    );
  }

  return results;
}

function buildTicketQuestionQuestion(ticket, questionRow) {
  if (!questionRow || !questionRow.questionId) return null;
  const questionId = String(questionRow.questionId || questionRow.question_key || questionRow.question?.id || "");
  const normalized = normalizeAnswerQuestion(questionRow.question);
  return {
    id: `ticket:${String(ticket.id)}:${questionId}`,
    kind: "ticket",
    sourceId: String(ticket.id),
    sourceTitle: String(ticket.title || ""),
    sourceKind: "ticket",
    questionIndex: Number(questionRow.order || 0),
    ...normalized
  };
}

function buildTicketBuilderQuestion(questionRow) {
  if (!questionRow || !questionRow.questionId) return null;
  const normalized = normalizeAnswerQuestion(questionRow.question);
  return {
    id: String(questionRow.questionId || questionRow.question?.id || ""),
    questionId: String(questionRow.questionId || questionRow.question?.id || ""),
    order: Number(questionRow.order || 0),
    topicId: Number(questionRow.topicId || 0),
    topicSlug: String(questionRow.topicSlug || ""),
    topicTitle: String(questionRow.topicTitle || ""),
    questionIndex: Number(questionRow.questionIndex || 0),
    ...normalized
  };
}

async function getTicketQuestionsFromDb(ticketId) {
  const rows = await dbApi.all(
    `
      SELECT
        tq.id,
        tq.ticket_id,
        tq.question_id,
        tq."order",
        bank.topic_id,
        bank.topic_slug,
        bank.topic_title,
        bank.question_index,
      bank.question
      FROM ticket_questions tq
      LEFT JOIN topic_question_bank bank ON bank.question_key = tq.question_id
      WHERE tq.ticket_id = ?
      ORDER BY tq."order" ASC, tq.id ASC
    `,
    [String(ticketId)]
  );
  return rows.map(normalizeTicketQuestionRow);
}

async function refreshTicketQuestionsMirror(ticketId) {
  const ticket = await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE id = ?", [String(ticketId)]);
  if (!ticket) return null;
  const slots = normalizeTicketSlotQuestions(ticket.questions);
  const questionRows = await getTicketQuestionsFromDb(ticketId);
  for (const row of questionRows) {
    const slotIndex = Number(row.order || 0) - 1;
    if (slotIndex < 0 || slotIndex >= slots.length) continue;
    const question = buildTicketBuilderQuestion(row);
    slots[slotIndex] = question;
  }
  await dbApi.run(
    `UPDATE tickets SET questions = ?::jsonb, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(slots), String(ticketId)]
  );
  return getTicketBuilderFromDb(ticketId);
}

async function getTicketFromDb(ticketId) {
  const row = await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE id = ?", [String(ticketId)]);
  if (!row) return null;
  const questionRows = await getTicketQuestionsFromDb(ticketId);
  const sourceQuestions = await hydrateTicketSlotQuestions(row.questions, questionRows);
  return {
    ...normalizeTicketRow(row),
    questions: sourceQuestions
  };
}

async function getTicketBuilderFromDb(ticketId) {
  const row = await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE id = ?", [String(ticketId)]);
  if (!row) return null;
  const questionRows = await getTicketQuestionsFromDb(ticketId);
  const slots = await hydrateTicketSlotQuestions(row.questions, questionRows);
  return {
    ...normalizeTicketRow(row),
    questions: slots
  };
}

async function syncTicketQuestionsFromSlots(ticketId, slots) {
  const normalizedSlots = normalizeTicketSlotQuestions(slots);
  await dbApi.run("DELETE FROM ticket_questions WHERE ticket_id = ?", [String(ticketId)]);
  for (const [index, question] of normalizedSlots.entries()) {
    if (!question || !question.questionId) continue;
    await dbApi.run(
      `
        INSERT INTO ticket_questions (ticket_id, question_id, "order", created_at, updated_at)
        VALUES (?, ?, ?, NOW(), NOW())
        ON CONFLICT (question_id) DO UPDATE SET
          ticket_id = EXCLUDED.ticket_id,
          "order" = EXCLUDED."order",
          updated_at = EXCLUDED.updated_at
      `,
      [String(ticketId), String(question.questionId), index + 1]
    );
  }
  return normalizedSlots;
}

async function persistTicketSlotQuestions(ticketId, slots) {
  const normalizedSlots = normalizeTicketSlotQuestions(slots);
  await dbApi.run(
    `UPDATE tickets SET questions = ?::jsonb, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(normalizedSlots), String(ticketId)]
  );
  await syncTicketQuestionsFromSlots(ticketId, normalizedSlots);
  return getTicketBuilderFromDb(ticketId);
}

async function getTicketsFromDb() {
  const rows = await dbApi.all(
    "SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE status = 'COMPLETED' ORDER BY ticket_number ASC, created_at ASC, id ASC"
  );
  const tickets = [];
  for (const row of rows) {
    const ticket = await getTicketFromDb(row.id);
    if (ticket) tickets.push(ticket);
  }
  return tickets;
}

function buildTicketQuestionBankKey(ticketId, questionId) {
  return `ticket:${String(ticketId)}:${String(questionId)}`;
}

async function getTicketQuestionBankFromDb() {
  const tickets = await getTicketsFromDb();
  const bank = [];

  for (const ticket of tickets) {
    for (const [index, question] of (Array.isArray(ticket.questions) ? ticket.questions : []).entries()) {
      if (!question) continue;
      const questionId = String(question.id || `${index + 1}`);
      bank.push({
        questionKey: buildTicketQuestionBankKey(ticket.id, questionId),
        ticketId: String(ticket.id),
        ticketTitle: String(ticket.title || ""),
        questionIndex: index,
        question: normalizeAnswerQuestion(question)
      });
    }
  }

  return bank;
}

async function getTicketByIdFromDb(ticketId) {
  const ticket = await getTicketFromDb(ticketId);
  if (ticket && ticket.status !== "COMPLETED") return null;
  return ticket;
}

function normalizeTicketInputQuestions(inputQuestions) {
  return normalizeQuestions(inputQuestions || []).map((question) => {
    if (question.options.length < 2) throw new Error("Har bir savolda kamida 2 ta variant bo‘lishi kerak");
    if (question.options.some((option) => !option)) throw new Error("Barcha variantlarni to‘ldiring");
    if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
      throw new Error("To‘g‘ri javob variantini qayta tanlang");
    }
    return question;
  });
}

async function getNextTicketNumber(excludeTicketId = null) {
  // O'chirilgan bilet raqamlari qayta ishlatiladi: eng kichik bo'sh raqam qaytadi.
  const rows = excludeTicketId
    ? await dbApi.all("SELECT ticket_number FROM tickets WHERE id <> ?", [String(excludeTicketId)])
    : await dbApi.all("SELECT ticket_number FROM tickets");
  const used = new Set(
    rows.map((row) => Number(row.ticket_number || 0)).filter((value) => Number.isFinite(value) && value > 0)
  );
  let next = 1;
  while (used.has(next)) next += 1;
  return next;
}

function makeTicketTitle(ticketNumber) {
  return `Bilet №${Number(ticketNumber) || 1}`;
}

async function renumberTicket(ticketRow, nextNumber) {
  const currentId = String(ticketRow.id);
  const nextId = String(nextNumber);
  const currentNumber = Number(ticketRow.ticket_number || 0);
  const currentTitle = String(ticketRow.title || "").trim();
  const nextTitle = !currentTitle || currentTitle === makeTicketTitle(currentNumber) ? makeTicketTitle(nextNumber) : currentTitle;

  if (nextId === currentId) {
    await dbApi.run("UPDATE tickets SET ticket_number = ?, title = ?, updated_at = NOW() WHERE id = ?", [
      nextNumber,
      nextTitle,
      currentId
    ]);
    return currentId;
  }

  const idTaken = await dbApi.get("SELECT id FROM tickets WHERE id = ?", [nextId]);
  if (idTaken) return currentId;

  const fullRow = await dbApi.get("SELECT questions FROM tickets WHERE id = ?", [currentId]);
  const slots = normalizeTicketSlotQuestions(fullRow?.questions);
  // ticket_questions.ticket_id FK tickets(id) ga bog'langan — id almashishidan oldin bolalarni bo'shatamiz
  await dbApi.run("DELETE FROM ticket_questions WHERE ticket_id = ?", [currentId]);
  await dbApi.run("UPDATE tickets SET id = ?, ticket_number = ?, title = ?, updated_at = NOW() WHERE id = ?", [
    nextId,
    nextNumber,
    nextTitle,
    currentId
  ]);
  await dbApi.run("UPDATE test_progress SET ticket_id = ? WHERE ticket_id = ?", [nextId, currentId]);
  await syncTicketQuestionsFromSlots(nextId, slots);
  return nextId;
}

async function ensureDraftTicketNumber(draftId) {
  const row = await dbApi.get("SELECT id, title, ticket_number, status FROM tickets WHERE id = ?", [String(draftId)]);
  if (!row || normalizeTicketStatus(row.status) !== "DRAFT") return String(draftId);
  const expected = await getNextTicketNumber(row.id);
  if (Number(row.ticket_number || 0) === expected) return String(row.id);
  return renumberTicket(row, expected);
}

async function createTicket(input) {
  const titleI18n = normalizeTitleI18n(input.titleI18n || input.title_i18n || {}, input.title || "");
  const title = String(input.title || titleI18n[DEFAULT_LANGUAGE] || "").trim();
  const ticketNumber = Number.isFinite(Number(input.ticketNumber)) ? Number(input.ticketNumber) : await getNextTicketNumber();
  const ticketId = String(input.id || ticketNumber);
  const status = normalizeTicketStatus(input.status || "COMPLETED");
  const questions = normalizeTicketSlotQuestions(input.questions || []);

  const result = await dbApi.get(
    `
      INSERT INTO tickets (id, title, title_i18n, ticket_number, status, questions, created_at, updated_at)
      VALUES (?, ?, ?::jsonb, ?, ?, ?::jsonb, NOW(), NOW())
      RETURNING id, title, title_i18n, ticket_number, status, questions, created_at, updated_at
    `,
    [ticketId, title || makeTicketTitle(ticketNumber), JSON.stringify(titleI18n), ticketNumber, status, JSON.stringify(questions)]
  );

  await syncTicketQuestionsFromSlots(ticketId, questions);

  return status === "COMPLETED" ? getTicketByIdFromDb(result.id) : getDraftTicketFromDb(result.id);
}

async function replaceTicketQuestions(ticketId, questions) {
  const ticket = await dbApi.get("SELECT id, title, ticket_number, status FROM tickets WHERE id = ?", [String(ticketId)]);
  if (!ticket) throw new Error("Bilet topilmadi");

  const normalized = normalizeTicketSlotQuestions(questions);
  await dbApi.run(
    `UPDATE tickets SET questions = ?::jsonb, updated_at = NOW() WHERE id = ?`,
    [JSON.stringify(normalized), String(ticketId)]
  );
  await syncTicketQuestionsFromSlots(ticketId, normalized);

  return getTicketBuilderFromDb(ticketId);
}

async function updateTicket(id, input) {
  const ticket = await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions FROM tickets WHERE id = ?", [String(id)]);
  if (!ticket) throw new Error("Bilet topilmadi");

  const titleI18n = normalizeTitleI18n(input.titleI18n || input.title_i18n || ticket.title_i18n || {}, input.title !== undefined ? input.title : ticket.title);
  const title =
    input.title !== undefined ? String(input.title || "").trim() : String(titleI18n[DEFAULT_LANGUAGE] || ticket.title || "").trim();
  if (!title) throw new Error("Bilet nomi kiritilishi kerak");

  const status = input.status !== undefined ? normalizeTicketStatus(input.status) : normalizeTicketStatus(ticket.status);
  const sourceQuestions =
    input.questions !== undefined
      ? normalizeTicketSlotQuestions(input.questions, ticket.questions)
      : normalizeTicketSlotQuestions(ticket.questions, ticket.questions);
  const questionRows = await getTicketQuestionsFromDb(id);
  const questions = await hydrateTicketSlotQuestions(sourceQuestions, questionRows);

  const result = await dbApi.get(
    `
      UPDATE tickets
      SET title = ?, title_i18n = ?::jsonb, status = ?, questions = ?::jsonb, updated_at = NOW()
      WHERE id = ?
      RETURNING id, title, title_i18n, ticket_number, status, questions, created_at, updated_at
    `,
    [title, JSON.stringify(titleI18n), status, JSON.stringify(questions), String(id)]
  );

  if (input.questions !== undefined) {
    await syncTicketQuestionsFromSlots(id, questions);
  }

  return normalizeTicketRow(result);
}

async function deleteTicket(id) {
  await dbApi.run("DELETE FROM test_progress WHERE ticket_id = ?", [String(id)]);
  await dbApi.run("DELETE FROM ticket_questions WHERE ticket_id = ?", [String(id)]);
  await dbApi.run("DELETE FROM tickets WHERE id = ?", [String(id)]);
}

async function getDraftTicketFromDb(ticketId = null) {
  const row = ticketId
    ? await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE id = ?", [String(ticketId)])
    : await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE status = 'DRAFT' ORDER BY created_at ASC, id ASC LIMIT 1");
  if (!row) return null;
  const ticket = await getTicketFromDb(row.id);
  return ticket && ticket.status === "DRAFT" ? ticket : null;
}

async function getDraftTicketBuilderFromDb(ticketId = null) {
  const row = ticketId
    ? await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE id = ?", [String(ticketId)])
    : await dbApi.get("SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets WHERE status = 'DRAFT' ORDER BY created_at ASC, id ASC LIMIT 1");
  if (!row) return null;
  const ticket = await getTicketBuilderFromDb(row.id);
  return ticket && ticket.status === "DRAFT" ? ticket : null;
}

async function getOrCreateDraftTicket() {
  const existing = await getDraftTicketFromDb();
  if (existing) return existing;

  const ticketNumber = await getNextTicketNumber();
  const ticketId = String(ticketNumber);
  const title = makeTicketTitle(ticketNumber);

  const created = await dbApi.get(
    `
      INSERT INTO tickets (id, title, ticket_number, status, questions, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', '[]'::jsonb, NOW(), NOW())
      RETURNING id, title, ticket_number, status, questions, created_at, updated_at
    `,
    [ticketId, title, ticketNumber]
  );

  return getTicketFromDb(created.id);
}

async function getTicketBuilderTarget(ticketId = null) {
  const normalizedTicketId = String(ticketId || "").trim();
  if (normalizedTicketId) {
    const ticket = await getTicketBuilderFromDb(normalizedTicketId);
    if (!ticket) throw new Error("Bilet topilmadi");
    return ticket;
  }
  return getOrCreateDraftTicket();
}

function slugifyTopic(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/['’"]/g, "")
    .replace(/[^a-z0-9\u0400-\u04FF]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return text || "mavzu";
}

function normalizeTopicRow(row) {
  return {
    id: Number(row.id),
    slug: String(row.slug || ""),
    title: String(row.title || ""),
    titleI18n: normalizeTitleI18n(row.title_i18n, row.title),
    questions: parseQuestionsValue(row.questions),
    adminMarked: row.admin_marked === true
  };
}

function normalizeTopicInput(input = {}, fallbackTitle = "", current = null) {
  const source = typeof input === "string" ? { title: input } : input || {};
  const titleI18n = normalizeTitleI18n(
    source.titleI18n || source.title_i18n || current?.titleI18n || current?.title_i18n || {},
    source.title || current?.title || fallbackTitle
  );
  const titleSource =
    source.title !== undefined ? source.title : titleI18n[DEFAULT_LANGUAGE] || current?.title || fallbackTitle;
  const title = String(titleSource || "").trim();
  if (!title) throw new Error("Mavzu nomi kiritilishi kerak");
  return {
    title,
    titleI18n,
    slug: String(source.slug || current?.slug || "").trim() || slugifyTopic(title),
    adminMarked: source.adminMarked !== undefined ? Boolean(source.adminMarked) : Boolean(current?.adminMarked || false),
    questions:
      source.questions !== undefined
        ? normalizeQuestions(source.questions, Array.isArray(current?.questions) ? current.questions : null)
        : Array.isArray(current?.questions)
          ? current.questions
          : []
  };
}

function normalizeImportedTopicQuestion(input = {}, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  const text = String(source.text || "").trim();
  const i18n = normalizeQuestionI18n(source.i18n, source);
  if (!text && !Object.keys(i18n || {}).length) throw new Error(`Savol ${index + 1}: matn yoki tarjima kiritilishi kerak`);

  const image = String(source.image || "").trim();
  const audio = String(source.audio || "").trim();
  const explanation = String(source.explanation || "").trim();
  const options = Array.isArray(source.options) ? source.options.map((option) => String(option || "").trim()) : [];
  const correctIndex = Number.isFinite(Number(source.correctIndex)) ? Number(source.correctIndex) : 0;

  if (options.length < 2) throw new Error(`Savol ${index + 1}: kamida 2 ta variant bo‘lishi kerak`);
  if (options.some((option) => !option)) throw new Error(`Savol ${index + 1}: barcha variantlarni to‘ldiring`);
  if (correctIndex < 0 || correctIndex >= options.length) {
    throw new Error(`Savol ${index + 1}: to‘g‘ri javob variantini qayta tanlang`);
  }

  return {
    id: crypto.randomUUID(),
    image,
    audio,
    text,
    options,
    correctIndex,
    explanation,
    i18n
  };
}

async function getTopicsFromDb() {
  const rows = await dbApi.all("SELECT id, slug, title, title_i18n, questions, admin_marked FROM topics ORDER BY id ASC");
  return rows.map(normalizeTopicRow);
}

async function getTopicFromDb(topicId) {
  const key = String(topicId || "").trim();
  if (!key) return null;
  const row = await dbApi.get("SELECT id, slug, title, title_i18n, questions, admin_marked FROM topics WHERE CAST(id AS TEXT) = ? OR slug = ? LIMIT 1", [key, key]);
  return row ? normalizeTopicRow(row) : null;
}

const BUNNY_LIBRARY_ID = String(process.env.BUNNY_LIBRARY_ID || "").trim();
const BUNNY_CDN_HOSTNAME = String(process.env.BUNNY_CDN_HOSTNAME || "").trim();
const BUNNY_API_KEY = String(process.env.BUNNY_API_KEY || "").trim();
const BUNNY_API_BASE_URL = String(process.env.BUNNY_API_BASE_URL || "https://video.bunnycdn.com").replace(/\/+$/, "");
const PUBLIC_API_BASE_URL = String(process.env.PUBLIC_API_BASE_URL || "http://127.0.0.1:4001").replace(/\/+$/, "");

function normalizeVideoStatus(value, fallback = "processing") {
  const raw = String(value || fallback || "").trim().toLowerCase();
  if (raw === "ready" || raw === "processing" || raw === "failed") return raw;
  if (raw.includes("ready") || raw.includes("finished") || raw.includes("done") || raw.includes("active")) return "ready";
  if (raw.includes("fail") || raw.includes("error")) return "failed";
  return fallback;
}

function buildBunnyPlaybackUrl(videoId) {
  if (!videoId || !BUNNY_CDN_HOSTNAME) return "";
  return `https://${BUNNY_CDN_HOSTNAME}/${encodeURIComponent(String(videoId))}/playlist.m3u8`;
}

function buildBunnyThumbnailUrl(videoId) {
  if (!videoId || !BUNNY_CDN_HOSTNAME) return "";
  return `https://${BUNNY_CDN_HOSTNAME}/${encodeURIComponent(String(videoId))}/thumbnail.jpg`;
}

function buildProxiedMediaUrl(sourceUrl, proxyPath = "video-stream") {
  const raw = String(sourceUrl || "").trim();
  if (!raw) return "";
  const proxyUrl = new URL(`/api/${proxyPath}`, PUBLIC_API_BASE_URL);
  proxyUrl.searchParams.set("u", raw);
  return proxyUrl.toString();
}

function parseBooleanValue(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value == null) return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function parseIntegerValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function normalizeVideoLessonRow(row) {
  const bunnyVideoId = String(row.bunny_video_id || "").trim();
  const bunnyLibraryId = String(row.bunny_library_id || BUNNY_LIBRARY_ID || "").trim();
  const title = String(row.title || row.topic_title || "").trim();
  const playbackUrl = String(row.playback_url || buildBunnyPlaybackUrl(bunnyVideoId) || "").trim();
  const thumbnailUrl = String(row.video_thumbnail || buildBunnyThumbnailUrl(bunnyVideoId) || "").trim();
  const status = normalizeVideoStatus(
    row.video_status || (bunnyVideoId ? "processing" : "failed"),
    bunnyVideoId ? "processing" : "failed"
  );

  return {
    id: Number(row.id),
    topicId: Number(row.topic_id || 0),
    topicSlug: String(row.topic_slug || ""),
    topicTitle: String(row.topic_title || title),
    title,
    description: String(row.description || ""),
    category: String(row.category || ""),
    premiumOnly: row.premium_only === true || row.premium_only === 1 || row.premium_only === "1",
    bunnyVideoId,
    bunnyLibraryId,
    videoStatus: status,
    videoDuration: parseIntegerValue(row.video_duration, 0),
    videoThumbnail: thumbnailUrl ? buildProxiedMediaUrl(thumbnailUrl, "image") : "",
    thumbnailUrl: thumbnailUrl ? buildProxiedMediaUrl(thumbnailUrl, "image") : "",
    playbackUrl: playbackUrl ? buildProxiedMediaUrl(playbackUrl, "video-stream") : "",
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  };
}

function normalizeVideoLessonInput(input = {}, current = null) {
  const source = typeof input === "string" ? { title: input } : input || {};
  const topicId = Number(source.topicId ?? current?.topicId ?? 0);
  if (!Number.isFinite(topicId) || topicId <= 0) throw new Error("Dars mavzusi tanlanishi kerak");
  const title = String(source.title || current?.title || "").trim();
  const description = String(source.description || current?.description || "").trim();
  const category = String(source.category || current?.category || "").trim();
  return { topicId, title, description, category, premiumOnly: false };
}

function getBunnyHeaders(extra = {}) {
  if (!BUNNY_API_KEY) throw new Error("BUNNY_API_KEY sozlanmagan");
  return {
    AccessKey: BUNNY_API_KEY,
    ...extra
  };
}

function getBunnyVideoIdFromResponse(body) {
  return String(
    body?.videoId ||
      body?.guid ||
      body?.id ||
      body?.videoID ||
      body?.video_id ||
      ""
  ).trim();
}

function normalizeBunnyInfo(body, videoId) {
  const status = normalizeVideoStatus(
    body?.status || body?.state || body?.processingStatus || body?.encodingStatus || "",
    "processing"
  );
  const duration = parseIntegerValue(
    body?.duration ??
      body?.length ??
      body?.videoLength ??
      body?.video_length ??
      body?.metadata?.duration,
    0
  );
  const thumbnail = String(
    body?.thumbnailUrl ||
      body?.thumbnailURL ||
      body?.thumbnail ||
      body?.thumbnailFileName ||
      buildBunnyThumbnailUrl(videoId)
  ).trim();
  return { status, duration, thumbnail };
}

async function bunnyRequest(pathname, init = {}) {
  const response = await fetch(`${BUNNY_API_BASE_URL}${pathname}`, {
    ...init,
    headers: {
      ...getBunnyHeaders(),
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function createBunnyVideo({ title, description, category }) {
  if (!BUNNY_LIBRARY_ID) throw new Error("BUNNY_LIBRARY_ID sozlanmagan");
  const { response, body } = await bunnyRequest(`/library/${encodeURIComponent(BUNNY_LIBRARY_ID)}/videos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      description
    })
  });

  if (!response.ok) {
    throw new Error(body?.message || body?.error || "Bunny video yaratilmadi");
  }

  const bunnyVideoId = getBunnyVideoIdFromResponse(body);
  if (!bunnyVideoId) throw new Error("Bunny video_id qaytmadi");
  return { bunnyVideoId, body };
}

async function uploadBunnyVideo({ bunnyVideoId, buffer, contentType = "application/octet-stream" }) {
  if (!BUNNY_LIBRARY_ID) throw new Error("BUNNY_LIBRARY_ID sozlanmagan");
  const { response, body } = await bunnyRequest(
    `/library/${encodeURIComponent(BUNNY_LIBRARY_ID)}/videos/${encodeURIComponent(bunnyVideoId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length)
      },
      body: buffer
    }
  );
  if (!response.ok) {
    throw new Error(body?.message || body?.error || "Bunny video yuklanmadi");
  }
  return body;
}

async function getBunnyVideoInfo(bunnyVideoId) {
  if (!BUNNY_LIBRARY_ID) throw new Error("BUNNY_LIBRARY_ID sozlanmagan");
  const { response, body } = await bunnyRequest(
    `/library/${encodeURIComponent(BUNNY_LIBRARY_ID)}/videos/${encodeURIComponent(bunnyVideoId)}`,
    { method: "GET" }
  );
  if (!response.ok) {
    throw new Error(body?.message || body?.error || "Bunny video ma’lumoti olinmadi");
  }
  return body;
}

async function deleteBunnyVideo(bunnyVideoId) {
  if (!BUNNY_LIBRARY_ID || !bunnyVideoId) return;
  await bunnyRequest(
    `/library/${encodeURIComponent(BUNNY_LIBRARY_ID)}/videos/${encodeURIComponent(bunnyVideoId)}`,
    { method: "DELETE" }
  ).catch(() => {});
}

async function syncBunnyVideoRow(videoId, bunnyInfo) {
  const video = await getVideoLessonByIdFromDb(videoId);
  if (!video) return null;
  const next = bunnyInfo || (video.bunnyVideoId ? normalizeBunnyInfo(await getBunnyVideoInfo(video.bunnyVideoId), video.bunnyVideoId) : null);
  const status = normalizeVideoStatus(next?.status, video.videoStatus);
  const duration = parseIntegerValue(next?.duration, video.videoDuration);
  const thumbnail = String(video.videoThumbnail || next?.thumbnail || buildBunnyThumbnailUrl(video.bunnyVideoId)).trim();
  const playbackUrl = String(buildBunnyPlaybackUrl(video.bunnyVideoId)).trim();
  const updated = await dbApi.get(
    `
      UPDATE video_lessons
      SET video_status = ?, video_duration = ?, video_thumbnail = ?, playback_url = ?, updated_at = NOW()
      WHERE CAST(id AS TEXT) = ?
      RETURNING *
    `,
    [status, duration, thumbnail, playbackUrl, String(videoId)]
  );
  return updated ? normalizeVideoLessonRow(updated) : null;
}

async function getVideoLessonsFromDb() {
  const rows = await dbApi.all(
    `
      SELECT
        v.id,
        v.topic_id,
        v.title,
        v.description,
        v.category,
        v.premium_only,
        v.bunny_video_id,
        v.bunny_library_id,
        v.video_status,
        v.video_duration,
        v.video_thumbnail,
        v.playback_url,
        v.youtube_url,
        v.youtube_id,
        v.created_at,
        v.updated_at,
        t.slug AS topic_slug,
        t.title AS topic_title
      FROM video_lessons v
      LEFT JOIN topics t ON t.id = v.topic_id
      ORDER BY v.created_at ASC, v.id ASC
    `
  );
  return rows
    .filter((row) => row.topic_title !== null && row.topic_title !== undefined)
    .map(normalizeVideoLessonRow);
}

async function getVideoLessonByIdFromDb(videoId) {
  const key = String(videoId || "").trim();
  if (!key) return null;
  const row = await dbApi.get(
    `
      SELECT
        v.id,
        v.topic_id,
        v.title,
        v.description,
        v.category,
        v.premium_only,
        v.bunny_video_id,
        v.bunny_library_id,
        v.video_status,
        v.video_duration,
        v.video_thumbnail,
        v.playback_url,
        v.youtube_url,
        v.youtube_id,
        v.created_at,
        v.updated_at,
        t.slug AS topic_slug,
        t.title AS topic_title
      FROM video_lessons v
      LEFT JOIN topics t ON t.id = v.topic_id
      WHERE CAST(v.id AS TEXT) = ?
      LIMIT 1
    `,
    [key]
  );
  return row ? normalizeVideoLessonRow(row) : null;
}

async function getVideoLessonByBunnyVideoIdFromDb(bunnyVideoId) {
  const key = String(bunnyVideoId || "").trim();
  if (!key) return null;
  const row = await dbApi.get(
    `
      SELECT
        v.id,
        v.topic_id,
        v.title,
        v.description,
        v.category,
        v.premium_only,
        v.bunny_video_id,
        v.bunny_library_id,
        v.video_status,
        v.video_duration,
        v.video_thumbnail,
        v.playback_url,
        v.youtube_url,
        v.youtube_id,
        v.created_at,
        v.updated_at,
        t.slug AS topic_slug,
        t.title AS topic_title
      FROM video_lessons v
      LEFT JOIN topics t ON t.id = v.topic_id
      WHERE v.bunny_video_id = ?
      LIMIT 1
    `,
    [key]
  );
  return row ? normalizeVideoLessonRow(row) : null;
}

async function createVideoLesson(input, fileBuffer = null, contentType = "application/octet-stream") {
  const next = normalizeVideoLessonInput(input);
  const topic = await getTopicFromDb(next.topicId);
  if (!topic) throw new Error("Mavzu topilmadi");

  const description = next.description || String(topic.description || "").trim();
  const title = next.title || String(topic.title || "").trim();
  const category = next.category || String(topic.slug || "").trim();

  let bunnyVideoId = String(input?.bunnyVideoId || "").trim();
  let bunnyVideoInfo = null;
  let localThumbnailUrl = "";
  if (!bunnyVideoId) {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
      throw new Error("Video fayl yuborilishi kerak");
    }
    try {
      const thumbnailBuffer = await generateVideoThumbnail(fileBuffer, String(input?.fileName || "video.mp4"), contentType);
      const bucket = getR2BucketName();
      if (thumbnailBuffer && bucket) {
        const thumbnailKey = createMediaFileKey("video-thumbnails", "jpg");
        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ContentType: "image/jpeg"
          })
        );
        localThumbnailUrl = buildR2PublicUrl(thumbnailKey);
      }
    } catch (thumbnailError) {
      console.warn("[video-thumbnail]", thumbnailError?.message || thumbnailError);
    }

    const created = await createBunnyVideo({ title, description, category });
    bunnyVideoId = created.bunnyVideoId;
    try {
      await uploadBunnyVideo({ bunnyVideoId, buffer: fileBuffer, contentType });
      try {
        bunnyVideoInfo = normalizeBunnyInfo(await getBunnyVideoInfo(bunnyVideoId), bunnyVideoId);
      } catch (_infoError) {
        bunnyVideoInfo = null;
      }
    } catch (error) {
      await deleteBunnyVideo(bunnyVideoId);
      throw error;
    }
  }

  const status = normalizeVideoStatus(bunnyVideoInfo?.status || "processing", "processing");
  const duration = parseIntegerValue(bunnyVideoInfo?.duration, 0);
  const thumbnail = String(localThumbnailUrl || bunnyVideoInfo?.thumbnail || buildBunnyThumbnailUrl(bunnyVideoId)).trim();
  const playbackUrl = buildBunnyPlaybackUrl(bunnyVideoId);

  const result = await dbApi.get(
    `
      INSERT INTO video_lessons (
        topic_id,
        title,
        description,
        category,
        premium_only,
        bunny_video_id,
        bunny_library_id,
        video_status,
        video_duration,
        video_thumbnail,
        playback_url,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      RETURNING *
    `,
    [
      next.topicId,
      title,
      description,
      category,
      next.premiumOnly,
      bunnyVideoId,
      BUNNY_LIBRARY_ID,
      status,
      duration,
      thumbnail,
      playbackUrl
    ]
  );
  return normalizeVideoLessonRow({ ...result, topic_slug: topic.slug, topic_title: topic.title });
}

async function updateVideoLesson(videoId, input = {}, fileBuffer = null, contentType = "application/octet-stream") {
  const current = await getVideoLessonByIdFromDb(videoId);
  if (!current) throw new Error("Video topilmadi");
  const next = normalizeVideoLessonInput(input, current);
  const topic = await getTopicFromDb(next.topicId);
  if (!topic) throw new Error("Mavzu topilmadi");

  let bunnyVideoId = current.bunnyVideoId;
  let bunnyInfo = null;
  let localThumbnailUrl = "";
  if (fileBuffer && Buffer.isBuffer(fileBuffer) && fileBuffer.length) {
    try {
      const thumbnailBuffer = await generateVideoThumbnail(fileBuffer, String(input?.fileName || next.fileName || "video.mp4"), contentType);
      const bucket = getR2BucketName();
      if (thumbnailBuffer && bucket) {
        const thumbnailKey = createMediaFileKey("video-thumbnails", "jpg");
        await r2.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ContentType: "image/jpeg"
          })
        );
        localThumbnailUrl = buildR2PublicUrl(thumbnailKey);
      }
    } catch (thumbnailError) {
      console.warn("[video-thumbnail]", thumbnailError?.message || thumbnailError);
    }

    if (!bunnyVideoId) {
      const created = await createBunnyVideo({
        title: next.title || current.title,
        description: next.description || current.description,
        category: next.category || current.category
      });
      bunnyVideoId = created.bunnyVideoId;
    }
    try {
      await uploadBunnyVideo({ bunnyVideoId, buffer: fileBuffer, contentType });
      try {
        bunnyInfo = normalizeBunnyInfo(await getBunnyVideoInfo(bunnyVideoId), bunnyVideoId);
      } catch (_infoError) {
        bunnyInfo = null;
      }
    } catch (error) {
      if (bunnyVideoId && bunnyVideoId !== current.bunnyVideoId) {
        await deleteBunnyVideo(bunnyVideoId);
      }
      throw error;
    }
  }

  const title = next.title || current.title || topic.title;
  const description = next.description || current.description || topic.description || "";
  const category = next.category || current.category || topic.slug || "";
  const playbackUrl = buildBunnyPlaybackUrl(bunnyVideoId);
  const thumbnail = String(localThumbnailUrl || current.videoThumbnail || bunnyInfo?.thumbnail || buildBunnyThumbnailUrl(bunnyVideoId)).trim();
  const status = normalizeVideoStatus(bunnyInfo?.status || current.videoStatus || (bunnyVideoId ? "processing" : "failed"));
  const duration = parseIntegerValue(bunnyInfo?.duration, current.videoDuration);

  const result = await dbApi.get(
    `
      UPDATE video_lessons
      SET topic_id = ?,
          title = ?,
          description = ?,
          category = ?,
          premium_only = ?,
          bunny_video_id = ?,
          bunny_library_id = ?,
          video_status = ?,
          video_duration = ?,
          video_thumbnail = ?,
          playback_url = ?,
          updated_at = NOW()
      WHERE CAST(id AS TEXT) = ?
      RETURNING *
    `,
    [
      next.topicId,
      title,
      description,
      category,
      next.premiumOnly,
      bunnyVideoId,
      BUNNY_LIBRARY_ID,
      status,
      duration,
      thumbnail,
      playbackUrl,
      String(videoId)
    ]
  );

  return normalizeVideoLessonRow({ ...result, topic_slug: topic.slug, topic_title: topic.title });
}

async function deleteVideoLesson(videoId) {
  const current = await getVideoLessonByIdFromDb(videoId);
  if (current?.bunnyVideoId) {
    await deleteBunnyVideo(current.bunnyVideoId);
  }
  await dbApi.run("DELETE FROM video_lessons WHERE CAST(id AS TEXT) = ?", [String(videoId)]);
}

function buildTopicQuestionKey(topicId, questionId) {
  return `topic:${String(topicId)}:${String(questionId)}`;
}

function normalizeTopicQuestionSnapshot(topic, question, questionIndex) {
  const normalized = normalizeQuestions([question])[0];
  if (!normalized) return null;
  return {
    id: String(normalized.id || question?.id || `${questionIndex + 1}`),
    image: String(normalized.image || ""),
    audio: String(normalized.audio || ""),
    text: String(normalized.text || ""),
    options: Array.isArray(normalized.options) ? normalized.options.map((option) => String(option || "")) : [],
    correctIndex: Number.isFinite(Number(normalized.correctIndex)) ? Number(normalized.correctIndex) : 0,
    explanation: String(normalized.explanation || ""),
    i18n: normalizeQuestionI18n(normalized.i18n, normalized)
  };
}

function normalizeTopicQuestionBankRow(row) {
  return {
    questionKey: String(row.question_key || ""),
    topicId: Number(row.topic_id || 0),
    topicSlug: String(row.topic_slug || ""),
    topicTitle: String(row.topic_title || ""),
    questionId: String(row.question_id || ""),
    questionIndex: Number(row.question_index || 0),
    question: parseJsonValue(row.question, {})
  };
}

async function syncTopicQuestionBankFromTopics() {
  const topics = await getTopicsFromDb();
  const existingRows = await dbApi.all(
    "SELECT question_key, sort_order FROM topic_question_bank ORDER BY sort_order ASC, question_key ASC"
  );
  const sortOrderByKey = new Map(
    existingRows.map((row) => [String(row.question_key || ""), Number(row.sort_order || 0)])
  );
  let maxSortOrder = existingRows.reduce((max, row) => Math.max(max, Number(row.sort_order || 0)), 0);

  for (const topic of topics) {
    for (const [questionIndex, question] of (Array.isArray(topic.questions) ? topic.questions : []).entries()) {
      const questionId = String(question?.id || `${questionIndex + 1}`);
      const questionKey = buildTopicQuestionKey(topic.id, questionId);
      const snapshot = normalizeTopicQuestionSnapshot(topic, question, questionIndex);
      if (!snapshot) continue;

      const payload = {
        topic_id: topic.id,
        topic_slug: topic.slug,
        topic_title: topic.title,
        question_id: questionId,
        question_index: questionIndex,
        question: snapshot
      };

      if (sortOrderByKey.has(questionKey)) {
        await dbApi.run(
          `
            UPDATE topic_question_bank
            SET topic_id = ?,
                topic_slug = ?,
                topic_title = ?,
                question_id = ?,
                question_index = ?,
                question = ?::jsonb,
                updated_at = NOW()
            WHERE question_key = ?
          `,
          [
            payload.topic_id,
            payload.topic_slug,
            payload.topic_title,
            payload.question_id,
            payload.question_index,
            JSON.stringify(payload.question),
            questionKey
          ]
        );
      } else {
        maxSortOrder += 1;
        sortOrderByKey.set(questionKey, maxSortOrder);
        await dbApi.run(
          `
            INSERT INTO topic_question_bank (
              question_key,
              topic_id,
              topic_slug,
              topic_title,
              question_id,
              question_index,
              question,
              sort_order,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, NOW(), NOW())
            ON CONFLICT (question_key) DO UPDATE SET
              topic_id = EXCLUDED.topic_id,
              topic_slug = EXCLUDED.topic_slug,
              topic_title = EXCLUDED.topic_title,
              question_id = EXCLUDED.question_id,
              question_index = EXCLUDED.question_index,
              question = EXCLUDED.question,
              updated_at = EXCLUDED.updated_at
          `,
          [
            questionKey,
            payload.topic_id,
            payload.topic_slug,
            payload.topic_title,
            payload.question_id,
            payload.question_index,
            JSON.stringify(payload.question),
            maxSortOrder
          ]
        );
      }
    }
  }
}

async function getTopicQuestionBankFromDb() {
  await syncTopicQuestionBankFromTopics();
  const rows = await dbApi.all(
    "SELECT question_key, topic_id, topic_slug, topic_title, question_id, question_index, question, sort_order FROM topic_question_bank ORDER BY sort_order ASC, question_key ASC"
  );
  return rows.map(normalizeTopicQuestionBankRow);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildGeneratedCustomTestFromBankSize(bank, size) {
  const questions = bank.slice(0, size).map((item) => ({
    ...item.question,
    id: String(item.questionKey || item.question?.id || ""),
    kind: "ticket",
    sourceId: String(item.ticketId || ""),
    sourceTitle: String(item.ticketTitle || ""),
    questionIndex: Number(item.questionIndex || 0) + 1
  }));
  return {
    id: 1000 + size,
    title: `${size} ta`,
    questions,
    questionsCount: questions.length
  };
}

async function getProgressTicketById(ticketId) {
  return getTicketByIdFromDb(ticketId);
}

async function getGeneratedCustomTestsFromDb() {
  const bank = await getTicketQuestionBankFromDb();
  const results = [];
  for (let size = 20; size <= bank.length; size += 20) {
    results.push(buildGeneratedCustomTestFromBankSize(bank, size));
  }
  return results;
}

async function getGeneratedCustomTestByIdFromDb(testId) {
  const key = String(testId || "").trim();
  const match = /^(\d+)$/.exec(key);
  if (!match) return null;
  const rawId = Number(match[1]);
  const size = rawId >= 1000 ? rawId - 1000 : rawId;
  if (!Number.isFinite(size) || size <= 0 || size % 20 !== 0) return null;
  const bank = await getTicketQuestionBankFromDb();
  if (size > bank.length) return null;
  return buildGeneratedCustomTestFromBankSize(bank, size);
}

async function ensureUniqueTopicSlug(baseSlug, ignoreId = null) {
  let slug = slugifyTopic(baseSlug);
  let suffix = 2;
  while (true) {
    const conflict = ignoreId
      ? await dbApi.get("SELECT id FROM topics WHERE slug = ? AND id <> ?", [slug, String(ignoreId)])
      : await dbApi.get("SELECT id FROM topics WHERE slug = ?", [slug]);
    if (!conflict) return slug;
    slug = `${slugifyTopic(baseSlug)}-${suffix}`;
    suffix += 1;
  }
}

async function createTopic(input) {
  const next = normalizeTopicInput(input);
  const slug = await ensureUniqueTopicSlug(next.slug);
  const result = await dbApi.get(
    `
      INSERT INTO topics (slug, title, title_i18n, questions, admin_marked, created_at, updated_at)
      VALUES (?, ?, ?::jsonb, ?::jsonb, ?, NOW(), NOW())
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.titleI18n), JSON.stringify(next.questions), next.adminMarked]
  );
  await syncTopicQuestionBankFromTopics();
  return normalizeTopicRow(result);
}

async function updateTopic(topicId, input) {
  const current = await getTopicFromDb(topicId);
  if (!current) throw new Error("Mavzu topilmadi");
  const next = normalizeTopicInput(input, current.title, current);
  const slug = await ensureUniqueTopicSlug(next.slug, current.id);
  const result = await dbApi.get(
    `
      UPDATE topics
      SET slug = ?, title = ?, title_i18n = ?::jsonb, questions = ?::jsonb, admin_marked = ?, updated_at = NOW()
      WHERE id = ?
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.titleI18n), JSON.stringify(next.questions), next.adminMarked, current.id]
  );
  await syncTopicQuestionBankFromTopics();
  return normalizeTopicRow(result);
}

async function deleteTopic(topicId) {
  const current = await getTopicFromDb(topicId);
  if (!current) throw new Error("Mavzu topilmadi");
  await dbApi.run("DELETE FROM test_progress WHERE ticket_id = ?", [String(current.id)]);
  await dbApi.run("DELETE FROM topics WHERE id = ?", [String(current.id)]);
  await syncTopicQuestionBankFromTopics();
}

async function importTopicQuestions(topicId, questionItems, replace = false) {
  const current = await getTopicFromDb(topicId);
  if (!current) throw new Error("Mavzu topilmadi");
  if (!Array.isArray(questionItems)) throw new Error("questions massivi kerak");

  const importedQuestions = questionItems.map((item, index) => normalizeImportedTopicQuestion(item, index));
  const nextQuestions = replace ? importedQuestions : [...current.questions, ...importedQuestions];

  const updated = await dbApi.get(
    `
      UPDATE topics
      SET questions = ?::jsonb, admin_marked = ?, updated_at = NOW()
      WHERE id = ?
      RETURNING *
    `,
    [JSON.stringify(nextQuestions), current.adminMarked, String(current.id)]
  );
  await syncTopicQuestionBankFromTopics();
  return normalizeTopicRow(updated);
}

async function importTopics(topicItems) {
  if (!Array.isArray(topicItems)) throw new Error("topics massivi kerak");
  const upserted = [];
  for (let index = 0; index < topicItems.length; index += 1) {
    const item = topicItems[index];
    const existingInput = typeof item === "string" ? { title: item } : item || {};
      const existingBySlug = String(existingInput.slug || "").trim()
      ? await dbApi.get("SELECT id, slug, title, title_i18n, questions, admin_marked FROM topics WHERE slug = ?", [String(existingInput.slug).trim()])
      : null;
    const next = normalizeTopicInput(existingInput, existingInput.title || `Mavzu ${index + 1}`, existingBySlug ? normalizeTopicRow(existingBySlug) : null);
    const slug = existingBySlug ? String(existingBySlug.slug) : await ensureUniqueTopicSlug(next.slug);
    const existing = await dbApi.get("SELECT id, slug, title, title_i18n, questions, admin_marked FROM topics WHERE slug = ?", [slug]);
    if (existing) {
      const updated = await dbApi.get(
        `
          UPDATE topics
          SET title = ?, questions = ?::jsonb, updated_at = NOW()
          WHERE slug = ?
          RETURNING *
        `,
        [next.title, JSON.stringify(next.questions), slug]
      );
      upserted.push(normalizeTopicRow(updated));
    } else {
      const created = await dbApi.get(
        `
          INSERT INTO topics (slug, title, questions, created_at, updated_at)
          VALUES (?, ?, ?::jsonb, NOW(), NOW())
          RETURNING *
        `,
        [slug, next.title, JSON.stringify(next.questions)]
      );
      upserted.push(normalizeTopicRow(created));
    }
  }
  await syncTopicQuestionBankFromTopics();
  return upserted;
}

async function seedTopicsIfEmpty() {
  const existing = await dbApi.get("SELECT COUNT(*)::int AS count FROM topics");
  if (Number(existing?.count || 0) > 0) return;
  try {
    const raw = await fs.readFile(TOPICS_SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const topicItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.topics) ? parsed.topics : [];
    if (topicItems.length) {
      await importTopics(topicItems);
      console.log(`[topics] seeded ${topicItems.length} records from ${TOPICS_SEED_PATH}`);
    }
    await syncTopicQuestionBankFromTopics();
  } catch (error) {
    console.log(`[topics] seed skipped: ${error?.message || "unknown error"}`);
  }
}

function normalizeCustomTestRow(row) {
  return {
    id: Number(row.id),
    title: String(row.title || ""),
    questions: parseQuestionsValue(row.questions)
  };
}

function normalizeCustomTestInput(input = {}, fallbackTitle = "", current = null) {
  const source = typeof input === "string" ? { title: input } : input || {};
  const titleSource = source.title !== undefined ? source.title : current?.title || fallbackTitle;
  const title = String(titleSource || "").trim();
  if (!title) throw new Error("Test nomi kiritilishi kerak");
  return {
    title,
    questions:
      source.questions !== undefined
        ? normalizeQuestions(source.questions)
        : Array.isArray(current?.questions)
          ? current.questions
          : []
  };
}

async function getCustomTestsFromDb() {
  const rows = await dbApi.all("SELECT id, title, questions FROM custom_tests ORDER BY id ASC");
  return rows.map(normalizeCustomTestRow);
}

async function getCustomTestFromDb(testId) {
  const key = String(testId || "").trim();
  if (!key) return null;
  const row = await dbApi.get("SELECT id, title, questions FROM custom_tests WHERE CAST(id AS TEXT) = ? LIMIT 1", [key]);
  return row ? normalizeCustomTestRow(row) : null;
}

async function createCustomTest(input) {
  const next = normalizeCustomTestInput(input);
  const result = await dbApi.get(
    `
      INSERT INTO custom_tests (title, questions, created_at, updated_at)
      VALUES (?, ?::jsonb, NOW(), NOW())
      RETURNING *
    `,
    [next.title, JSON.stringify(next.questions)]
  );
  return normalizeCustomTestRow(result);
}

async function updateCustomTest(testId, input) {
  const current = await getCustomTestFromDb(testId);
  if (!current) throw new Error("Test topilmadi");
  const next = normalizeCustomTestInput(input, current.title, current);
  const result = await dbApi.get(
    `
      UPDATE custom_tests
      SET title = ?, questions = ?::jsonb, updated_at = NOW()
      WHERE id = ?
      RETURNING *
    `,
    [next.title, JSON.stringify(next.questions), current.id]
  );
  return normalizeCustomTestRow(result);
}

async function deleteCustomTest(testId) {
  const current = await getCustomTestFromDb(testId);
  if (!current) throw new Error("Test topilmadi");
  await dbApi.run("DELETE FROM custom_test_progress WHERE custom_test_id = ?", [String(current.id)]);
  await dbApi.run("DELETE FROM custom_tests WHERE id = ?", [String(current.id)]);
}

async function importCustomTests(testItems) {
  if (!Array.isArray(testItems)) throw new Error("customTests massivi kerak");
  const upserted = [];
  for (let index = 0; index < testItems.length; index += 1) {
    const item = testItems[index];
    const existingInput = typeof item === "string" ? { title: item } : item || {};
    const next = normalizeCustomTestInput(existingInput, existingInput.title || `Test ${index + 1}`, null);
    const existing = existingInput.id ? await getCustomTestFromDb(existingInput.id) : null;
    if (existing) {
      const updated = await dbApi.get(
        `
          UPDATE custom_tests
          SET title = ?, questions = ?::jsonb, updated_at = NOW()
          WHERE id = ?
          RETURNING *
        `,
        [next.title, JSON.stringify(next.questions), existing.id]
      );
      upserted.push(normalizeCustomTestRow(updated));
    } else {
      const created = await dbApi.get(
        `
          INSERT INTO custom_tests (title, questions, created_at, updated_at)
          VALUES (?, ?::jsonb, NOW(), NOW())
          RETURNING *
        `,
        [next.title, JSON.stringify(next.questions)]
      );
      upserted.push(normalizeCustomTestRow(created));
    }
  }
  return upserted;
}

async function seedCustomTestsIfEmpty() {
  const existing = await dbApi.get("SELECT COUNT(*)::int AS count FROM custom_tests");
  if (Number(existing?.count || 0) > 0) return;
  try {
    const raw = await fs.readFile(CUSTOM_TESTS_SEED_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const testItems = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.customTests) ? parsed.customTests : [];
    if (testItems.length) {
      await importCustomTests(testItems);
      console.log(`[custom-tests] seeded ${testItems.length} records from ${CUSTOM_TESTS_SEED_PATH}`);
    }
  } catch (error) {
    console.log(`[custom-tests] seed skipped: ${error?.message || "unknown error"}`);
  }
}

const openapi = {
  openapi: "3.0.3",
  info: {
    title: "Jo‘rabek Avto Test API",
    version: "0.1.0",
    description: "Web ilova uchun API. Auth: bearer token yoki cookie session orqali."
  },
  // Use relative server so Swagger "Try it out" works on both http://localhost and https://domain
  servers: [{ url: "/" }],
  components: {
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } }
      },
      User: {
        type: "object",
        properties: {
          id: { type: "integer" },
          full_name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          pro_until: { type: ["string", "null"], format: "date-time" },
          created_at: { type: "string", format: "date-time" }
        }
      },
      MeResponse: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          isPro: { type: "boolean" }
        }
      },
      RegisterBody: {
        type: "object",
        required: ["phone", "password"],
        properties: {
          fullName: { type: "string" },
          phone: { type: "string" },
          password: { type: "string" }
        }
      },
      LoginBody: {
        type: "object",
        required: ["phone", "password"],
        properties: { phone: { type: "string" }, password: { type: "string" } }
      },
      TicketsResponse: {
        type: "object",
        properties: {
          isPro: { type: "boolean" },
          tickets: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, title: { type: "string" }, locked: { type: "boolean" } }
            }
          }
        }
      },
      TicketQuestionInput: {
        type: "object",
        properties: {
          id: { type: "string" },
          image: { type: "string" },
          text: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          correctIndex: { type: "integer" },
          explanation: { type: "string" }
        }
      },
      TicketInput: {
        type: "object",
        required: ["title"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          questions: {
            type: "array",
            items: { $ref: "#/components/schemas/TicketQuestionInput" }
          }
        }
      },
      Ticket: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          questions: {
            type: "array",
            items: { $ref: "#/components/schemas/TicketQuestionInput" }
          },
          created_at: { type: ["string", "null"], format: "date-time" },
          updated_at: { type: ["string", "null"], format: "date-time" }
        }
      },
      TicketListItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          locked: { type: "boolean" }
        }
      },
      RefreshResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          accessToken: { type: "string" }
        }
      },
      TokenResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          token: { type: "string" }
        }
      },
      BoolOk: {
        type: "object",
        properties: { ok: { type: "boolean" } }
      },
      ProgressBody: {
        type: "object",
        required: ["answers"],
        properties: {
          answers: { type: "object", additionalProperties: { type: "integer" } }
        }
      },
      ProgressResponse: {
        type: "object",
        properties: {
          progress: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                properties: {
                  ticketId: { type: "string" },
                  answers: { type: "object" },
                  completed: { type: "boolean" },
                  score: { type: "integer" },
                  updatedAt: { type: ["string", "null"] }
                }
              }
            ]
          }
        }
      },
      ExamStartResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          exam: {
            type: "object",
            properties: {
              questionsCount: { type: "integer" }
            }
          }
        }
      },
      ExamResponse: {
        type: "object",
        properties: {
          exam: {
            type: "object",
            properties: {
              questions: { type: "array", items: { $ref: "#/components/schemas/TicketQuestionInput" } },
              answers: { type: "object" },
              completed: { type: "boolean" },
              score: { type: "integer" },
              updatedAt: { type: ["string", "null"] }
            }
          }
        }
      },
      ExamProgressBody: {
        type: "object",
        required: ["answers"],
        properties: {
          answers: { type: "object" }
        }
      },
      ExamProgressResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          completed: { type: "boolean" },
          score: { type: "integer" },
          total: { type: "integer" }
        }
      },
      PromoActivateBody: {
        type: "object",
        required: ["code"],
        properties: { code: { type: "string" } }
      },
      PromoActivateResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          user: { $ref: "#/components/schemas/User" },
          isPro: { type: "boolean" },
          proUntil: { type: ["string", "null"] }
        }
      },
      UploadImageBody: {
        type: "object",
        required: ["imageBase64", "imageName", "imageType"],
        properties: {
          imageBase64: { type: "string" },
          imageName: { type: "string" },
          imageType: { type: "string" },
          oldImageUrl: { type: "string" },
          ticketId: { type: "string" },
          questionId: { type: "string" }
        }
      },
      UploadImageResponse: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          imageUrl: { type: "string" },
          key: { type: "string" }
        }
      }
    }
  },
  paths: {
    "/openapi.json": {
      get: {
        summary: "OpenAPI schema",
        responses: { 200: { description: "OK" } }
      }
    },
    "/docs": {
      get: {
        summary: "Swagger UI",
        responses: { 200: { description: "OK" } }
      }
    },
    "/health": {
      get: {
        summary: "Health check",
        responses: { 200: { description: "OK" } }
      }
    },
    "/api/auth/register": {
      post: {
        summary: "Telefon orqali ro‘yxatdan o‘tish",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/register": {
      post: {
        summary: "Telefon orqali ro‘yxatdan o‘tish (cookie session)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/RegisterBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/auth/login": {
      post: {
        summary: "Telefon + parol orqali kirish",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/login": {
      post: {
        summary: "Telefon + parol orqali kirish (cookie session)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } } }
        },
	        responses: {
	          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
	          401: { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/auth/logout": {
      post: {
        summary: "Logout",
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BoolOk" } } } } }
      }
    },
    "/api/logout": {
      post: {
        summary: "Logout (cookie session o‘chadi)",
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BoolOk" } } } } }
      }
    },
    "/api/auth/refresh": {
      post: {
        summary: "Access token yangilash",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/RefreshResponse" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/auth": {
      post: {
        summary: "Joriy user",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/me": {
      get: {
        summary: "Joriy user (cookie yoki Telegram initData)",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          401: { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/auth/me": {
      get: {
        summary: "Joriy user",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/MeResponse" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/browser-token": {
      post: {
        summary: "Browser access token olish",
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } } } } }
      }
    },
    "/api/tickets": {
      get: {
        summary: "Biletlar ro‘yxati",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tickets: { type: "array", items: { $ref: "#/components/schemas/TicketListItem" } },
                    isPro: { type: "boolean" }
                  }
                }
              }
            }
          },
          401: { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/tickets/{ticketId}": {
      get: {
        summary: "Bitta bilet bo‘yicha ma’lumot",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ticket: { $ref: "#/components/schemas/Ticket" },
                    isPro: { type: "boolean" }
                  }
                }
              }
            }
          },
          401: { description: "Not authenticated", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/progress/{ticketId}": {
      get: {
        summary: "Test progress olish",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ProgressResponse" } } } },
          401: { description: "Unauthorized", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      },
      post: {
        summary: "Test progress saqlash",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ProgressBody" } } }
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    completed: { type: "boolean" },
                    score: { type: "integer" },
                    total: { type: "integer" }
                  }
                }
              }
            }
          },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/progress/{ticketId}/reset": {
      post: {
        summary: "Test progress reset",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BoolOk" } } } }
        }
      }
    },
    "/api/exam/start": {
      post: {
        summary: "Imtihonni boshlash",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ExamStartResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/exam": {
      get: {
        summary: "Imtihon savollarini olish",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ExamResponse" } } } },
          404: { description: "Not started", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/exam/progress": {
      post: {
        summary: "Imtihon progress saqlash",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/ExamProgressBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/ExamProgressResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          404: { description: "Not started", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/exam/reset": {
      post: {
        summary: "Imtihonni reset qilish",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/BoolOk" } } } }
        }
      }
    },
    "/api/promo/activate": {
      post: {
        summary: "Promo kod faollashtirish",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/PromoActivateBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/PromoActivateResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/admin/tickets": {
      get: {
        summary: "Admin: barcha testlar ro‘yxati",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    tickets: { type: "array", items: { $ref: "#/components/schemas/Ticket" } }
                  }
                }
              }
            }
          },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      },
      post: {
        summary: "Admin: yangi test yaratish",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TicketInput" } } }
        },
        responses: {
          201: {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    ticket: { $ref: "#/components/schemas/Ticket" }
                  }
                }
              }
            }
          },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/upload-image": {
      post: {
        summary: "Rasm yuklash",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UploadImageBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/UploadImageResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      },
      delete: {
        summary: "Rasm o‘chirish",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UploadImageBody" } } }
        },
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/UploadImageResponse" } } } },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/image": {
      get: {
        summary: "Rasm proksi",
        parameters: [
          {
            name: "u",
            in: "query",
            required: false,
            schema: { type: "string" }
          },
          {
            name: "url",
            in: "query",
            required: false,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: { description: "Image" },
          302: { description: "Redirect" },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    },
    "/api/admin/tickets/{ticketId}": {
      get: {
        summary: "Admin: bitta testni olish",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: { description: "OK" },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          404: { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      },
      patch: {
        summary: "Admin: testni yangilash",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/TicketInput" } } }
        },
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean" },
                    ticket: { $ref: "#/components/schemas/Ticket" }
                  }
                }
              }
            }
          },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      },
      delete: {
        summary: "Admin: testni o‘chirish",
        parameters: [
          {
            name: "ticketId",
            in: "path",
            required: true,
            schema: { type: "string" }
          }
        ],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" } }
                }
              }
            }
          },
          400: { description: "Bad request", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          403: { description: "Forbidden", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } }
        }
      }
    }
  }
};

app.get("/openapi.json", (_req, res) => res.json(openapi));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi, { explorer: true }));

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

function normalizeUzPhone(input) {
  const raw = String(input || "").trim();
  const digits = raw.replace(/\D/g, "");
  const local = digits.startsWith("998") ? digits.slice(3) : digits;
  if (local.length !== 9) throw new Error("Telefon raqam formati noto‘g‘ri. Masalan: +998-97-212-00-38");
  return `+998${local}`;
}

function normalizeEmail(input) {
  const email = String(input || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Email formati noto‘g‘ri");
  }
  return email;
}

function formatUzPhoneForUi(normalized) {
  const digits = String(normalized || "").replace(/\D/g, "");
  const local = digits.startsWith("998") ? digits.slice(3) : digits;
  if (local.length !== 9) return String(normalized || "");
  const aa = local.slice(0, 2);
  const bbb = local.slice(2, 5);
  const cc = local.slice(5, 7);
  const dd = local.slice(7, 9);
  return `+998-${aa}-${bbb}-${cc}-${dd}`;
}

async function createUserFromPhone({ fullName, phone, password, email }) {
  const cleanName = String(fullName || "").trim() || null;

  const cleanPassword = String(password || "");
  if (cleanPassword.length < 6) throw new Error("Kamida 6 ta belgidan iborat parol yarating");

  const normalizedPhone = normalizeUzPhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(cleanPassword, 10);

  const existing = await dbApi.get("SELECT id FROM users WHERE phone = ?", [normalizedPhone]);
  if (existing) {
    const err = new Error("Bu telefon raqam allaqachon ro‘yxatdan o‘tgan");
    err.statusCode = 409;
    throw err;
  }

  const row = await dbApi.get(
    `
      INSERT INTO users (full_name, phone, email, password_hash)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `,
    [cleanName, normalizedPhone, normalizedEmail, passwordHash]
  );
  return row;
}

async function updateUserAuthProfile(userId, fields) {
  const current = await dbApi.get("SELECT * FROM users WHERE id = ?", [String(userId)]);
  if (!current) throw new Error("Foydalanuvchi topilmadi");

  const nextFullName = fields.fullName !== undefined ? String(fields.fullName || "").trim() : String(current.full_name || "").trim();
  const nextEmail =
    fields.email !== undefined
      ? normalizeEmail(fields.email)
      : current.email
      ? normalizeEmail(current.email)
      : null;
  const nextGoogleSub =
    fields.googleSub !== undefined ? String(fields.googleSub || "").trim() || null : current.google_sub || null;
  const nextAppleSub =
    fields.appleSub !== undefined ? String(fields.appleSub || "").trim() || null : current.apple_sub || null;

  const updated = await dbApi.get(
    `
      UPDATE users
      SET full_name = ?,
          email = ?,
          google_sub = ?,
          apple_sub = ?
      WHERE id = ?
      RETURNING *
    `,
    [nextFullName || null, nextEmail, nextGoogleSub, nextAppleSub, String(userId)]
  );
  return updated;
}

async function findUserByOAuthIdentity({ email, googleSub, appleSub }) {
  if (!email && !googleSub && !appleSub) return null;

  const candidates = [];
  if (email) candidates.push(await dbApi.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]));
  if (googleSub) candidates.push(await dbApi.get("SELECT * FROM users WHERE google_sub = ?", [googleSub]));
  if (appleSub) candidates.push(await dbApi.get("SELECT * FROM users WHERE apple_sub = ?", [appleSub]));

  return candidates.find(Boolean) || null;
}

async function findUserByGoogleIdentity({ email, googleSub }) {
  return findUserByOAuthIdentity({ email, googleSub });
}

async function mergeUserAccounts(targetUserId, donorUserId) {
  const targetId = String(targetUserId);
  const donorId = String(donorUserId);
  if (!targetId || !donorId || targetId === donorId) return;

  const client = await dbApi.pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("UPDATE promo_requests SET user_id = $1 WHERE user_id = $2", [targetId, donorId]);
    await client.query("UPDATE promo_codes SET user_id = $1 WHERE user_id = $2", [targetId, donorId]);
    await client.query("UPDATE refresh_tokens SET user_id = $1 WHERE user_id = $2", [targetId, donorId]);

    await client.query(
      `
      INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
      SELECT $1, ticket_id, answers, completed, score, updated_at
      FROM test_progress
      WHERE user_id = $2
      ON CONFLICT (user_id, ticket_id) DO NOTHING
    `,
      [targetId, donorId]
    );
    await client.query("DELETE FROM test_progress WHERE user_id = $1", [donorId]);

    await client.query(
      `
      INSERT INTO user_mistakes (
        user_id,
        question_key,
        source_kind,
        source_id,
        source_title,
        question_index,
        question,
        wrong_answer,
        created_at,
        updated_at
      )
      SELECT
        $1,
        question_key,
        source_kind,
        source_id,
        source_title,
        question_index,
        question,
        wrong_answer,
        created_at,
        updated_at
      FROM user_mistakes
      WHERE user_id = $2
      ON CONFLICT (user_id, question_key) DO NOTHING
    `,
      [targetId, donorId]
    );
    await client.query("DELETE FROM user_mistakes WHERE user_id = $1", [donorId]);

    await client.query(
      `
      INSERT INTO custom_test_progress (user_id, custom_test_id, answers, completed, score, updated_at)
      SELECT $1, custom_test_id, answers, completed, score, updated_at
      FROM custom_test_progress
      WHERE user_id = $2
      ON CONFLICT (user_id, custom_test_id) DO NOTHING
    `,
      [targetId, donorId]
    );
    await client.query("DELETE FROM custom_test_progress WHERE user_id = $1", [donorId]);

    await client.query(
      `
      INSERT INTO exam_sessions (
        user_id,
        exam_count,
        duration_seconds,
        started_at,
        completed,
        score,
        selection,
        answers,
        updated_at
      )
      SELECT
        $1,
        exam_count,
        duration_seconds,
        started_at,
        completed,
        score,
        selection,
        answers,
        updated_at
      FROM exam_sessions
      WHERE user_id = $2
      ON CONFLICT (user_id) DO NOTHING
    `,
      [targetId, donorId]
    );
    await client.query("DELETE FROM exam_sessions WHERE user_id = $1", [donorId]);

    await client.query("DELETE FROM users WHERE id = $1", [donorId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function upsertGoogleUser({ fullName, email, googleSub, currentUserId = null }) {
  const normalizedEmail = normalizeEmail(email);
  const cleanGoogleSub = String(googleSub || "").trim();
  const currentUser = currentUserId ? await dbApi.get("SELECT * FROM users WHERE id = ?", [String(currentUserId)]) : null;
  if (!cleanGoogleSub) throw new Error("Google akkaunt ma'lumoti topilmadi");

  if (currentUser) {
    const donor = await findUserByGoogleIdentity({ email: normalizedEmail, googleSub: cleanGoogleSub });
    if (donor && String(donor.id) !== String(currentUser.id)) {
      await mergeUserAccounts(currentUser.id, donor.id);
    }

    return updateUserAuthProfile(currentUser.id, {
      fullName: fullName || currentUser.full_name || normalizedEmail,
      email: normalizedEmail || currentUser.email,
      googleSub: cleanGoogleSub
    });
  }

  const existing = await findUserByGoogleIdentity({ email: normalizedEmail, googleSub: cleanGoogleSub });
  if (existing) {
    return updateUserAuthProfile(existing.id, {
      fullName: fullName || existing.full_name || normalizedEmail,
      email: normalizedEmail || existing.email,
      googleSub: cleanGoogleSub
    });
  }

  const created = await dbApi.get(
    `
      INSERT INTO users (full_name, phone, email, google_sub)
      VALUES (?, NULL, ?, ?)
      RETURNING *
    `,
    [String(fullName || normalizedEmail || "Foydalanuvchi"), normalizedEmail, cleanGoogleSub]
  );
  return created;
}

async function upsertAppleUser({ fullName, email, appleSub, currentUserId = null }) {
  const normalizedEmail = normalizeEmail(email);
  const cleanAppleSub = String(appleSub || "").trim();
  const currentUser = currentUserId ? await dbApi.get("SELECT * FROM users WHERE id = ?", [String(currentUserId)]) : null;
  if (!cleanAppleSub) throw new Error("Apple akkaunt ma'lumoti topilmadi");

  if (currentUser) {
    const donor = await findUserByOAuthIdentity({ email: normalizedEmail, appleSub: cleanAppleSub });
    if (donor && String(donor.id) !== String(currentUser.id)) {
      await mergeUserAccounts(currentUser.id, donor.id);
    }

    return updateUserAuthProfile(currentUser.id, {
      fullName: fullName || currentUser.full_name || normalizedEmail || "Foydalanuvchi",
      email: normalizedEmail || currentUser.email,
      appleSub: cleanAppleSub
    });
  }

  const existing = await findUserByOAuthIdentity({ email: normalizedEmail, appleSub: cleanAppleSub });
  if (existing) {
    return updateUserAuthProfile(existing.id, {
      fullName: fullName || existing.full_name || normalizedEmail || "Foydalanuvchi",
      email: normalizedEmail || existing.email,
      appleSub: cleanAppleSub
    });
  }

  const created = await dbApi.get(
    `
      INSERT INTO users (full_name, phone, email, apple_sub)
      VALUES (?, NULL, ?, ?)
      RETURNING *
    `,
    [String(fullName || normalizedEmail || "Foydalanuvchi"), normalizedEmail, cleanAppleSub]
  );
  return created;
}

async function verifyGoogleIdToken(idToken) {
  const token = String(idToken || "").trim();
  if (!token) throw new Error("Google token topilmadi");

  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error_description || body.error || "Google login tasdiqlanmadi");
  }

  const audience = String(body.aud || "");
  if (!GOOGLE_CLIENT_IDS.has(audience)) {
    throw new Error("Google client ID mos emas");
  }

  return {
    email: String(body.email || "").trim().toLowerCase(),
    fullName: String(body.name || body.given_name || body.email || "").trim(),
    googleSub: String(body.sub || "").trim(),
    picture: String(body.picture || "").trim()
  };
}

async function verifyAppleIdentityToken(identityToken) {
  const token = String(identityToken || "").trim();
  if (!token) throw new Error("Apple token topilmadi");

  const { createRemoteJWKSet, jwtVerify } = await import("jose");
  if (!appleJwks) {
    appleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  }

  let verified = null;
  let lastError = null;
  for (const audience of APPLE_AUDIENCES) {
    try {
      verified = await jwtVerify(token, appleJwks, {
        issuer: "https://appleid.apple.com",
        audience
      });
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!verified) {
    throw new Error(lastError?.message || "Apple login tasdiqlanmadi");
  }

  const payload = verified.payload || {};
  return {
    email: String(payload.email || "").trim().toLowerCase(),
    appleSub: String(payload.sub || "").trim()
  };
}

function generateTemporaryPassword(length = 6) {
  const digits = crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");
  return digits.slice(0, length);
}

function generateAdminTemporaryPassword() {
  const digits = crypto.randomInt(0, 100000).toString().padStart(5, "0");
  return `RT-${digits}`;
}

function createMailTransport() {
  if (!nodemailer) return null;
  const host = String(process.env.SMTP_HOST || "").trim();
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.SMTP_FROM || "").trim();
  if (!host || !user || !pass || !from) return null;

  return {
    from,
    transporter: nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || "").trim() === "true",
      auth: { user, pass }
    })
  };
}

async function sendTemporaryPasswordEmail({ to, password, fullName }) {
  const mail = createMailTransport();
  if (!mail) {
    return { sent: false };
  }

  await mail.transporter.sendMail({
    from: mail.from,
    to,
    subject: "Road-test: 6 xonali kod",
    text: `Salom ${fullName || ""}\n\nSizning 6 xonali kodingiz: ${password}\n\nRoad-test`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111">
        <h2 style="margin:0 0 12px">Road-test</h2>
        <p>Salom ${fullName || ""},</p>
        <p>Sizning 6 xonali kodingiz:</p>
        <div style="display:inline-block;padding:12px 16px;border-radius:10px;background:#eef4ff;font-size:18px;font-weight:700;letter-spacing:1px">${password}</div>
        <p style="margin-top:18px">Kirish uchun shu koddan foydalaning.</p>
      </div>
    `
  });

  return { sent: true };
}

async function verifyPasswordLogin({ phone, password }) {
  const normalizedPhone = normalizeUzPhone(phone);
  const row = await dbApi.get("SELECT * FROM users WHERE phone = ?", [normalizedPhone]);
  if (!row?.password_hash) return { ok: false, error: "Oldin ro‘yxatdan o‘ting" };
  const ok = await bcrypt.compare(String(password || ""), String(row.password_hash));
  if (!ok) return { ok: false, error: "Telefon yoki parol noto‘g‘ri" };
  return { ok: true, user: row };
}

async function requireUser(req, res, next) {
  const user = await getUserFromAccess(req);
  if (!user) return res.status(401).json({ error: "Kirish talab qilinadi" });
  req.user = user;
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

function isSecureRequest(req) {
  if (req.secure) return true;
  const xfProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
  return xfProto === "https";
}

// 2 oy atrofida sessiya saqlash uchun access va refresh tokenlar muddati uzaytirildi.
const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 60;

function getSecret() {
  return process.env.AUTH_JWT_SECRET || process.env.SESSION_SECRET || process.env.BOT_TOKEN || "";
}

function signPayload(payloadB64) {
  const secret = getSecret();
  if (!secret) throw new Error("Missing AUTH_JWT_SECRET (or SESSION_SECRET)");
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function signAccessToken(userId, isAdmin = false) {
  const payload = {
    typ: "access",
    sub: String(userId),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_MAX_AGE_SECONDS,
    adm: Boolean(isAdmin)
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

function signRefreshToken(userId) {
  const payload = {
    typ: "refresh",
    sub: String(userId),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_MAX_AGE_SECONDS
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  return `${payloadB64}.${signPayload(payloadB64)}`;
}

async function verifyToken(token) {
  const raw = String(token || "");
  const [payloadB64, sig] = raw.split(".");
  if (!payloadB64 || !sig) return { ok: false, error: "Bad token" };
  if (signPayload(payloadB64) !== sig) return { ok: false, error: "Bad token signature" };
  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (!payload?.sub) return { ok: false, error: "Bad token payload" };
    if (Number(payload.exp) <= now) return { ok: false, error: "Token expired" };
    return { ok: true, payload };
  } catch {
    return { ok: false, error: "Bad token payload" };
  }
}

function buildRefreshCookie(value, req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `refresh_token=${encodeURIComponent(value)}; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_TOKEN_MAX_AGE_SECONDS}${secure}`;
}

function clearRefreshCookie(req) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  return `refresh_token=; Path=/api/auth/refresh; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

async function issueTokensForUser(userId, req, res) {
  const user = await dbApi.get("SELECT * FROM users WHERE id = ?", [String(userId)]);
  const isAdmin = Boolean(user && (user.is_admin === true || String(user.id) === "1"));
  const accessToken = signAccessToken(userId, isAdmin);
  const refreshToken = signRefreshToken(userId);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_MAX_AGE_SECONDS * 1000).toISOString();
  await dbApi.run(
    `INSERT INTO refresh_tokens (user_id, token_hash, revoked, expires_at) VALUES (?, ?, FALSE, ?)`
      ,
    [String(userId), hashToken(refreshToken), expiresAt]
  );
  res.setHeader("Set-Cookie", [buildRefreshCookie(refreshToken, req)]);
  return { accessToken };
}

async function readRefreshCookie(req) {
  return parseCookies(req).refresh_token || null;
}

async function revokeRefreshToken(refreshToken) {
  await dbApi.run(`UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = ?`, [hashToken(refreshToken)]);
}

async function rotateRefreshToken(refreshToken, req, res) {
  const verified = await verifyToken(refreshToken);
  if (!verified.ok) throw new Error(verified.error);
  if (verified.payload.typ !== "refresh") throw new Error("Token turi noto‘g‘ri");
  const tokenHash = hashToken(refreshToken);
  const row = await dbApi.get(`SELECT * FROM refresh_tokens WHERE token_hash = ?`, [tokenHash]);
  if (!row) throw new Error("Yangilash tokeni topilmadi");
  if (row.revoked) throw new Error("Yangilash tokeni bekor qilingan");
  if (new Date(row.expires_at).getTime() <= Date.now()) throw new Error("Yangilash tokeni muddati tugagan");
  await dbApi.run(`UPDATE refresh_tokens SET revoked = TRUE WHERE id = ?`, [row.id]);
  return issueTokensForUser(verified.payload.sub, req, res);
}

async function getUserFromAccess(req) {
  const auth = String(req.headers.authorization || "");
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const verified = await verifyToken(match[1]);
  if (!verified.ok || verified.payload.typ !== "access") return null;
  const user = await dbApi.get("SELECT * FROM users WHERE id = ?", [String(verified.payload.sub)]);
  return user || null;
}

async function getAdminFromAccess(req) {
  const user = await getUserFromAccess(req);
  if (!user || !(user.is_admin === true || String(user.id) === "1")) return null;
  return user;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"]);
const MAX_AUDIO_SIZE = 10 * 1024 * 1024;
const ADMIN_ACCESS_DENIED_MESSAGE = "Bu bo‘limga kirish uchun admin akkaunt kerak.";

function getR2PublicBaseUrl() {
  return String(process.env.R2_PUBLIC_URL || "").replace(/\/+$/, "");
}

function getR2BucketName() {
  return String(process.env.R2_BUCKET_NAME || "");
}

function buildR2PublicUrl(key) {
  return `${getR2PublicBaseUrl()}/${String(key).replace(/^\/+/, "")}`;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function convertAudioToM4a(buffer, inputName = "audio") {
  const inputDir = await fs.mkdtemp(path.join(require("os").tmpdir(), "road-test-audio-"));
  const inputPath = path.join(inputDir, `${inputName}.input`);
  const outputPath = path.join(inputDir, `${inputName}.m4a`);

  try {
    await fs.writeFile(inputPath, buffer);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath
      ],
      { stdio: "pipe" }
    );

    if (result.status !== 0) {
      throw new Error(
        `Audio konvertatsiyasi muvaffaqiyatsiz: ${String(result.stderr || result.stdout || "").trim() || "ffmpeg xatosi"}`
      );
    }

    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(inputDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getVideoExtensionFromFile(fileName = "", contentType = "") {
  const fromName = String(fileName || "").split(".").pop().toLowerCase();
  if (["mp4", "mov", "mkv", "webm", "m4v", "avi", "wmv"].includes(fromName)) return fromName;
  const type = String(contentType || "").toLowerCase();
  if (type.includes("mp4")) return "mp4";
  if (type.includes("quicktime")) return "mov";
  if (type.includes("webm")) return "webm";
  if (type.includes("x-matroska") || type.includes("mkv")) return "mkv";
  if (type.includes("x-msvideo") || type.includes("avi")) return "avi";
  return "mp4";
}

async function generateVideoThumbnail(buffer, fileName = "video.mp4", contentType = "video/mp4") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
  const tempDir = await fs.mkdtemp(path.join(require("os").tmpdir(), "road-test-thumb-"));
  const extension = getVideoExtensionFromFile(fileName, contentType);
  const inputPath = path.join(tempDir, `input.${extension}`);
  const outputPath = path.join(tempDir, "thumbnail.jpg");

  try {
    await fs.writeFile(inputPath, buffer);
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        "00:00:02",
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-1:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        outputPath
      ],
      { stdio: "pipe" }
    );

    if (result.status !== 0) {
      throw new Error(
        `Video preview yaratilmadi: ${String(result.stderr || result.stdout || "").trim() || "ffmpeg xatosi"}`
      );
    }

    const thumbnailBuffer = await fs.readFile(outputPath);
    if (!thumbnailBuffer.length) throw new Error("Video preview bo‘sh qaytdi");
    return thumbnailBuffer;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function isSupportedPlaybackAudio(contentType, url = "") {
  const type = String(contentType || "").toLowerCase();
  const source = String(url || "").toLowerCase();
  return (
    type.startsWith("audio/mpeg") ||
    type.startsWith("audio/mp4") ||
    type.startsWith("audio/wav") ||
    source.endsWith(".mp3") ||
    source.endsWith(".m4a") ||
    source.endsWith(".wav")
  );
}

async function fetchAudioAsM4a(sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Audio yuklab bo‘lmadi: ${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (isSupportedPlaybackAudio(contentType, sourceUrl)) {
    return { buffer, contentType: contentType || "audio/mp4" };
  }

  const convertedBuffer = await convertAudioToM4a(buffer, "proxy-audio");
  return { buffer: convertedBuffer, contentType: "audio/mp4" };
}

async function getAudioProxyPayload(sourceUrl) {
  const bucket = getR2BucketName();
  if (!bucket) throw new Error("R2 bucket sozlanmagan");

  const key = deriveR2KeyFromPublicUrl(sourceUrl);
  if (!key) throw new Error("Audio manzili noto‘g‘ri");

  const object = await r2.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key
    })
  );

  const contentType = String(object.ContentType || "").trim();
  const sourceBuffer = object.Body ? await streamToBuffer(object.Body) : Buffer.alloc(0);
  if (!sourceBuffer.length) throw new Error("Audio fayli bo‘sh");

  if (isSupportedPlaybackAudio(contentType, sourceUrl)) {
    return { buffer: sourceBuffer, contentType: contentType || "audio/mp4" };
  }

  const convertedBuffer = await convertAudioToM4a(sourceBuffer, path.basename(key).replace(/\.[^.]+$/, "") || "audio");
  return { buffer: convertedBuffer, contentType: "audio/mp4" };
}

function isAllowedAudioType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  return Array.from(ALLOWED_AUDIO_TYPES).some((allowed) => value === allowed || value.startsWith(`${allowed};`));
}

function createMediaFileKey(folder, extension) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${String(folder || "media").replace(/\/+$/, "")}/${Date.now()}-${random}.${extension}`;
}

function normalizeAnswerQuestion(question) {
  const options = Array.isArray(question?.options) ? question.options.map((option) => String(option || "").trim()) : [];
  const correctIndex = Number.isFinite(Number(question?.correctIndex)) ? Number(question.correctIndex) : 0;
  return {
    id: String(question?.id || ""),
    text: String(question?.text || ""),
    image: String(question?.image || ""),
    audio: String(question?.audio || ""),
    options,
    correctIndex,
    correctAnswer: options[correctIndex] || "",
    explanation: String(question?.explanation || ""),
    hasImage: Boolean(String(question?.image || "").trim()),
    i18n: normalizeQuestionI18n(question?.i18n, question)
  };
}

function buildAnswerQuestion({ kind, id, title, question, questionIndex }) {
  const normalized = normalizeAnswerQuestion(question);
  return {
    ...normalized,
    id: `${kind}:${String(id)}:${normalized.id || questionIndex}`,
    kind,
    sourceId: String(id),
    sourceTitle: String(title || ""),
    sourceKind: kind,
    questionIndex: Number(questionIndex) + 1
  };
}

function buildMistakeQuestion({ kind, id, title, question, questionIndex, wrongAnswer }) {
  const base = buildAnswerQuestion({ kind, id, title, question, questionIndex });
  return {
    ...base,
    wrongAnswer: Number.isFinite(Number(wrongAnswer)) ? Number(wrongAnswer) : null
  };
}

function calculateTicketProgressStats(ticket, answers = {}) {
  const questions = Array.isArray(ticket?.questions) ? ticket.questions : [];
  let correctCount = 0;
  let answeredCount = 0;

  for (const question of questions) {
    if (!question) continue;
    const selected = answers?.[question.id];
    if (selected === undefined || selected === null) continue;
    answeredCount += 1;
    if (Number(selected) === Number(question.correctIndex)) correctCount += 1;
  }

  const totalCount = questions.length;
  const wrongCount = Math.max(0, answeredCount - correctCount);
  const unansweredCount = Math.max(0, totalCount - answeredCount);

  return {
    totalCount,
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount
  };
}

async function deleteUserMistake(userId, questionKey) {
  await dbApi.run("DELETE FROM user_mistakes WHERE user_id = ? AND question_key = ?", [String(userId), String(questionKey)]);
}

async function upsertUserMistake({ userId, question, wrongAnswer }) {
  await dbApi.run(
    `
    INSERT INTO user_mistakes (
      user_id,
      question_key,
      source_kind,
      source_id,
      source_title,
      question_index,
      question,
      wrong_answer,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, NOW(), NOW())
    ON CONFLICT (user_id, question_key) DO UPDATE SET
      source_kind = EXCLUDED.source_kind,
      source_id = EXCLUDED.source_id,
      source_title = EXCLUDED.source_title,
      question_index = EXCLUDED.question_index,
      question = EXCLUDED.question,
      wrong_answer = EXCLUDED.wrong_answer,
      updated_at = EXCLUDED.updated_at
  `,
    [
      String(userId),
      String(question.id),
      String(question.kind || ""),
      String(question.sourceId || ""),
      String(question.sourceTitle || ""),
      Number(question.questionIndex || 0),
      JSON.stringify(question),
      Number.isFinite(Number(wrongAnswer)) ? Number(wrongAnswer) : null
    ]
  );
}

async function syncMistakesFromQuestions({ userId, kind, id, title, questions, answers }) {
  for (const [index, question] of (Array.isArray(questions) ? questions : []).entries()) {
    const nextAnswer = answers?.[question?.id];
    if (nextAnswer === undefined || nextAnswer === null) continue;

    const mistakeQuestion = buildMistakeQuestion({ kind, id, title, question, questionIndex: index, wrongAnswer: nextAnswer });
    if (Number(nextAnswer) === mistakeQuestion.correctIndex) {
      await deleteUserMistake(userId, mistakeQuestion.id);
    } else {
      await upsertUserMistake({ userId, question: mistakeQuestion, wrongAnswer: nextAnswer });
    }
  }
}

async function syncMistakesFromExam({ userId, selection, answers, pool }) {
  const byKey = new Map(
    (Array.isArray(pool) ? pool : []).map((item) => [
      `${String(item.kind || "ticket")}:${String(item.sourceId || item.ticketId || "")}:${String(item.question?.id || "")}`,
      item
    ])
  );

  for (const selected of Array.isArray(selection) ? selection : []) {
    const poolItem = byKey.get(
      `${String(selected.kind || "ticket")}:${String(selected.sourceId || selected.ticketId || "")}:${String(selected.questionId || selected.question?.id || "")}`
    );
    if (!poolItem) continue;

    const nextAnswer = answers?.[poolItem.question.id];
    if (nextAnswer === undefined || nextAnswer === null) continue;

    const mistakeQuestion = buildMistakeQuestion({
      kind: poolItem.kind || "ticket",
      id: poolItem.sourceId || poolItem.ticketId,
      title: poolItem.sourceTitle || poolItem.ticketTitle,
      question: poolItem.question,
      questionIndex: poolItem.questionIndex,
      wrongAnswer: nextAnswer
    });

    if (Number(nextAnswer) === mistakeQuestion.correctIndex) {
      await deleteUserMistake(userId, mistakeQuestion.id);
    } else {
      await upsertUserMistake({ userId, question: mistakeQuestion, wrongAnswer: nextAnswer });
    }
  }
}

function getExamDurationSeconds(examCount) {
  return 25 * 60;
}

function normalizeExamCount(value) {
  return 20;
}

function buildExamQuestionKey({ kind, sourceId, questionId }) {
  return `${String(kind)}:${String(sourceId)}:${String(questionId)}`;
}

async function getExamQuestionPool() {
  const bank = await getTopicQuestionBankFromDb();
  return bank.map((item) => ({
    kind: "topic",
    sourceId: String(item.topicId),
    sourceTitle: String(item.topicTitle || ""),
    questionIndex: Number(item.questionIndex || 0),
    questionKey: String(item.questionKey || ""),
    question: item.question
  }));
}

function buildExamQuestionItem(poolItem) {
  const normalized = normalizeAnswerQuestion(poolItem.question);
  return {
    id: poolItem.questionKey,
    kind: poolItem.kind,
    sourceId: poolItem.sourceId,
    sourceTitle: poolItem.sourceTitle,
    questionIndex: Number(poolItem.questionIndex) + 1,
    ...normalized
  };
}

function getExamQuestionSelectionSize(requestedCount) {
  return normalizeExamCount(requestedCount);
}

async function selectRandomExamQuestions(count) {
  const pool = await getExamQuestionPool();
  const desiredCount = getExamQuestionSelectionSize(count);
  if (pool.length < desiredCount) {
    const err = new Error("Imtihon uchun savollar yetarli emas");
    err.statusCode = 400;
    throw err;
  }

  const poolCopy = [...pool];
  shuffleInPlace(poolCopy);
  const seen = new Set();
  const selection = [];
  for (const item of poolCopy) {
    if (seen.has(item.questionKey)) continue;
    seen.add(item.questionKey);
    selection.push(item);
    if (selection.length >= desiredCount) break;
  }

  if (selection.length < desiredCount) {
    const err = new Error("Imtihon uchun savollar yetarli emas");
    err.statusCode = 400;
    throw err;
  }

  return selection;
}

async function getExamSession(userId) {
  return dbApi.get("SELECT * FROM exam_sessions WHERE user_id = ?", [String(userId)]);
}

async function updateExamSession(userId, fields) {
  const current = await getExamSession(userId);
  if (!current) return null;
  const nextCount = Number.isFinite(Number(fields.examCount)) ? Number(fields.examCount) : Number(current.exam_count || 50);
  const nextDuration = Number.isFinite(Number(fields.durationSeconds))
    ? Number(fields.durationSeconds)
    : Number(current.duration_seconds || getExamDurationSeconds(nextCount));
  const nextSelection = fields.selection !== undefined ? JSON.stringify(fields.selection) : JSON.stringify(current.selection || []);
  const nextAnswers = fields.answers !== undefined ? JSON.stringify(fields.answers) : JSON.stringify(current.answers || {});
  const nextCompleted = fields.completed !== undefined ? Boolean(fields.completed) : Boolean(current.completed);
  const nextScore = Number.isFinite(Number(fields.score)) ? Number(fields.score) : Number(current.score || 0);
  const nextStartedAt = fields.startedAt ? new Date(fields.startedAt).toISOString() : String(current.started_at);
  const result = await dbApi.get(
    `
    UPDATE exam_sessions
    SET exam_count = ?,
        duration_seconds = ?,
        started_at = ?,
        completed = ?,
        score = ?,
        selection = ?::jsonb,
        answers = ?::jsonb,
        updated_at = NOW()
    WHERE user_id = ?
    RETURNING *
  `,
    [
      nextCount,
      nextDuration,
      nextStartedAt,
      nextCompleted,
      nextScore,
      nextSelection,
      nextAnswers,
      String(userId)
    ]
  );
  return result;
}

function getExamTiming(session) {
  const startedAtValue = session.started_at || session.startedAt;
  const durationValue = session.duration_seconds || session.durationSeconds;
  const examCountValue = session.exam_count || session.examCount || 50;
  const startedAt = new Date(startedAtValue).getTime();
  const durationSeconds = Number(durationValue || getExamDurationSeconds(examCountValue));
  const expiresAt = startedAt + durationSeconds * 1000;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return {
    startedAt: new Date(startedAt).toISOString(),
    durationSeconds,
    expiresAt: new Date(expiresAt).toISOString(),
    remainingSeconds,
    expired: remainingSeconds <= 0
  };
}

async function finalizeExamSession(userId, session, poolOverride = null) {
  const currentSession = session || (await getExamSession(userId));
  if (!currentSession) return null;

  const timing = getExamTiming(currentSession);
  if (!timing.expired || currentSession.completed) {
    return { session: currentSession, timing };
  }

  const selection = parseJsonValue(currentSession.selection || [], []);
  const answers = parseJsonValue(currentSession.answers || {}, {});
  const scored = calculateExamScore(selection, answers);

  const updated = await dbApi.get(
    `
    UPDATE exam_sessions
    SET completed = TRUE,
        score = ?,
        updated_at = NOW()
    WHERE user_id = ?
    RETURNING *
  `,
    [scored.correct, String(userId)]
  );

  await syncMistakesFromExam({
    userId,
    selection,
    answers,
    pool: selection
  }).catch(() => {});

  return {
    session: updated || currentSession,
    timing: getExamTiming(updated || currentSession),
    score: scored.correct,
    answeredCount: scored.answeredCount
  };
}

function calculateExamScore(selection, answers) {
  let correct = 0;
  let answeredCount = 0;

  for (const [index, selected] of (Array.isArray(selection) ? selection : []).entries()) {
    const candidateKeys = [
      selected?.questionKey,
      selected?.id,
      selected?.question?.id,
      String(index)
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    const nextAnswer = candidateKeys.map((key) => answers?.[key]).find((value) => value !== undefined && value !== null);
    if (nextAnswer === undefined || nextAnswer === null) continue;
    answeredCount += 1;
    if (Number(nextAnswer) === Number(selected?.question?.correctIndex)) correct += 1;
  }

  return { correct, answeredCount };
}

function deriveR2KeyFromPublicUrl(urlValue) {
  const value = String(urlValue || "").trim();
  if (!value) return null;
  const publicBase = getR2PublicBaseUrl();
  if (!publicBase) return null;
  try {
    const parsed = new URL(value);
    const base = new URL(publicBase);
    if (parsed.origin === base.origin) {
      return parsed.pathname.replace(/^\/+/, "");
    }
  } catch {}
  if (value.startsWith(publicBase)) return value.slice(publicBase.length).replace(/^\/+/, "");
  return null;
}

function getExtensionFromFile(file) {
  const filename = file.name || "";
  const fromName = filename.includes(".") ? filename.split(".").pop() : "";
  const ext = String(fromName || "").toLowerCase();
  if (ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "webp") return ext;
  if (file.type === "image/jpeg") return "jpg";
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  return "";
}

function createFileKey(extension) {
  return createMediaFileKey("images", extension);
}

function getAudioExtensionFromFile(file) {
  const filename = file.name || "";
  const fromName = filename.includes(".") ? filename.split(".").pop() : "";
  const ext = String(fromName || "").toLowerCase();
  if (["webm", "ogg", "mp4", "m4a", "mp3", "wav"].includes(ext)) return ext === "mp4" ? "m4a" : ext;
  const mimeType = String(file.type || "").toLowerCase();
  if (mimeType.startsWith("audio/webm")) return "webm";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/mpeg")) return "mp3";
  if (mimeType.startsWith("audio/wav")) return "wav";
  return "";
}

async function respondWithAuthUser(req, res, user) {
  const phoneUi = user.phone ? formatUzPhoneForUi(user.phone) : null;
  const tokens = await issueTokensForUser(user.id, req, res);
  const passwordResetRequired = Boolean(user.password_reset_required || user.must_change_password);
  res.json({
    ok: true,
    accessToken: tokens.accessToken,
    user: {
      ...user,
      phone: phoneUi,
      password_reset_required: passwordResetRequired,
      must_change_password: passwordResetRequired
    },
    isPro: isUserPro(user),
    mustChangePassword: passwordResetRequired
  });
}

function publicAuthUser(user) {
  const phoneUi = user.phone ? formatUzPhoneForUi(user.phone) : null;
  const passwordResetRequired = Boolean(user.password_reset_required || user.must_change_password);
  return {
    ...user,
    phone: phoneUi,
    password_reset_required: passwordResetRequired,
    must_change_password: passwordResetRequired
  };
}

async function handleRegister(req, res) {
  try {
    const user = await createUserFromPhone({
      fullName: req.body?.fullName,
      phone: req.body?.phone,
      password: req.body?.password,
      email: req.body?.email
    });
    await respondWithAuthUser(req, res, user);
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
}

async function handleLogin(req, res) {
  const v = await verifyPasswordLogin({ phone: req.body?.phone, password: req.body?.password }).catch((e) => ({
    ok: false,
    error: e?.message || "Telefon yoki parol noto‘g‘ri"
  }));
  if (!v.ok) return res.status(401).json({ error: v.error || "Telefon yoki parol noto‘g‘ri" });
  await respondWithAuthUser(req, res, v.user);
}

async function handleGoogleLogin(req, res) {
  try {
    const profile = await verifyGoogleIdToken(req.body?.idToken);
    const currentUser = await getUserFromAccess(req).catch(() => null);
    const user = await upsertGoogleUser({
      fullName: profile.fullName,
      email: profile.email,
      googleSub: profile.googleSub,
      currentUserId: currentUser?.id || null
    });
    await respondWithAuthUser(req, res, user);
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Google orqali kirish amalga oshmadi" });
  }
}

async function handleAppleLogin(req, res) {
  try {
    const profile = await verifyAppleIdentityToken(req.body?.identityToken);
    const currentUser = await getUserFromAccess(req).catch(() => null);
    const fullName = String(req.body?.fullName || "").trim();
    const email = normalizeEmail(req.body?.email || profile.email);
    const user = await upsertAppleUser({
      fullName: fullName || email || "Foydalanuvchi",
      email,
      appleSub: profile.appleSub,
      currentUserId: currentUser?.id || null
    });
    await respondWithAuthUser(req, res, user);
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Apple orqali kirish amalga oshmadi" });
  }
}

async function handlePasswordResetRequest(req, res) {
  res.status(410).json({
    error:
      "Parolni tiklash uchun Telegram orqali adminga murojaat qiling. Vaqtinchalik parolni faqat admin yaratadi."
  });
}

async function handlePasswordChange(req, res) {
  try {
    const user = await getUserFromAccess(req);
    if (!user) return res.status(401).json({ error: "Kirish talab qilinadi" });

    const currentPassword = String(req.body?.currentPassword || "").trim();
    const nextPassword = String(req.body?.newPassword || "").trim();
    if (nextPassword.length < 6) return res.status(400).json({ error: "Kamida 6 ta belgidan iborat yangi parol kiriting" });

    const row = await dbApi.get("SELECT * FROM users WHERE id = ?", [String(user.id)]);
    if (!row?.password_hash) return res.status(400).json({ error: "Parol topilmadi" });

    if (!row.password_reset_required && !row.must_change_password) {
      if (!currentPassword) return res.status(400).json({ error: "Eski parolni kiriting" });
      const ok = await bcrypt.compare(currentPassword, String(row.password_hash));
      if (!ok) return res.status(401).json({ error: "Eski parol noto‘g‘ri" });
    }

    const passwordHash = await bcrypt.hash(nextPassword, 10);
    await dbApi.run(
      "UPDATE users SET password_hash = ?, password_reset_required = FALSE, must_change_password = FALSE WHERE id = ?",
      [passwordHash, String(user.id)]
    );

    res.json({ ok: true, message: "Parol muvaffaqiyatli almashtirildi" });
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Parol almashtirilmadi" });
  }
}

async function handleAdminResetPassword(req, res) {
  try {
    const admin = await getAdminFromAccess(req);
    if (!admin) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });

    const targetUserId = String(req.params.userId || req.params.id || "").trim();
    if (!targetUserId) return res.status(400).json({ error: "Foydalanuvchi topilmadi" });

    const target = await dbApi.get("SELECT id, full_name, phone, is_admin FROM users WHERE CAST(id AS TEXT) = ? LIMIT 1", [
      targetUserId
    ]);
    if (!target) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });

    const temporaryPassword = generateAdminTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await dbApi.run("UPDATE users SET password_hash = ?, password_reset_required = TRUE, must_change_password = TRUE WHERE id = ?", [
      passwordHash,
      String(target.id)
    ]);

    const telegramMessage = `Salom. Topshirdi accountingiz uchun vaqtinchalik parol: ${temporaryPassword}. Iltimos, shu parol bilan kiring va darhol yangi parol qo‘ying.`;
    res.json({
      ok: true,
      temporaryPassword,
      mustChangePassword: true,
      must_change_password: true,
      password_reset_required: true,
      telegramMessage
    });
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Parol reset qilinmadi" });
  }
}

async function handleDeleteAccount(req, res) {
  try {
    const user = await getUserFromAccess(req);
    if (!user) return res.status(401).json({ error: "Kirish talab qilinadi" });

    const client = await dbApi.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM users WHERE id = $1", [String(user.id)]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.setHeader("Set-Cookie", [clearRefreshCookie(req)]);
    res.json({
      ok: true,
      message: "Account butunlay o‘chirildi"
    });
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Account o‘chirilmadi" });
  }
}

app.post("/api/auth/register", handleRegister);
app.post("/api/register", handleRegister);

app.post("/api/auth/login", handleLogin);
app.post("/api/login", handleLogin);

app.post("/api/auth/google", handleGoogleLogin);
app.post("/api/login/google", handleGoogleLogin);
app.post("/api/auth/apple", handleAppleLogin);
app.post("/api/login/apple", handleAppleLogin);

app.post("/api/auth/password-reset/request", handlePasswordResetRequest);
app.post("/api/password-reset/request", handlePasswordResetRequest);
app.post("/api/auth/password-change", handlePasswordChange);
app.post("/api/password-change", handlePasswordChange);
app.post("/auth/change-password", handlePasswordChange);

app.delete("/api/auth/account", handleDeleteAccount);
app.delete("/api/account", handleDeleteAccount);

app.post("/api/auth/logout", async (req, res) => {
  const token = await readRefreshCookie(req);
  if (token) {
    await revokeRefreshToken(token).catch(() => {});
  }
  res.setHeader("Set-Cookie", [clearRefreshCookie(req)]);
  res.json({ ok: true });
});

app.post("/api/logout", async (req, res) => {
  const token = await readRefreshCookie(req);
  if (token) {
    await revokeRefreshToken(token).catch(() => {});
  }
  res.setHeader("Set-Cookie", [clearRefreshCookie(req)]);
  res.json({ ok: true });
});

app.post("/api/auth/refresh", async (req, res) => {
  const token = await readRefreshCookie(req);
  if (!token) return res.status(401).json({ error: "Yangilash tokeni topilmadi" });
  try {
    const { accessToken } = await rotateRefreshToken(token, req, res);
    res.json({ ok: true, accessToken });
  } catch (e) {
    res.setHeader("Set-Cookie", [clearRefreshCookie(req)]);
    res.status(401).json({ error: e?.message || "Token yangilash amalga oshmadi" });
  }
});

app.post("/api/auth", requireUser, async (req, res) => {
  const u = req.user;
  res.json({ user: publicAuthUser(u), isPro: isUserPro(u) });
});

app.get("/api/auth/me", requireUser, async (req, res) => {
  const u = req.user;
  res.json({ user: publicAuthUser(u), isPro: isUserPro(u) });
});

app.get("/api/me", requireUser, async (req, res) => {
  const u = req.user;
  res.json({ user: publicAuthUser(u), isPro: isUserPro(u) });
});

app.get("/api/topics", async (req, res) => {
  const user = await getUserFromAccess(req);
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  const topics = await getTopicsFromDb();
  let completedMap = new Map();
  if (user) {
    const rows = await dbApi.all("SELECT ticket_id, completed FROM test_progress WHERE user_id = ?", [String(user.id)]);
    completedMap = new Map(rows.map((row) => [String(row.ticket_id), row.completed === true]));
  }
  res.json({
    topics: topics.map((topic) => ({
      id: topic.id,
      title: lang ? String(topic.titleI18n?.[lang] || topic.title || "") : topic.title,
      completed: completedMap.get(String(topic.id)) || false
    }))
  });
});

app.get("/api/topics/:topicId", async (req, res) => {
  const topic = await getTopicFromDb(String(req.params.topicId));
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({ topic: lang ? localizeTopic(topic, lang) : topic });
});

// --- Ochiq (login talab qilmaydigan) bepul kontent — SEO uchun ---
// Bepullik TARTIB bo'yicha aniqlanadi: dastlabki 1 mavzu va 2 bilet bepul.
// Adminda tartib almashtirilsa ham, har doim 1- (mavzu) va 1-2- (bilet)
// o'rindagi element ochiq turadi.
const FREE_TOPIC_COUNT = 1;
const FREE_TICKET_COUNT = 2;

app.get("/api/public/topics", async (req, res) => {
  const topics = await getTopicsFromDb();
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({
    topics: topics.map((topic, index) => ({
      id: topic.id,
      slug: topic.slug,
      title: lang ? String(topic.titleI18n?.[lang] || topic.title || "") : topic.title,
      free: index < FREE_TOPIC_COUNT,
      questionCount: Array.isArray(topic.questions) ? topic.questions.length : 0
    }))
  });
});

app.get("/api/public/topics/:topicId", async (req, res) => {
  const topics = await getTopicsFromDb();
  const key = String(req.params.topicId || "").trim();
  const index = topics.findIndex((topic) => String(topic.id) === key || String(topic.slug) === key);
  if (index === -1) return res.status(404).json({ error: "Mavzu topilmadi" });
  if (index >= FREE_TOPIC_COUNT) {
    return res.status(403).json({ error: "Bu mavzu faqat ro'yxatdan o'tgan foydalanuvchilar uchun" });
  }
  const topic = topics[index];
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({
    topic: lang ? localizeTopic(topic, lang) : {
      id: topic.id,
      slug: topic.slug,
      title: topic.title,
      titleI18n: topic.titleI18n,
      questions: normalizeQuestions(topic.questions)
    }
  });
});

app.get("/api/public/tickets", async (req, res) => {
  const tickets = await getTicketsFromDb();
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({
    tickets: tickets.map((ticket, index) => ({
      id: ticket.id,
      title: lang ? String(ticket.titleI18n?.[lang] || ticket.title || "") : ticket.title,
      free: index < FREE_TICKET_COUNT,
      questionCount: Array.isArray(ticket.questions) ? ticket.questions.length : 0
    }))
  });
});

app.get("/api/public/tickets/:ticketId", async (req, res) => {
  const key = String(req.params.ticketId || "").trim();
  const ticket = await getTicketByIdFromDb(key);
  if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
  if (Number(ticket.ticketNumber || 0) > FREE_TICKET_COUNT) {
    return res.status(403).json({ error: "Bu bilet faqat ro'yxatdan o'tgan foydalanuvchilar uchun" });
  }
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({
    ticket: lang
      ? localizeTicket(ticket, lang)
      : {
          id: ticket.id,
          title: ticket.title,
          titleI18n: ticket.titleI18n,
          questions: ticket.questions
        }
  });
});

function maybeRawUpload(req, res, next) {
  const contentType = String(req.headers["content-type"] || "").toLowerCase();
  if (contentType.startsWith("application/json")) return next();
  return express.raw({ type: () => true, limit: "1024mb" })(req, res, next);
}

function serializeVideoLesson(video, user = null, adminView = false) {
  const canPlay = adminView || !video.premiumOnly || isUserPro(user) || Boolean(user?.is_admin);
  return {
    id: video.id,
    topicId: video.topicId,
    topicSlug: video.topicSlug,
    topicTitle: video.topicTitle,
    title: video.title || video.topicTitle,
    description: video.description,
    category: video.category,
    premiumOnly: video.premiumOnly,
    bunnyVideoId: video.bunnyVideoId,
    bunnyLibraryId: video.bunnyLibraryId,
    videoStatus: video.videoStatus,
    videoDuration: video.videoDuration,
    videoThumbnail: video.videoThumbnail,
    thumbnailUrl: video.videoThumbnail,
    playbackUrl: canPlay ? video.playbackUrl : "",
    createdAt: video.createdAt,
    updatedAt: video.updatedAt
  };
}

async function handleListVideoLessons(req, res, user, adminView = false) {
  const videos = await getVideoLessonsFromDb();
  res.json({
    videos: videos.map((video) => serializeVideoLesson(video, user, adminView))
  });
}

async function readVideoLessonPayload(req) {
  const body = Buffer.isBuffer(req.body) ? null : (req.body && typeof req.body === "object" ? req.body : {});
  const headers = req.headers || {};
  return {
    topicId: body?.topicId ?? body?.topic_id ?? headers["x-topic-id"],
    title: body?.title ?? headers["x-video-title"] ?? headers["x-title"],
    description: body?.description ?? headers["x-video-description"] ?? "",
    category: body?.category ?? headers["x-video-category"] ?? "",
    premiumOnly: body?.premiumOnly ?? body?.premium_only ?? headers["x-premium-only"],
    fileName: String(headers["x-file-name"] || headers["x-video-file-name"] || "video.mp4"),
    contentType: String(headers["content-type"] || "application/octet-stream")
  };
}

app.get("/api/video-lessons", requireUser, async (req, res) => {
  await handleListVideoLessons(req, res, req.user, false);
});

app.get("/api/videos", requireUser, async (req, res) => {
  await handleListVideoLessons(req, res, req.user, false);
});

app.get("/api/video-lessons/:lessonId", requireUser, async (req, res) => {
  const video = await getVideoLessonByIdFromDb(String(req.params.lessonId));
  if (!video) return res.status(404).json({ error: "Video topilmadi" });
  res.json({ video: serializeVideoLesson(video, req.user, false) });
});

app.get("/api/video-lessons/:lessonId/playback", requireUser, async (req, res) => {
  const video = await getVideoLessonByIdFromDb(String(req.params.lessonId));
  if (!video) return res.status(404).json({ error: "Video topilmadi" });
  const allowed = !video.premiumOnly || isUserPro(req.user) || Boolean(req.user?.is_admin);
  if (!allowed) return res.status(403).json({ error: "Premium video" });
  if (!video.playbackUrl) return res.status(404).json({ error: "Playback URL topilmadi" });
  res.json({
    playbackUrl: video.playbackUrl,
    video: serializeVideoLesson(video, req.user, false)
  });
});

app.get("/api/videos/:lessonId/playback", requireUser, async (req, res) => {
  const video = await getVideoLessonByIdFromDb(String(req.params.lessonId));
  if (!video) return res.status(404).json({ error: "Video topilmadi" });
  const allowed = !video.premiumOnly || isUserPro(req.user) || Boolean(req.user?.is_admin);
  if (!allowed) return res.status(403).json({ error: "Premium video" });
  if (!video.playbackUrl) return res.status(404).json({ error: "Playback URL topilmadi" });
  res.json({
    playbackUrl: video.playbackUrl,
    video: serializeVideoLesson(video, req.user, false)
  });
});

app.get("/api/custom-tests", async (_req, res) => {
  const customTests = await getGeneratedCustomTestsFromDb();
  res.json({
    customTests: customTests.map((test) => ({
      id: test.id,
      title: test.title,
      questionsCount: test.questionsCount
    }))
  });
});

app.get("/api/custom-tests/:testId", async (req, res) => {
  const customTest = await getGeneratedCustomTestByIdFromDb(String(req.params.testId));
  if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
  res.json({ customTest });
});

app.get("/api/custom-test-progress/:testId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const testId = String(req.params.testId);

  const row = await dbApi.get("SELECT * FROM custom_test_progress WHERE user_id = ? AND custom_test_id = ?", [userId, testId]);
  if (!row) return res.json({ progress: null });

  res.json({
    progress: {
      testId: String(row.custom_test_id),
      answers: JSON.parse(row.answers || "{}"),
      completed: !!row.completed,
      score: row.score,
      updatedAt: row.updated_at
    }
  });
});

app.post("/api/custom-test-progress/:testId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const testId = String(req.params.testId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const customTest = await getGeneratedCustomTestByIdFromDb(testId);
  if (!customTest) return res.status(404).json({ error: "Test topilmadi" });

  let correct = 0;
  let answeredCount = 0;
  for (const q of customTest.questions || []) {
    const a = answers[q.id];
    if (a === undefined || a === null) continue;
    answeredCount += 1;
    if (Number(a) === q.correctIndex) correct += 1;
  }

  const completed = answeredCount === customTest.questions.length;
  const nowIso = new Date().toISOString();

  await dbApi.run(
    `
    INSERT INTO custom_test_progress (user_id, custom_test_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, custom_test_id) DO UPDATE SET
      answers = excluded.answers,
      completed = excluded.completed,
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
    [userId, testId, JSON.stringify(answers), completed, correct, nowIso]
  );

  await syncMistakesFromQuestions({
    userId,
    kind: "custom",
    id: testId,
    title: customTest.title,
    questions: customTest.questions,
    answers
  });

  res.json({ ok: true, completed, score: correct, total: customTest.questions.length });
});

app.post("/api/custom-test-progress/:testId/reset", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const testId = String(req.params.testId);

  await dbApi.run(
    `
    INSERT INTO custom_test_progress (user_id, custom_test_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, FALSE, 0, NOW())
    ON CONFLICT(user_id, custom_test_id) DO UPDATE SET
      answers = excluded.answers,
      completed = FALSE,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [userId, testId, JSON.stringify({})]
  );

  res.json({ ok: true });
});

app.get("/api/answers", requireUser, async (req, res) => {
  const bank = await getTicketQuestionBankFromDb();
  const questions = bank.map((item) =>
    buildAnswerQuestion({
      kind: "ticket",
      id: item.ticketId,
      title: item.ticketTitle,
      question: item.question,
      questionIndex: item.questionIndex
    })
  );

  const hasPagingParams =
    req.query.limit !== undefined ||
    req.query.offset !== undefined ||
    req.query.q !== undefined ||
    req.query.filter !== undefined;

  if (!hasPagingParams) {
    return res.json({ questions });
  }

  const limitValue = Number.parseInt(String(req.query.limit ?? "40"), 10);
  const offsetValue = Number.parseInt(String(req.query.offset ?? "0"), 10);
  const filterValue = String(req.query.filter ?? "all").trim();
  const searchValue = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 40;
  const offset = Number.isFinite(offsetValue) ? Math.max(0, offsetValue) : 0;

  let filtered = questions;
  if (filterValue === "with-image") filtered = filtered.filter((question) => question.hasImage);
  if (filterValue === "without-image") filtered = filtered.filter((question) => !question.hasImage);
  if (searchValue) {
    filtered = filtered.filter((question) => {
      const text = String(question.text || "").toLowerCase();
      const source = String(question.sourceTitle || "").toLowerCase();
      const answer = String(question.correctAnswer || "").toLowerCase();
      const explanation = String(question.explanation || "").toLowerCase();
      return text.includes(searchValue) || source.includes(searchValue) || answer.includes(searchValue) || explanation.includes(searchValue);
    });
  }

  const total = filtered.length;
  const items = filtered.slice(offset, offset + limit);
  res.json({
    questions: items,
    total,
    offset,
    limit,
    hasMore: offset + items.length < total
  });
});

app.get("/api/mistakes", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const rows = await dbApi.all(
    `
    SELECT question_key, source_kind, source_id, source_title, question_index, question, wrong_answer, created_at, updated_at
    FROM user_mistakes
    WHERE user_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `,
    [userId]
  );

  const questions = rows.map((row) => ({
    ...(row.question || {}),
    id: String(row.question_key || row.question?.id || ""),
    kind: String(row.source_kind || row.question?.kind || ""),
    sourceId: String(row.source_id || row.question?.sourceId || ""),
    sourceTitle: String(row.source_title || row.question?.sourceTitle || ""),
    questionIndex: Number(row.question_index || row.question?.questionIndex || 0),
    wrongAnswer: Number.isFinite(Number(row.wrong_answer)) ? Number(row.wrong_answer) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  res.json({ questions });
});

app.post("/api/mistakes/progress", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const rows = await dbApi.all(
    `
    SELECT question_key, source_kind, source_id, source_title, question_index, question, wrong_answer
    FROM user_mistakes
    WHERE user_id = ?
  `,
    [userId]
  );

  let fixed = 0;
  for (const row of rows) {
    const question = row.question || {};
    const nextAnswer = answers[row.question_key];
    if (nextAnswer === undefined || nextAnswer === null) continue;

    if (Number(nextAnswer) === Number(question.correctIndex)) {
      await deleteUserMistake(userId, row.question_key);
      fixed += 1;
    } else {
      await dbApi.run(
        `
        UPDATE user_mistakes
        SET wrong_answer = ?, updated_at = NOW()
        WHERE user_id = ? AND question_key = ?
      `,
        [Number(nextAnswer), userId, row.question_key]
      );
    }
  }

  const remaining = await dbApi.get("SELECT COUNT(*)::int AS count FROM user_mistakes WHERE user_id = ?", [userId]);
  res.json({ ok: true, fixed, remaining: Number(remaining?.count || 0) });
});

app.get("/api/topic-progress/:topicId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const topicId = String(req.params.topicId);

  const row = await dbApi.get("SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = ?", [userId, topicId]);
  if (!row) return res.json({ progress: null });

  res.json({
    progress: {
      topicId: row.ticket_id,
      answers: JSON.parse(row.answers || "{}"),
      completed: !!row.completed,
      score: row.score,
      updatedAt: row.updated_at
    }
  });
});

app.post("/api/topic-progress/:topicId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const topicId = String(req.params.topicId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const topic = await getTopicFromDb(topicId);
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });

  let correct = 0;
  let answeredCount = 0;
  for (const q of topic.questions || []) {
    const a = answers[q.id];
    if (a === undefined || a === null) continue;
    answeredCount += 1;
    if (Number(a) === q.correctIndex) correct += 1;
  }

  const completed = answeredCount === topic.questions.length;
  const nowIso = new Date().toISOString();

  await dbApi.run(
    `
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = excluded.completed,
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
    [userId, topicId, JSON.stringify(answers), completed, correct, nowIso]
  );

  await syncMistakesFromQuestions({
    userId,
    kind: "topic",
    id: topicId,
    title: topic.title,
    questions: topic.questions,
    answers
  });

  res.json({ ok: true, completed, score: correct, total: topic.questions.length });
});

app.post("/api/topic-progress/:topicId/complete", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const topicId = String(req.params.topicId);
  const completed = Boolean(req.body?.completed);

  const topic = await getTopicFromDb(topicId);
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });

  const existing = await dbApi.get("SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = ?", [userId, topicId]);
  const answers = parseJsonValue(existing?.answers, {});
  const score = Number(existing?.score || 0);
  const nowIso = new Date().toISOString();

  await dbApi.run(
    `
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = excluded.completed,
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
    [userId, topicId, JSON.stringify(answers), completed, score, nowIso]
  );

  res.json({ ok: true, completed });
});

app.post("/api/topic-progress/:topicId/reset", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const topicId = String(req.params.topicId);

  await dbApi.run(
    `
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, FALSE, 0, NOW())
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = FALSE,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [userId, topicId, JSON.stringify({})]
  );

  res.json({ ok: true });
});

app.post("/api/browser-token", requireUser, async (req, res) => {
  const token = signAccessToken(req.user.id, Boolean(req.user.is_admin === true || String(req.user.id) === "1"));
  res.json({ ok: true, token });
});

app.get("/api/tickets", requireUser, async (req, res) => {
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  const tickets = await getTicketsFromDb();
  const progressRows = await dbApi.all("SELECT ticket_id, answers, completed, score, updated_at FROM test_progress WHERE user_id = ?", [
    String(req.user.id)
  ]);
  const progressByTicketId = new Map(progressRows.map((row) => [String(row.ticket_id || ""), row]));
  res.json({
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      title: lang ? String(ticket.titleI18n?.[lang] || ticket.title || "") : ticket.title,
      status: ticket.status,
      locked: false,
      questionsCount: Array.isArray(ticket.questions) ? ticket.questions.length : 0,
      progress: (() => {
        const row = progressByTicketId.get(String(ticket.id));
        if (!row) return null;
        let answers = {};
        try {
          answers = JSON.parse(row.answers || "{}");
        } catch {
          answers = {};
        }
        return {
          ticketId: String(ticket.id),
          completed: Boolean(row.completed),
          score: Number(row.score || 0),
          updatedAt: row.updated_at ? String(row.updated_at) : null,
          ...calculateTicketProgressStats(ticket, answers)
        };
      })()
    })),
    isPro: true
  });
});

app.get("/api/tickets/:ticketId", requireUser, async (req, res) => {
  const ticket = await getTicketByIdFromDb(String(req.params.ticketId));
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  const lang = normalizeLanguageCode(req.query.lang || req.headers["x-lang"] || "", "");
  res.json({ ticket: lang ? localizeTicket(ticket, lang) : ticket, isPro: true });
});

app.get("/api/progress/:ticketId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const ticketId = String(req.params.ticketId);
  const ticket = await getProgressTicketById(ticketId);
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  const row = await dbApi.get(
    "SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = ?",
    [userId, ticketId]
  );
  if (!row) return res.json({ progress: null });

  let answers = {};
  try {
    answers = JSON.parse(row.answers || "{}");
  } catch {
    answers = {};
  }

  res.json({
    progress: {
      ticketId: row.ticket_id,
      answers,
      completed: !!row.completed,
      score: row.score,
      updatedAt: row.updated_at,
      ...calculateTicketProgressStats(ticket, answers)
    }
  });
});

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

async function buildExamSelection(count = 50) {
  const pool = await getExamQuestionPool();
  const desiredCount = normalizeExamCount(count);
  if (pool.length === 0) {
    const error = new Error("Imtihon uchun savol topilmadi");
    error.statusCode = 400;
    throw error;
  }

  const shuffled = [...pool];
  shuffleInPlace(shuffled);
  return shuffled.slice(0, Math.min(desiredCount, shuffled.length)).map((item) => ({
    questionKey: item.questionKey,
    kind: item.kind,
    sourceId: item.sourceId,
    sourceTitle: item.sourceTitle,
    questionIndex: item.questionIndex,
    question: normalizeAnswerQuestion(item.question)
  }));
}

function serializeExamSessionRow(row) {
  const selection = parseJsonValue(row.selection, []);
  const answers = parseJsonValue(row.answers, {});
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    examCount: Number(row.exam_count || 50),
    durationSeconds: Number(row.duration_seconds || getExamDurationSeconds(row.exam_count || 50)),
    startedAt: String(row.started_at),
    completed: Boolean(row.completed),
    score: Number(row.score || 0),
    selection: Array.isArray(selection) ? selection : [],
    answers: answers && typeof answers === "object" ? answers : {},
    updatedAt: row.updated_at ? String(row.updated_at) : null
  };
}

app.post("/api/exam/start", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const examCount = normalizeExamCount(req.body?.count);
  const durationSeconds = getExamDurationSeconds(examCount);
  const selection = await buildExamSelection(examCount);
  const startedAt = new Date().toISOString();

  const result = await dbApi.get(
    `
    INSERT INTO exam_sessions (user_id, exam_count, duration_seconds, started_at, completed, score, selection, answers, updated_at)
    VALUES (?, ?, ?, ?, FALSE, 0, ?::jsonb, ?::jsonb, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      exam_count = EXCLUDED.exam_count,
      duration_seconds = EXCLUDED.duration_seconds,
      started_at = EXCLUDED.started_at,
      completed = FALSE,
      score = 0,
      selection = EXCLUDED.selection,
      answers = EXCLUDED.answers,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `,
    [userId, examCount, durationSeconds, startedAt, JSON.stringify(selection), JSON.stringify({})]
  );

  const inserted = result || (await dbApi.get("SELECT * FROM exam_sessions WHERE user_id = ?", [userId]));
  const session = serializeExamSessionRow(inserted);
  const timing = getExamTiming(session);
  const questions = session.selection.map((item) => ({
    id: String(item.questionKey || item.id || ""),
    kind: String(item.kind || ""),
    sourceId: String(item.sourceId || ""),
    sourceTitle: String(item.sourceTitle || ""),
    questionIndex: Number(item.questionIndex || 0) + 1,
    ...normalizeAnswerQuestion(item.question)
  }));

  res.json({
    ok: true,
    exam: {
      questions,
      answers: session.answers,
      completed: !!session.completed,
      score: Number(session.score || 0),
      updatedAt: session.updatedAt,
      examCount: Number(session.examCount || examCount),
      durationSeconds: timing.durationSeconds,
      startedAt: timing.startedAt,
      expiresAt: timing.expiresAt,
      remainingSeconds: timing.remainingSeconds,
      expired: timing.expired
    }
  });
});

app.get("/api/exam", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const row = await dbApi.get("SELECT * FROM exam_sessions WHERE user_id = ?", [userId]);
  if (!row) return res.json({ exam: null });

  const session = serializeExamSessionRow(row);
  const timing = getExamTiming(session);
  let activeSession = session;

  if (timing.expired && !session.completed) {
    const finalized = await finalizeExamSession(userId, row);
    if (finalized?.session) {
      activeSession = serializeExamSessionRow(finalized.session);
    }
  }

  const questions = activeSession.selection.map((item) => ({
    id: String(item.questionKey || item.id || ""),
    kind: String(item.kind || ""),
    sourceId: String(item.sourceId || ""),
    sourceTitle: String(item.sourceTitle || ""),
    questionIndex: Number(item.questionIndex || 0) + 1,
    ...normalizeAnswerQuestion(item.question)
  }));

  const freshTiming = getExamTiming(activeSession);

  res.json({
    exam: {
      questions,
      answers: activeSession.answers,
      completed: !!activeSession.completed,
      score: Number(activeSession.score || 0),
      updatedAt: activeSession.updatedAt,
      examCount: Number(activeSession.examCount || 50),
      durationSeconds: freshTiming.durationSeconds,
      startedAt: freshTiming.startedAt,
      expiresAt: freshTiming.expiresAt,
      remainingSeconds: freshTiming.remainingSeconds,
      expired: freshTiming.expired
    }
  });
});

app.post("/api/exam/progress", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const newAnswers = req.body?.answers;
  const finalize = Boolean(req.body?.finalize);
  if (!newAnswers || typeof newAnswers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const row = await dbApi.get("SELECT * FROM exam_sessions WHERE user_id = ?", [userId]);
  if (!row) return res.status(404).json({ error: "Imtihon hali boshlanmagan" });

  const session = serializeExamSessionRow(row);
  const timing = getExamTiming(session);
  const selection = session.selection || [];
  const scored = calculateExamScore(selection, newAnswers);

  const completed = finalize || timing.expired;

  await dbApi.run(
    `
    UPDATE exam_sessions
    SET answers = ?::jsonb,
        completed = ?,
        score = ?,
        updated_at = NOW()
    WHERE user_id = ?
  `,
    [JSON.stringify(newAnswers), completed, scored.correct, userId]
  );

  await syncMistakesFromExam({
    userId,
    selection,
    answers: newAnswers,
    pool: selection
  });

  const remainingSeconds = timing.expired ? 0 : timing.remainingSeconds;
  res.json({ ok: true, completed, score: scored.correct, total: selection.length, remainingSeconds, expired: timing.expired });
});

app.post("/api/exam/reset", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  await dbApi.run("DELETE FROM exam_sessions WHERE user_id = ?", [userId]);
  res.json({ ok: true });
});

app.post("/api/progress/:ticketId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const ticketId = String(req.params.ticketId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const ticket = await getProgressTicketById(ticketId);
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
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = excluded.completed,
      score = excluded.score,
      updated_at = excluded.updated_at
  `,
    [userId, ticketId, JSON.stringify(answers), completed, correct, nowIso]
  );

  await syncMistakesFromQuestions({
    userId,
    kind: "ticket",
    id: ticketId,
    title: ticket.title,
    questions: ticket.questions,
    answers
  });

  const stats = calculateTicketProgressStats(ticket, answers);
  res.json({ ok: true, completed, score: correct, total: ticket.questions.length, ...stats });
});

app.post("/api/progress/:ticketId/reset", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const ticketId = String(req.params.ticketId);

  await dbApi.run(
    `
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, ?, ?, FALSE, 0, NOW())
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = FALSE,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [userId, ticketId, JSON.stringify({})]
  );

  res.json({ ok: true });
});

app.delete("/api/mistakes/:questionKey", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const questionKey = String(req.params.questionKey || "").trim();
  if (!questionKey) return res.status(400).json({ error: "Savol kaliti kerak" });
  await deleteUserMistake(userId, questionKey);
  res.json({ ok: true });
});

app.post("/api/promo/activate", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const code = String(req.body?.code || "").trim();
  if (!code) return res.status(400).json({ error: "Promo kod kiritilishi kerak" });
  if (!/^\d{5}$/.test(code)) return res.status(400).json({ error: "Promo kod 5 xonali bo‘lishi kerak" });

  const row = await dbApi.get("SELECT * FROM promo_codes WHERE code = ?", [code]);
  if (!row) return res.status(404).json({ error: "Promo code not found" });
  if (String(row.user_id) !== userId) return res.status(403).json({ error: "Bu promo kod sizga tegishli emas" });
  if (row.activated) return res.status(400).json({ error: "Bu promo kod allaqachon ishlatilgan" });

  const currentProUntil = req.user.pro_until ? new Date(req.user.pro_until) : null;
  const base = currentProUntil && currentProUntil.getTime() > Date.now() ? currentProUntil : new Date();
  const newProUntil = addDays(base, 30);

  await dbApi.run("UPDATE users SET pro_until = ? WHERE id = ?", [newProUntil.toISOString(), userId]);
  await dbApi.run(
    "UPDATE promo_codes SET activated = TRUE, expires_at = ? WHERE id = ?",
    [newProUntil.toISOString(), row.id]
  );

  const updatedUser = await dbApi.get("SELECT * FROM users WHERE id = ?", [userId]);
  res.json({ ok: true, user: updatedUser, isPro: isUserPro(updatedUser), proUntil: updatedUser.pro_until });
});

app.get("/api/admin/tickets", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const tickets = await getTicketsFromDb();
  res.json({ tickets });
});

app.post("/api/admin/tickets", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const ticket = await createTicket({
      id: req.body?.id ? String(req.body.id) : undefined,
      title: String(req.body?.title || ""),
      questions: Array.isArray(req.body?.questions) ? req.body.questions : []
    });
    res.status(201).json({ ok: true, ticket });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/tickets/:ticketId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const ticket = await getTicketFromDb(String(req.params.ticketId));
  if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
  res.json({ ticket });
});

app.patch("/api/admin/tickets/:ticketId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    console.log("[admin/tickets PATCH] incoming", {
      ticketId: String(req.params.ticketId || ""),
      hasTitleI18n: Boolean(req.body?.titleI18n || req.body?.title_i18n),
      titleI18nKeys: Object.keys(parseJsonValue(req.body?.titleI18n || req.body?.title_i18n || {}, {})),
      questionCount: Array.isArray(req.body?.questions) ? req.body.questions.length : null,
      firstQuestionKeys: Array.isArray(req.body?.questions) && req.body.questions[0] ? Object.keys(req.body.questions[0]) : []
    });
    const ticket = await updateTicket(String(req.params.ticketId), {
      title: req.body?.title !== undefined ? String(req.body.title || "") : undefined,
      titleI18n: req.body?.titleI18n ?? req.body?.title_i18n,
      questions: Array.isArray(req.body?.questions) ? req.body.questions : undefined,
      status: req.body?.status,
      ticketNumber: req.body?.ticketNumber
    });
    console.log("[admin/tickets PATCH] saved", {
      ticketId: String(req.params.ticketId || ""),
      titleI18nKeys: Object.keys(parseJsonValue(ticket.titleI18n || {}, {})),
      firstQuestionI18nKeys: Array.isArray(ticket.questions) && ticket.questions[0] ? Object.keys(parseJsonValue(ticket.questions[0].i18n || {}, {})) : []
    });
    res.json({ ok: true, ticket });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.delete("/api/admin/tickets/:ticketId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await deleteTicket(String(req.params.ticketId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/ticket-builder/draft", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const created = await getOrCreateDraftTicket();
    // Bilet o'chirilgan bo'lsa, draft raqami bo'shagan eng kichik raqamga tushadi
    const draftId = await ensureDraftTicketNumber(created.id);
    const draft = await getDraftTicketBuilderFromDb(draftId);
    res.json({ ticket: draft });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/ticket-builder/questions", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await syncTopicQuestionBankFromTopics();
    const search = String(req.query.search || "").trim().toLowerCase();
    const searchLike = search ? `%${search}%` : "";

    const conditions = ["NOT EXISTS (SELECT 1 FROM ticket_questions tq WHERE tq.question_id = bank.question_key)"];
    const params = [];
    if (search) {
      conditions.push(
        `(LOWER(COALESCE(bank.question->>'text', '')) LIKE ? OR LOWER(COALESCE(bank.topic_title, '')) LIKE ? OR LOWER(COALESCE(bank.question->>'explanation', '')) LIKE ?)`
      );
      params.push(searchLike, searchLike, searchLike);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const totalRow = await dbApi.get(
      `
        SELECT COUNT(*) AS total
        FROM topic_question_bank bank
        ${whereClause}
      `,
      params
    );

    const rows = await dbApi.all(
      `
        SELECT
          bank.question_key,
          bank.topic_id,
          bank.topic_slug,
          bank.topic_title,
          bank.question_id,
          bank.question_index,
          bank.question,
          bank.sort_order
        FROM topic_question_bank bank
        ${whereClause}
        ORDER BY bank.sort_order ASC, bank.question_key ASC
      `,
      params
    );

    const questions = rows.map((row) => ({
      id: String(row.question_key || ""),
      questionId: String(row.question_key || ""),
      topicId: Number(row.topic_id || 0),
      topicSlug: String(row.topic_slug || ""),
      topicTitle: String(row.topic_title || ""),
      questionIndex: Number(row.question_index || 0),
      question: parseJsonValue(row.question, {}),
      text: String(parseJsonValue(row.question, {})?.text || ""),
      image: String(parseJsonValue(row.question, {})?.image || ""),
      audio: String(parseJsonValue(row.question, {})?.audio || ""),
      options: Array.isArray(parseJsonValue(row.question, {})?.options) ? parseJsonValue(row.question, {}).options.map((option) => String(option || "")) : [],
      correctIndex: Number.isFinite(Number(parseJsonValue(row.question, {})?.correctIndex)) ? Number(parseJsonValue(row.question, {})?.correctIndex) : 0,
      explanation: String(parseJsonValue(row.question, {})?.explanation || "")
    }));

    res.json({
      questions,
      total: Number(totalRow?.total || 0),
      page: 1,
      limit: questions.length,
      hasMore: false
    });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/ticket-builder/add-question", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const questionId = String(req.body?.questionId || "").trim();
  const ticketId = String(req.body?.ticketId || "").trim();
  const desiredOrderValue = Number.parseInt(String(req.body?.order ?? ""), 10);
  if (!questionId) return res.status(400).json({ error: "questionId kerak" });
  try {
    const draftTicket = await getTicketBuilderTarget(ticketId);
    const draft = await getTicketBuilderFromDb(draftTicket.id);
    const alreadyAssigned = await dbApi.get("SELECT id FROM ticket_questions WHERE question_id = ?", [questionId]);
    if (alreadyAssigned) return res.status(400).json({ error: "Savol allaqachon biletga biriktirilgan" });
    const bankQuestion = await dbApi.get(
      `
        SELECT question_key, topic_id, topic_slug, topic_title, question_id, question_index, question, sort_order
        FROM topic_question_bank
        WHERE question_key = ?
        LIMIT 1
      `,
      [questionId]
    );
    if (!bankQuestion) return res.status(404).json({ error: "Savol topilmadi" });
    const nextOrder = Number.isFinite(desiredOrderValue) && desiredOrderValue > 0 ? Math.max(1, Math.min(desiredOrderValue, 20)) : 1;
    const nextSlots = normalizeTicketSlotQuestions(draft.questions);
    if (nextSlots[nextOrder - 1]) return res.status(400).json({ error: "Bu slot band. Avval savolni remove qiling" });
    nextSlots[nextOrder - 1] = buildTicketBuilderQuestion({
      questionId,
      order: nextOrder,
      topicId: bankQuestion.topic_id,
      topicSlug: bankQuestion.topic_slug,
      topicTitle: bankQuestion.topic_title,
      questionIndex: bankQuestion.question_index,
      question: bankQuestion.question
    });
    const updated = await persistTicketSlotQuestions(draft.id, nextSlots);
    res.json({ ok: true, ticket: updated || draft });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/ticket-builder/remove-question", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const questionId = String(req.body?.questionId || "").trim();
  const ticketId = String(req.body?.ticketId || "").trim();
  if (!questionId) return res.status(400).json({ error: "questionId kerak" });
  try {
    const draftTicket = await getTicketBuilderTarget(ticketId);
    const draft = await getTicketBuilderFromDb(draftTicket.id);
    const nextSlots = normalizeTicketSlotQuestions(draft.questions);
    const existingIndex = nextSlots.findIndex((slot) => slot && String(slot.questionId || slot.id || "") === questionId);
    if (existingIndex < 0) return res.status(404).json({ error: "Savol draftda topilmadi" });
    nextSlots[existingIndex] = null;
    const updated = await persistTicketSlotQuestions(draft.id, nextSlots);
    res.json({ ok: true, ticket: updated || draft });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/ticket-builder/reorder", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const questionId = String(req.body?.questionId || "").trim();
  const ticketId = String(req.body?.ticketId || "").trim();
  const fromOrder = Number.parseInt(String(req.body?.fromOrder ?? ""), 10);
  const toOrder = Number.parseInt(String(req.body?.toOrder ?? ""), 10);
  if (!questionId) return res.status(400).json({ error: "questionId kerak" });
  if (!Number.isFinite(fromOrder) || !Number.isFinite(toOrder) || fromOrder < 1 || toOrder < 1 || fromOrder > 20 || toOrder > 20) {
    return res.status(400).json({ error: "fromOrder/toOrder noto‘g‘ri" });
  }
  try {
    const draftTicket = await getTicketBuilderTarget(ticketId);
    const draft = await getTicketBuilderFromDb(draftTicket.id);
    const nextSlots = normalizeTicketSlotQuestions(draft.questions);
    const sourceIndex = fromOrder - 1;
    const targetIndex = toOrder - 1;
    const source = nextSlots[sourceIndex];
    if (!source || String(source.questionId || source.id || "") !== questionId) return res.status(404).json({ error: "Savol topilmadi" });
    if (sourceIndex === targetIndex) return res.json({ ok: true, ticket: draft });
    const target = nextSlots[targetIndex];
    nextSlots[sourceIndex] = target || null;
    nextSlots[targetIndex] = { ...source, order: toOrder };
    if (nextSlots[sourceIndex]) nextSlots[sourceIndex] = { ...nextSlots[sourceIndex], order: fromOrder };
    const updated = await persistTicketSlotQuestions(draft.id, nextSlots);
    res.json({ ok: true, ticket: updated || draft });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/ticket-builder/complete", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const currentDraft = await getOrCreateDraftTicket();
    const currentSlots = normalizeTicketSlotQuestions(currentDraft.questions);
    const filledCount = currentSlots.filter(Boolean).length;
    if (!filledCount) return res.status(400).json({ error: "Kamida bitta savol kerak" });

    // Yakunlashdan oldin raqamni tekshiramiz: bilet o'chirilgan bo'lsa, bo'sh raqam olinadi
    const draftId = await ensureDraftTicketNumber(currentDraft.id);
    const draftRow = await dbApi.get("SELECT id, ticket_number FROM tickets WHERE id = ?", [draftId]);
    const ticketNumber = Number(draftRow?.ticket_number || 0) || (await getNextTicketNumber(draftId));
    const completedTitle = makeTicketTitle(ticketNumber);
    await dbApi.run(
      `UPDATE tickets SET title = ?, ticket_number = ?, status = 'COMPLETED', updated_at = NOW() WHERE id = ?`,
      [completedTitle, ticketNumber, draftId]
    );
    await persistTicketSlotQuestions(draftId, currentSlots);

    const nextNumber = await getNextTicketNumber();
    const nextId = String(nextNumber);
    const nextTitle = makeTicketTitle(nextNumber);
    await dbApi.run(
      `
        INSERT INTO tickets (id, title, ticket_number, status, questions, created_at, updated_at)
        VALUES (?, ?, ?, 'DRAFT', '[]'::jsonb, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `,
      [nextId, nextTitle, nextNumber]
    );

    const draft = await getDraftTicketBuilderFromDb(nextId) || await getDraftTicketBuilderFromDb();
    const completedTicket = await getTicketByIdFromDb(draftId);
    res.json({ ok: true, completedTicket, draft });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/topics", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const topics = await getTopicsFromDb();
  res.json({
    topics: topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      questionCount: Array.isArray(topic.questions) ? topic.questions.length : 0,
      adminMarked: topic.adminMarked === true
    }))
  });
});

app.delete("/api/admin/topics", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const result = await dbApi.run("DELETE FROM topics");
    res.json({ ok: true, deletedCount: Number(result?.rowCount || 0) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/topics/:topicId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const topic = await getTopicFromDb(String(req.params.topicId));
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
  res.json({ topic });
});

app.get("/api/admin/custom-tests", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const customTests = await getCustomTestsFromDb();
  res.json({ customTests: customTests.map((test) => ({ id: test.id, title: test.title })) });
});

app.delete("/api/admin/custom-tests", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const progressResult = await dbApi.run("DELETE FROM custom_test_progress");
    const result = await dbApi.run("DELETE FROM custom_tests");
    res.json({ ok: true, deletedCount: Number(result?.rowCount || progressResult?.rowCount || 0) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/custom-tests/:testId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const customTest = await getCustomTestFromDb(String(req.params.testId));
  if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
  res.json({ customTest });
});

app.post("/api/admin/custom-tests", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const customTest = await createCustomTest(req.body || {});
    res.status(201).json({ ok: true, customTest });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.patch("/api/admin/custom-tests/:testId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const customTest = await updateCustomTest(String(req.params.testId), req.body || {});
    res.json({ ok: true, customTest });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.delete("/api/admin/custom-tests/:testId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await deleteCustomTest(String(req.params.testId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/custom-tests/import", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const customTestItems = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.customTests) ? req.body.customTests : [];
    if (!customTestItems.length) return res.status(400).json({ error: "customTests massivi kerak" });
    const customTests = await importCustomTests(customTestItems);
    res.json({ ok: true, customTests: customTests.map((test) => ({ id: test.id, title: test.title })) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.get("/api/admin/video-lessons", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  await handleListVideoLessons(req, res, user, true);
});

app.get("/api/admin/videos", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  await handleListVideoLessons(req, res, user, true);
});

app.get("/api/admin/video-lessons/:lessonId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const video = await getVideoLessonByIdFromDb(String(req.params.lessonId));
  if (!video) return res.status(404).json({ error: "Video topilmadi" });
  res.json({ video: serializeVideoLesson(video, user, true) });
});

app.get("/api/admin/videos/:videoId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const video = await getVideoLessonByIdFromDb(String(req.params.videoId));
  if (!video) return res.status(404).json({ error: "Video topilmadi" });
  res.json({ video: serializeVideoLesson(video, user, true) });
});

app.post("/api/admin/video-lessons", maybeRawUpload, async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const payload = await readVideoLessonPayload(req);
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    const video = await createVideoLesson(payload, fileBuffer, payload.contentType);
    res.status(201).json({ ok: true, video: serializeVideoLesson(video, user, true) });
  } catch (e) {
    const message = e?.message || "Noto‘g‘ri so‘rov";
    console.error("[admin-video-upload]", message, e?.stack || "");
    const statusCode = /sozlanmagan|yuborilishi kerak|tanlanishi kerak|topilmadi/i.test(message) ? 400 : 500;
    res.status(statusCode).json({
      error: message,
      details: process.env.NODE_ENV === "production" ? undefined : e?.stack
    });
  }
});

app.post("/api/admin/videos", maybeRawUpload, async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const payload = await readVideoLessonPayload(req);
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    const video = await createVideoLesson(payload, fileBuffer, payload.contentType);
    res.status(201).json({ ok: true, video: serializeVideoLesson(video, user, true) });
  } catch (e) {
    const message = e?.message || "Noto‘g‘ri so‘rov";
    console.error("[admin-video-upload]", message, e?.stack || "");
    const statusCode = /sozlanmagan|yuborilishi kerak|tanlanishi kerak|topilmadi/i.test(message) ? 400 : 500;
    res.status(statusCode).json({
      error: message,
      details: process.env.NODE_ENV === "production" ? undefined : e?.stack
    });
  }
});

app.put("/api/video-lessons/:lessonId", maybeRawUpload, async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const payload = await readVideoLessonPayload(req);
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    const video = await updateVideoLesson(String(req.params.lessonId), payload, fileBuffer, payload.contentType);
    res.json({ ok: true, video: serializeVideoLesson(video, user, true) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.patch("/api/admin/videos/:videoId", maybeRawUpload, async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const payload = await readVideoLessonPayload(req);
    const fileBuffer = Buffer.isBuffer(req.body) ? req.body : null;
    const video = await updateVideoLesson(String(req.params.videoId), payload, fileBuffer, payload.contentType);
    res.json({ ok: true, video: serializeVideoLesson(video, user, true) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.delete("/api/video-lessons/:lessonId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await deleteVideoLesson(String(req.params.lessonId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.delete("/api/admin/videos/:videoId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await deleteVideoLesson(String(req.params.videoId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

function extractBunnyWebhookVideoId(payload) {
  const candidates = [
    payload?.videoId,
    payload?.videoID,
    payload?.guid,
    payload?.video?.videoId,
    payload?.video?.guid,
    payload?.data?.videoId,
    payload?.data?.guid,
    payload?.object?.videoId,
    payload?.object?.guid
  ];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) return value;
  }
  return "";
}

app.post("/api/webhooks/bunny-stream", async (req, res) => {
  try {
    const payload = req.body && typeof req.body === "object" ? req.body : {};
    const bunnyVideoId = extractBunnyWebhookVideoId(payload);
    if (!bunnyVideoId) return res.status(400).json({ error: "Video id topilmadi" });

    const video = await getVideoLessonByBunnyVideoIdFromDb(bunnyVideoId);
    if (!video) return res.status(404).json({ error: "Video topilmadi" });

    const event = String(payload.event || payload.eventType || payload.type || payload.status || "").toLowerCase();
    let bunnyInfo = normalizeBunnyInfo(payload, bunnyVideoId);

    if (event.includes("fail")) {
      bunnyInfo = { status: "failed", duration: bunnyInfo.duration, thumbnail: bunnyInfo.thumbnail };
    } else if (event.includes("upload")) {
      bunnyInfo = { status: "processing", duration: bunnyInfo.duration, thumbnail: bunnyInfo.thumbnail };
    } else if (!bunnyInfo.duration || !bunnyInfo.thumbnail) {
      try {
        bunnyInfo = normalizeBunnyInfo(await getBunnyVideoInfo(bunnyVideoId), bunnyVideoId);
      } catch {}
    }

    const updated = await syncBunnyVideoRow(video.id, bunnyInfo);
    res.json({ ok: true, video: updated });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Webhook qabul qilinmadi" });
  }
});

app.get("/api/admin/users", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const rows = await dbApi.all(
    `
      SELECT id, full_name, phone, pro_until, created_at, is_admin, password_reset_required, must_change_password
      FROM users
      ORDER BY is_admin DESC, created_at DESC, id DESC
    `
  );
  res.json({
    users: rows.map((row) => ({
      id: String(row.id),
      full_name: String(row.full_name || ""),
      phone: row.phone ? String(row.phone) : "",
      pro_until: row.pro_until ? String(row.pro_until) : null,
      created_at: row.created_at ? String(row.created_at) : null,
      is_admin: row.is_admin === true,
      password_reset_required: row.password_reset_required === true || row.must_change_password === true,
      must_change_password: row.password_reset_required === true || row.must_change_password === true
    }))
  });
});

app.post("/api/admin/users/:userId/reset-password", handleAdminResetPassword);
app.post("/admin/users/:userId/reset-password", handleAdminResetPassword);

app.delete("/api/admin/users/:userId", async (req, res) => {
  const admin = await getAdminFromAccess(req);
  if (!admin) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });

  const targetUserId = String(req.params.userId || "").trim();
  if (!targetUserId) return res.status(400).json({ error: "Foydalanuvchi topilmadi" });
  if (String(admin.id) === targetUserId) return res.status(400).json({ error: "O‘zingizni o‘chirib bo‘lmaydi" });

  const target = await dbApi.get("SELECT id, is_admin FROM users WHERE CAST(id AS TEXT) = ? LIMIT 1", [targetUserId]);
  if (!target) return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
  if (target.is_admin) return res.status(400).json({ error: "Admin akkauntni o‘chirish mumkin emas" });

  await dbApi.run("DELETE FROM users WHERE id = ?", [String(target.id)]);
  res.json({ ok: true });
});

app.post("/api/admin/topics", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const topic = await createTopic(req.body || {});
    res.status(201).json({ ok: true, topic });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.patch("/api/admin/topics/:topicId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const topic = await updateTopic(String(req.params.topicId), req.body || {});
    res.json({ ok: true, topic });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/topics/:topicId/mark", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const current = await getTopicFromDb(String(req.params.topicId));
    if (!current) return res.status(404).json({ error: "Mavzu topilmadi" });
    const topic = await updateTopic(String(req.params.topicId), {
      title: current.title,
      questions: current.questions,
      adminMarked: Boolean(req.body?.adminMarked)
    });
    res.json({ ok: true, topic });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.delete("/api/admin/topics/:topicId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    await deleteTopic(String(req.params.topicId));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/topics/:topicId/import-questions", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const payload = Array.isArray(req.body)
      ? { questions: req.body }
      : req.body && typeof req.body === "object"
        ? req.body
        : {};
    const questionItems = Array.isArray(payload.questions) ? payload.questions : [];
    if (!questionItems.length) return res.status(400).json({ error: "questions massivi kerak" });
    const topic = await importTopicQuestions(String(req.params.topicId), questionItems, Boolean(payload.replace));
    res.json({ ok: true, topic });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/admin/topics/import", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const topicItems = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.topics) ? req.body.topics : [];
    if (!topicItems.length) return res.status(400).json({ error: "topics massivi kerak" });
    const topics = await importTopics(topicItems);
    res.json({ ok: true, topics: topics.map((topic) => ({ id: topic.id, title: topic.title })) });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Noto‘g‘ri so‘rov" });
  }
});

app.post("/api/upload-image", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const body = req.body || {};
    const imageBase64 = String(body.imageBase64 || "");
    const imageName = String(body.imageName || "");
    const imageType = String(body.imageType || "");
    const oldImageUrl = String(body.oldImageUrl || "").trim();
    const ticketId = String(body.ticketId || "").trim();
    const topicId = String(body.topicId || "").trim();
    const customTestId = String(body.customTestId || "").trim();
    const questionId = String(body.questionId || "").trim();

    if (!imageBase64) return res.status(400).json({ error: "Rasm fayli topilmadi" });
    if (!ALLOWED_IMAGE_TYPES.has(imageType)) {
      return res.status(400).json({ error: "Faqat jpg, jpeg, png va webp formatlar qabul qilinadi" });
    }

    const buffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ""), "base64");
    if (buffer.length > MAX_IMAGE_SIZE) {
      return res.status(400).json({ error: "Rasm hajmi 5MB dan oshmasligi kerak" });
    }

    const extension = getExtensionFromFile({ name: imageName, type: imageType });
    if (!extension) return res.status(400).json({ error: "Rasm fayl kengaytmasi aniqlanmadi" });

    const bucket = getR2BucketName();
    if (!bucket) return res.status(500).json({ error: "R2 bucket sozlanmagan" });

    const fileKey = createFileKey(extension);
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: imageType
      })
    );

    const imageUrl = buildR2PublicUrl(fileKey);
    const oldKey = deriveR2KeyFromPublicUrl(oldImageUrl);
    if (oldKey && oldKey !== fileKey) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey })).catch(() => {});
    }

    if (ticketId && questionId) {
      const ticket = await getTicketFromDb(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: imageUrl } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId && questionId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: imageUrl } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId && questionId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: imageUrl } : question
      );
      await updateCustomTest(customTestId, { title: customTest.title, questions: updatedQuestions });
    }

    res.json({ success: true, imageUrl, key: fileKey });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Rasm yuklash amalga oshmadi" });
  }
});

app.delete("/api/upload-image", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const body = req.body || {};
    const ticketId = String(body.ticketId || "").trim();
    const topicId = String(body.topicId || "").trim();
    const customTestId = String(body.customTestId || "").trim();
    const questionId = String(body.questionId || "").trim();
    const imageUrl = String(body.imageUrl || "").trim();
    if ((!ticketId && !topicId && !customTestId) || !questionId) return res.status(400).json({ error: "Ticket yoki mavzu topilmadi" });

    const bucket = getR2BucketName();
    if (!bucket) return res.status(500).json({ error: "R2 bucket sozlanmagan" });

    const oldKey = deriveR2KeyFromPublicUrl(imageUrl);
    if (oldKey) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey })).catch(() => {});
    }

    if (ticketId) {
      const ticket = await getTicketFromDb(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateCustomTest(customTestId, { title: customTest.title, questions: updatedQuestions });
    }
    res.json({ success: true, imageUrl: "" });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Rasm o‘chirish amalga oshmadi" });
  }
});

app.post("/api/upload-audio", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const body = req.body || {};
    const audioBase64 = String(body.audioBase64 || "");
    const audioName = String(body.audioName || "");
    const audioType = String(body.audioType || "");
    const oldAudioUrl = String(body.oldAudioUrl || "").trim();
    const ticketId = String(body.ticketId || "").trim();
    const topicId = String(body.topicId || "").trim();
    const customTestId = String(body.customTestId || "").trim();
    const questionId = String(body.questionId || "").trim();

    if (!audioBase64) return res.status(400).json({ error: "Audio fayli topilmadi" });
    if (!isAllowedAudioType(audioType)) {
      return res.status(400).json({ error: "Faqat webm, ogg, mp4, m4a, mp3 va wav formatlar qabul qilinadi" });
    }

    const buffer = Buffer.from(audioBase64.replace(/^data:audio\/[^;]+(?:;[^,]+)?;base64,/, ""), "base64");
    if (buffer.length > MAX_AUDIO_SIZE) {
      return res.status(400).json({ error: "Audio hajmi 10MB dan oshmasligi kerak" });
    }

    const convertedBuffer = await convertAudioToM4a(buffer, audioName || "audio");
    const extension = "m4a";

    const bucket = getR2BucketName();
    if (!bucket) return res.status(500).json({ error: "R2 bucket sozlanmagan" });

    const fileKey = createMediaFileKey("audios", extension);
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        Body: convertedBuffer,
        ContentType: "audio/mp4"
      })
    );

    const audioUrl = buildR2PublicUrl(fileKey);
    const oldKey = deriveR2KeyFromPublicUrl(oldAudioUrl);
    if (oldKey && oldKey !== fileKey) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey })).catch(() => {});
    }

    if (ticketId && questionId) {
      const ticket = await getTicketFromDb(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: audioUrl } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId && questionId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: audioUrl } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId && questionId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: audioUrl } : question
      );
      await updateCustomTest(customTestId, { title: customTest.title, questions: updatedQuestions });
    }

    res.json({ success: true, audioUrl, key: fileKey });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Audio yuklash amalga oshmadi" });
  }
});

app.delete("/api/upload-audio", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const body = req.body || {};
    const ticketId = String(body.ticketId || "").trim();
    const topicId = String(body.topicId || "").trim();
    const customTestId = String(body.customTestId || "").trim();
    const questionId = String(body.questionId || "").trim();
    const audioUrl = String(body.audioUrl || "").trim();
    if ((!ticketId && !topicId && !customTestId) || !questionId) return res.status(400).json({ error: "Ticket yoki mavzu topilmadi" });

    const bucket = getR2BucketName();
    if (!bucket) return res.status(500).json({ error: "R2 bucket sozlanmagan" });

    const oldKey = deriveR2KeyFromPublicUrl(audioUrl);
    if (oldKey) {
      await r2.send(new DeleteObjectCommand({ Bucket: bucket, Key: oldKey })).catch(() => {});
    }

    if (ticketId) {
      const ticket = await getTicketFromDb(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: "" } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: "" } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        question && String(question.id) === questionId ? { ...question, audio: "" } : question
      );
      await updateCustomTest(customTestId, { title: customTest.title, questions: updatedQuestions });
    }

    res.json({ success: true, audioUrl: "" });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Audio o‘chirish amalga oshmadi" });
  }
});

app.get("/api/audio-proxy", async (req, res) => {
  try {
    const sourceUrl = String(req.query.url || "").trim();
    if (!sourceUrl) return res.status(400).json({ error: "Audio manzili topilmadi" });

    const payload = await getAudioProxyPayload(sourceUrl);
    res.setHeader("Content-Type", payload.contentType || "audio/mp4");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(payload.buffer);
  } catch (e) {
    res.status(400).json({ error: e?.message || "Audio yuklab bo‘lmadi" });
  }
});

function rewriteHlsPlaylist(playlistText, sourceUrl) {
  const source = String(sourceUrl || "").trim();
  const baseUrl = new URL(source);
  return String(playlistText || "")
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri) => {
          try {
            const absolute = new URL(String(uri), baseUrl).toString();
            return `URI="${buildProxiedMediaUrl(absolute, "video-stream")}"`;
          } catch {
            return _match;
          }
        });
      }
      try {
        const absolute = new URL(trimmed, baseUrl).toString();
        return buildProxiedMediaUrl(absolute, "video-stream");
      } catch {
        return line;
      }
    })
    .join("\n");
}

app.get("/api/video-stream", async (req, res) => {
  try {
    const sourceUrl = String(req.query.u || req.query.url || "").trim();
    if (!sourceUrl) return res.status(400).json({ error: "Video manzili topilmadi" });

    const parsed = new URL(sourceUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Bad protocol" });
    }

    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Topshirdi/1.0)",
        Referer: "https://topshirdi.uz/",
        Origin: "https://topshirdi.uz",
        Accept: "*/*"
      }
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `Video yuklab bo‘lmadi: ${upstream.status}`
      });
    }

    const contentType = String(upstream.headers.get("content-type") || "");
    const isPlaylist =
      contentType.includes("mpegurl") ||
      contentType.includes("vnd.apple.mpegurl") ||
      parsed.pathname.endsWith(".m3u8");

    if (isPlaylist) {
      const playlistText = await upstream.text();
      const rewritten = rewriteHlsPlaylist(playlistText, parsed.toString());
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.send(rewritten);
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", contentType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(body);
  } catch (e) {
    return res.status(400).json({ error: e?.message || "Video yuklab bo‘lmadi" });
  }
});

app.get("/api/image", async (req, res) => {
  const rawUrl = String(req.query.u || req.query.url || "");
  if (!rawUrl) return res.status(400).json({ error: "Rasm manzili topilmadi" });
  try {
    const parsed = new URL(rawUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) return res.status(400).json({ error: "Bad protocol" });
    const upstream = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JoRabekAvtoTest/1.0)",
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    if (!upstream.ok) return res.redirect(302, "/default.png");
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return res.redirect(302, "/default.png");
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    const body = await upstream.arrayBuffer();
    return res.send(Buffer.from(body));
  } catch {
    return res.redirect(302, "/default.png");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

async function migrateTicketData() {
  const tickets = await dbApi.all(
    "SELECT id, title, title_i18n, ticket_number, status, questions, created_at, updated_at FROM tickets ORDER BY created_at ASC, id ASC"
  );
  const usedNumbers = new Set(
    tickets
      .map((row) => Number(row.ticket_number || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  let nextNumber = usedNumbers.size ? Math.max(...Array.from(usedNumbers)) + 1 : 1;

  for (const row of tickets) {
    const currentNumber = Number(row.ticket_number || 0);
    if (!Number.isFinite(currentNumber) || currentNumber <= 0) {
      const parsedId = Number(row.id);
      const preferred = Number.isFinite(parsedId) && parsedId > 0 && !usedNumbers.has(parsedId) ? parsedId : nextNumber;
      const ticketNumber = preferred;
      usedNumbers.add(ticketNumber);
      nextNumber = Math.max(nextNumber, ticketNumber + 1);
      await dbApi.run("UPDATE tickets SET ticket_number = ?, status = CASE WHEN status = 'DRAFT' THEN 'DRAFT' ELSE 'COMPLETED' END WHERE id = ?", [
        ticketNumber,
        String(row.id)
      ]);
    } else {
      usedNumbers.add(currentNumber);
      nextNumber = Math.max(nextNumber, currentNumber + 1);
    }

    const existingQuestionCount = await dbApi.get("SELECT COUNT(*) AS count FROM ticket_questions WHERE ticket_id = ?", [String(row.id)]);
    const rawQuestions = parseQuestionsValue(row.questions);
    if (Number(existingQuestionCount?.count || 0) === 0 && rawQuestions.length) {
      for (const [index, question] of rawQuestions.entries()) {
        const questionId = String(question?.id || `${index + 1}`);
        await dbApi.run(
          `
            INSERT INTO ticket_questions (ticket_id, question_id, "order", created_at, updated_at)
            VALUES (?, ?, ?, NOW(), NOW())
            ON CONFLICT (question_id) DO NOTHING
          `,
          [String(row.id), questionId, index + 1]
        );
      }
    }
  }
}

async function start() {
  await initDb(dbApi);
  await migrateTicketData();
  await seedTopicsIfEmpty();
  await seedCustomTestsIfEmpty();
  app.listen(PORT, () => {
    console.log(`Web server listening on http://localhost:${PORT}`);
    console.log(`Swagger docs: http://localhost:${PORT}/docs`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
