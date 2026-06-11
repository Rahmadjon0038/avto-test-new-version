const express = require("express");
const path = require("path");
const fs = require("fs/promises");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { openDb, initDb } = require("./db");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const bcrypt = require("bcryptjs");
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (error) {
  console.warn("[backend] nodemailer module not installed; password reset emails will fall back to temporary password response.");
}
const { DeleteObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const PORT = Number(process.env.PORT || 3000);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "15mb";
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || "https://road-test.uz,https://www.road-test.uz,https://api.road-test.uz")
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
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
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

function parseTicketRow(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    questions: parseQuestionsValue(row.questions)
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

async function getTicketsFromDb() {
  const rows = await dbApi.all("SELECT * FROM tickets ORDER BY created_at ASC, id ASC");
  return rows.map(parseTicketRow);
}

async function getTicketByIdFromDb(ticketId) {
  const row = await dbApi.get("SELECT * FROM tickets WHERE id = ?", [String(ticketId)]);
  return row ? parseTicketRow(row) : null;
}

function normalizeQuestions(value) {
  const questions = parseQuestionsValue(value);
  return questions
    .map((question, index) => ({
      id: String(question?.id || `${index + 1}`),
      image: String(question?.image || ""),
      text: String(question?.text || ""),
      options: Array.isArray(question?.options) ? question.options.map((option) => String(option || "").trim()) : [],
      correctIndex: Number.isFinite(Number(question?.correctIndex)) ? Number(question.correctIndex) : 0,
      explanation: String(question?.explanation || "")
    }))
    .filter((question) => question.text || question.options.some(Boolean));
}

function normalizeTicket(row) {
  return {
    id: String(row.id),
    title: String(row.title || ""),
    questions: normalizeQuestions(row.questions),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined
  };
}

async function getTickets() {
  const rows = await dbApi.all("SELECT * FROM tickets ORDER BY created_at ASC, id ASC");
  return rows.map(normalizeTicket);
}

async function getTicketById(id) {
  const row = await dbApi.get("SELECT * FROM tickets WHERE id = ?", [String(id)]);
  return row ? normalizeTicket(row) : null;
}

async function createTicket(input) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("Bilet nomi kiritilishi kerak");

  const existingIds = await dbApi.all("SELECT id FROM tickets");
  const numericIds = existingIds
    .map((row) => Number(row.id))
    .filter((value) => Number.isFinite(value));
  let ticketId = String(input.id || "");
  if (!ticketId) {
    ticketId = numericIds.length ? String(Math.max(...numericIds) + 1) : "1";
    while (existingIds.some((row) => String(row.id) === ticketId)) {
      ticketId = String(Number(ticketId) + 1);
    }
  }

  const questions = normalizeQuestions(input.questions || []).map((question) => {
    if (question.options.length < 2) throw new Error("Har bir savolda kamida 2 ta variant bo‘lishi kerak");
    if (question.options.some((option) => !option)) throw new Error("Barcha variantlarni to‘ldiring");
    if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
      throw new Error("To‘g‘ri javob variantini qayta tanlang");
    }
    return question;
  });

  const result = await dbApi.get(
    `INSERT INTO tickets (id, title, questions, created_at, updated_at)
     VALUES (?, ?, ?::jsonb, NOW(), NOW())
     RETURNING *`,
    [ticketId, title, JSON.stringify(questions)]
  );
  return normalizeTicket(result);
}

async function updateTicket(id, input) {
  const ticket = await getTicketById(id);
  if (!ticket) throw new Error("Bilet topilmadi");

  const title = input.title !== undefined ? String(input.title || "").trim() : ticket.title;
  if (!title) throw new Error("Bilet nomi kiritilishi kerak");

  const questions =
    input.questions !== undefined
      ? normalizeQuestions(input.questions).map((question) => {
          if (question.options.length < 2) throw new Error("Har bir savolda kamida 2 ta variant bo‘lishi kerak");
          if (question.options.some((option) => !option)) throw new Error("Barcha variantlarni to‘ldiring");
          if (question.correctIndex < 0 || question.correctIndex >= question.options.length) {
            throw new Error("To‘g‘ri javob variantini qayta tanlang");
          }
          return question;
        })
      : ticket.questions;

  const result = await dbApi.get(
    `UPDATE tickets SET title = ?, questions = ?::jsonb, updated_at = NOW() WHERE id = ? RETURNING *`,
    [title, JSON.stringify(questions), String(id)]
  );
  return normalizeTicket(result);
}

async function deleteTicket(id) {
  await dbApi.run("DELETE FROM test_progress WHERE ticket_id = ?", [String(id)]);
  await dbApi.run("DELETE FROM tickets WHERE id = ?", [String(id)]);
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
    questions: parseQuestionsValue(row.questions),
    adminMarked: row.admin_marked === true
  };
}

function normalizeTopicInput(input = {}, fallbackTitle = "", current = null) {
  const source = typeof input === "string" ? { title: input } : input || {};
  const titleSource = source.title !== undefined ? source.title : current?.title || fallbackTitle;
  const title = String(titleSource || "").trim();
  if (!title) throw new Error("Mavzu nomi kiritilishi kerak");
  return {
    title,
    slug: String(source.slug || current?.slug || "").trim() || slugifyTopic(title),
    adminMarked: source.adminMarked !== undefined ? Boolean(source.adminMarked) : Boolean(current?.adminMarked || false),
    questions:
      source.questions !== undefined
        ? normalizeQuestions(source.questions)
        : Array.isArray(current?.questions)
          ? current.questions
          : []
  };
}

function normalizeImportedTopicQuestion(input = {}, index = 0) {
  const source = input && typeof input === "object" ? input : {};
  const text = String(source.text || "").trim();
  if (!text) throw new Error(`Savol ${index + 1}: matn kiritilishi kerak`);

  const image = String(source.image || "").trim();
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
    text,
    options,
    correctIndex,
    explanation
  };
}

async function getTopicsFromDb() {
  const rows = await dbApi.all("SELECT id, slug, title, questions, admin_marked FROM topics ORDER BY id ASC");
  return rows.map(normalizeTopicRow);
}

async function getTopicFromDb(topicId) {
  const key = String(topicId || "").trim();
  if (!key) return null;
  const row = await dbApi.get("SELECT id, slug, title, questions, admin_marked FROM topics WHERE CAST(id AS TEXT) = ? OR slug = ? LIMIT 1", [key, key]);
  return row ? normalizeTopicRow(row) : null;
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
    text: String(normalized.text || ""),
    options: Array.isArray(normalized.options) ? normalized.options.map((option) => String(option || "")) : [],
    correctIndex: Number.isFinite(Number(normalized.correctIndex)) ? Number(normalized.correctIndex) : 0,
    explanation: String(normalized.explanation || "")
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

function buildGeneratedTicketFromBankChunk(chunk, ticketIndex) {
  return {
    id: `ticket-${ticketIndex + 1}`,
    title: `Bilet ${ticketIndex + 1}`,
    questions: chunk.map((item) => item.question),
    questionsCount: chunk.length,
    locked: false
  };
}

function buildGeneratedCustomTestFromBankSize(bank, size) {
  const questions = bank.slice(0, size).map((item) => item.question);
  return {
    id: 1000 + size,
    title: `${size} ta`,
    questions,
    questionsCount: questions.length
  };
}

async function getGeneratedTicketsFromDb() {
  const bank = await getTopicQuestionBankFromDb();
  return chunkArray(bank, 20).map((chunk, index) => buildGeneratedTicketFromBankChunk(chunk, index));
}

async function getGeneratedTicketByIdFromDb(ticketId) {
  const key = String(ticketId || "").trim();
  const match = /^ticket-(\d+)$/i.exec(key) || /^(\d+)$/.exec(key);
  if (!match) return null;
  const index = Number(match[1]) - 1;
  if (index < 0) return null;
  const bank = await getTopicQuestionBankFromDb();
  const chunk = bank.slice(index * 20, index * 20 + 20);
  if (!chunk.length) return null;
  return buildGeneratedTicketFromBankChunk(chunk, index);
}

async function getProgressTicketById(ticketId) {
  const current = await getTicketByIdFromDb(ticketId);
  if (current) return current;
  return getGeneratedTicketByIdFromDb(ticketId);
}

async function getGeneratedCustomTestsFromDb() {
  const bank = await getTopicQuestionBankFromDb();
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
  const bank = await getTopicQuestionBankFromDb();
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
      INSERT INTO topics (slug, title, questions, admin_marked, created_at, updated_at)
      VALUES (?, ?, ?::jsonb, ?, NOW(), NOW())
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.questions), next.adminMarked]
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
      SET slug = ?, title = ?, questions = ?::jsonb, admin_marked = ?, updated_at = NOW()
      WHERE id = ?
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.questions), next.adminMarked, current.id]
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
      ? await dbApi.get("SELECT id, slug, title, questions, admin_marked FROM topics WHERE slug = ?", [String(existingInput.slug).trim()])
      : null;
    const next = normalizeTopicInput(existingInput, existingInput.title || `Mavzu ${index + 1}`, existingBySlug ? normalizeTopicRow(existingBySlug) : null);
    const slug = existingBySlug ? String(existingBySlug.slug) : await ensureUniqueTopicSlug(next.slug);
    const existing = await dbApi.get("SELECT id, slug, title, questions, admin_marked FROM topics WHERE slug = ?", [slug]);
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
        required: ["fullName", "phone", "password"],
        properties: { fullName: { type: "string" }, phone: { type: "string" }, password: { type: "string" } }
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
  const cleanName = String(fullName || "").trim();
  if (!cleanName) throw new Error("Ism kiritilishi kerak");

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

  const updated = await dbApi.get(
    `
      UPDATE users
      SET full_name = ?,
          email = ?,
          google_sub = ?
      WHERE id = ?
      RETURNING *
    `,
    [nextFullName || null, nextEmail, nextGoogleSub, String(userId)]
  );
  return updated;
}

async function findUserByGoogleIdentity({ email, googleSub }) {
  if (!email && !googleSub) return null;

  const candidates = [];
  if (email) candidates.push(await dbApi.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]));
  if (googleSub) candidates.push(await dbApi.get("SELECT * FROM users WHERE google_sub = ?", [googleSub]));

  return candidates.find(Boolean) || null;
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

function generateTemporaryPassword(length = 6) {
  const digits = crypto.randomInt(0, 10 ** length).toString().padStart(length, "0");
  return digits.slice(0, length);
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
  if (!row?.password_hash) return { ok: false, error: "Telefon yoki parol noto‘g‘ri" };
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

const ACCESS_TOKEN_MAX_AGE_SECONDS = 60 * 15;
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

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

function normalizeAnswerQuestion(question) {
  const options = Array.isArray(question?.options) ? question.options.map((option) => String(option || "").trim()) : [];
  const correctIndex = Number.isFinite(Number(question?.correctIndex)) ? Number(question.correctIndex) : 0;
  return {
    id: String(question?.id || ""),
    text: String(question?.text || ""),
    image: String(question?.image || ""),
    options,
    correctIndex,
    correctAnswer: options[correctIndex] || "",
    explanation: String(question?.explanation || ""),
    hasImage: Boolean(String(question?.image || "").trim())
  };
}

function buildAnswerQuestion({ kind, id, title, question, questionIndex }) {
  const normalized = normalizeAnswerQuestion(question);
  return {
    id: `${kind}:${String(id)}:${normalized.id || questionIndex}`,
    kind,
    sourceId: String(id),
    sourceTitle: String(title || ""),
    sourceKind: kind,
    questionIndex: Number(questionIndex) + 1,
    ...normalized
  };
}

function buildMistakeQuestion({ kind, id, title, question, questionIndex, wrongAnswer }) {
  const base = buildAnswerQuestion({ kind, id, title, question, questionIndex });
  return {
    ...base,
    wrongAnswer: Number.isFinite(Number(wrongAnswer)) ? Number(wrongAnswer) : null
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
  const random = Math.random().toString(36).slice(2, 10);
  return `images/${Date.now()}-${random}.${extension}`;
}

async function respondWithAuthUser(req, res, user) {
  const phoneUi = user.phone ? formatUzPhoneForUi(user.phone) : null;
  const tokens = await issueTokensForUser(user.id, req, res);
  res.json({
    ok: true,
    accessToken: tokens.accessToken,
    user: { ...user, phone: phoneUi },
    isPro: isUserPro(user)
  });
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

async function handlePasswordResetRequest(req, res) {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email kiritilishi kerak" });

    const user = await dbApi.get("SELECT * FROM users WHERE LOWER(email) = LOWER(?)", [email]);
    if (!user) return res.status(404).json({ error: "Bu email bo‘yicha foydalanuvchi topilmadi" });

    const temporaryPassword = generateTemporaryPassword(6);
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    await dbApi.run("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, String(user.id)]);

    const mailResult = await sendTemporaryPasswordEmail({
      to: email,
      password: temporaryPassword,
      fullName: user.full_name
    });

    if (!mailResult.sent) {
      return res.status(503).json({
        error:
          "SMTP sozlanmagan. Email yuborish uchun `.env` fayliga SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS va SMTP_FROM qiymatlarini kiriting."
      });
    }

    res.json({
      ok: true,
      sent: mailResult.sent,
      message: "6 xonali kod emailingizga yuborildi"
    });
  } catch (e) {
    res.status(e?.statusCode || 400).json({ error: e?.message || "Parolni tiklash amalga oshmadi" });
  }
}

app.post("/api/auth/register", handleRegister);
app.post("/api/register", handleRegister);

app.post("/api/auth/login", handleLogin);
app.post("/api/login", handleLogin);

app.post("/api/auth/google", handleGoogleLogin);
app.post("/api/login/google", handleGoogleLogin);

app.post("/api/auth/password-reset/request", handlePasswordResetRequest);
app.post("/api/password-reset/request", handlePasswordResetRequest);

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
  const phoneUi = u.phone ? formatUzPhoneForUi(u.phone) : null;
  res.json({ user: { ...u, phone: phoneUi }, isPro: isUserPro(u) });
});

app.get("/api/auth/me", requireUser, async (req, res) => {
  const u = req.user;
  const phoneUi = u.phone ? formatUzPhoneForUi(u.phone) : null;
  res.json({ user: { ...u, phone: phoneUi }, isPro: isUserPro(u) });
});

app.get("/api/me", requireUser, async (req, res) => {
  const u = req.user;
  const phoneUi = u.phone ? formatUzPhoneForUi(u.phone) : null;
  res.json({ user: { ...u, phone: phoneUi }, isPro: isUserPro(u) });
});

app.get("/api/topics", async (req, res) => {
  const user = await getUserFromAccess(req);
  const topics = await getTopicsFromDb();
  let completedMap = new Map();
  if (user) {
    const rows = await dbApi.all("SELECT ticket_id, completed FROM test_progress WHERE user_id = ?", [String(user.id)]);
    completedMap = new Map(rows.map((row) => [String(row.ticket_id), row.completed === true]));
  }
  res.json({
    topics: topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      completed: completedMap.get(String(topic.id)) || false
    }))
  });
});

app.get("/api/topics/:topicId", async (req, res) => {
  const topic = await getTopicFromDb(String(req.params.topicId));
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
  res.json({ topic });
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
  const bank = await getTopicQuestionBankFromDb();
  const questions = bank.map((item) =>
    buildAnswerQuestion({
      kind: "topic",
      id: item.topicId,
      title: item.topicTitle,
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
  const tickets = await getGeneratedTicketsFromDb();
  res.json({
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      title: ticket.title,
      locked: false,
      questionsCount: ticket.questionsCount
    })),
    isPro: true
  });
});

app.get("/api/tickets/:ticketId", requireUser, async (req, res) => {
  const ticket = await getGeneratedTicketByIdFromDb(String(req.params.ticketId));
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });

  res.json({ ticket, isPro: true });
});

app.get("/api/progress/:ticketId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const ticketId = String(req.params.ticketId);

  const row = await dbApi.get(
    "SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = ?",
    [userId, ticketId]
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

  res.json({ ok: true, completed, score: correct, total: ticket.questions.length });
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
  const tickets = await getTickets();
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
  const ticket = await getTicketById(String(req.params.ticketId));
  if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
  res.json({ ticket });
});

app.patch("/api/admin/tickets/:ticketId", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  try {
    const ticket = await updateTicket(String(req.params.ticketId), {
      title: req.body?.title !== undefined ? String(req.body.title || "") : undefined,
      questions: Array.isArray(req.body?.questions) ? req.body.questions : undefined
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

app.get("/api/admin/users", async (req, res) => {
  const user = await getAdminFromAccess(req);
  if (!user) return res.status(403).json({ error: ADMIN_ACCESS_DENIED_MESSAGE });
  const rows = await dbApi.all(
    `
      SELECT id, full_name, phone, pro_until, created_at, is_admin
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
      is_admin: row.is_admin === true
    }))
  });
});

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
      const ticket = await getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: imageUrl } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId && questionId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: imageUrl } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId && questionId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: imageUrl } : question
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
      const ticket = await getTicketById(ticketId);
      if (!ticket) return res.status(404).json({ error: "Bilet topilmadi" });
      const updatedQuestions = ticket.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateTicket(ticketId, { title: ticket.title, questions: updatedQuestions });
    }

    if (topicId) {
      const topic = await getTopicFromDb(topicId);
      if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
      const updatedQuestions = topic.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateTopic(topicId, { title: topic.title, questions: updatedQuestions });
    }

    if (customTestId) {
      const customTest = await getCustomTestFromDb(customTestId);
      if (!customTest) return res.status(404).json({ error: "Test topilmadi" });
      const updatedQuestions = customTest.questions.map((question) =>
        String(question.id) === questionId ? { ...question, image: "" } : question
      );
      await updateCustomTest(customTestId, { title: customTest.title, questions: updatedQuestions });
    }
    res.json({ success: true, imageUrl: "" });
  } catch (e) {
    res.status(400).json({ error: e?.message || "Rasm o‘chirish amalga oshmadi" });
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

async function start() {
  await initDb(dbApi);
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
