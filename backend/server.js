const express = require("express");
const path = require("path");
const fs = require("fs/promises");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { openDb, initDb } = require("./db");
const crypto = require("crypto");
const swaggerUi = require("swagger-ui-express");
const bcrypt = require("bcryptjs");
const { DeleteObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const PORT = Number(process.env.PORT || 3000);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "15mb";

const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));

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
    questions: parseQuestionsValue(row.questions)
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
    questions:
      source.questions !== undefined
        ? normalizeQuestions(source.questions)
        : Array.isArray(current?.questions)
          ? current.questions
          : []
  };
}

async function getTopicsFromDb() {
  const rows = await dbApi.all("SELECT id, slug, title, questions FROM topics ORDER BY id ASC");
  return rows.map(normalizeTopicRow);
}

async function getTopicFromDb(topicId) {
  const key = String(topicId || "").trim();
  if (!key) return null;
  const row = await dbApi.get("SELECT id, slug, title, questions FROM topics WHERE CAST(id AS TEXT) = ? OR slug = ? LIMIT 1", [key, key]);
  return row ? normalizeTopicRow(row) : null;
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
      INSERT INTO topics (slug, title, questions, created_at, updated_at)
      VALUES (?, ?, ?::jsonb, NOW(), NOW())
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.questions)]
  );
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
      SET slug = ?, title = ?, questions = ?::jsonb, updated_at = NOW()
      WHERE id = ?
      RETURNING *
    `,
    [slug, next.title, JSON.stringify(next.questions), current.id]
  );
  return normalizeTopicRow(result);
}

async function deleteTopic(topicId) {
  const current = await getTopicFromDb(topicId);
  if (!current) throw new Error("Mavzu topilmadi");
  await dbApi.run("DELETE FROM test_progress WHERE ticket_id = ?", [String(current.id)]);
  await dbApi.run("DELETE FROM topics WHERE id = ?", [String(current.id)]);
}

async function importTopics(topicItems) {
  if (!Array.isArray(topicItems)) throw new Error("topics massivi kerak");
  const upserted = [];
  for (let index = 0; index < topicItems.length; index += 1) {
    const item = topicItems[index];
    const existingInput = typeof item === "string" ? { title: item } : item || {};
    const existingBySlug = String(existingInput.slug || "").trim()
      ? await dbApi.get("SELECT id, slug, title, questions FROM topics WHERE slug = ?", [String(existingInput.slug).trim()])
      : null;
    const next = normalizeTopicInput(existingInput, existingInput.title || `Mavzu ${index + 1}`, existingBySlug ? normalizeTopicRow(existingBySlug) : null);
    const slug = existingBySlug ? String(existingBySlug.slug) : await ensureUniqueTopicSlug(next.slug);
    const existing = await dbApi.get("SELECT id, slug, title, questions FROM topics WHERE slug = ?", [slug]);
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

async function createUserFromPhone({ fullName, phone, password }) {
  const cleanName = String(fullName || "").trim();
  if (!cleanName) throw new Error("Ism kiritilishi kerak");

  const cleanPassword = String(password || "");
  if (cleanPassword.length < 6) throw new Error("Kamida 6 ta belgidan iborat parol yarating");

  const normalizedPhone = normalizeUzPhone(phone);
  const passwordHash = await bcrypt.hash(cleanPassword, 10);

  const existing = await dbApi.get("SELECT id FROM users WHERE phone = ?", [normalizedPhone]);
  if (existing) {
    const err = new Error("Bu telefon raqam allaqachon ro‘yxatdan o‘tgan");
    err.statusCode = 409;
    throw err;
  }

  const row = await dbApi.get(
    `
      INSERT INTO users (full_name, phone, password_hash)
      VALUES (?, ?, ?)
      RETURNING *
    `,
    [cleanName, normalizedPhone, passwordHash]
  );
  return row;
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

function signAccessToken(userId) {
  const payload = {
    typ: "access",
    sub: String(userId),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_MAX_AGE_SECONDS
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
  const accessToken = signAccessToken(userId);
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
      password: req.body?.password
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

app.post("/api/auth/register", handleRegister);
app.post("/api/register", handleRegister);

app.post("/api/auth/login", handleLogin);
app.post("/api/login", handleLogin);

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

app.get("/api/topics", async (_req, res) => {
  const topics = await getTopicsFromDb();
  res.json({ topics: topics.map((topic) => ({ id: topic.id, title: topic.title })) });
});

app.get("/api/topics/:topicId", async (req, res) => {
  const topic = await getTopicFromDb(String(req.params.topicId));
  if (!topic) return res.status(404).json({ error: "Mavzu topilmadi" });
  res.json({ topic });
});

app.get("/api/custom-tests", async (_req, res) => {
  const customTests = await getCustomTestsFromDb();
  res.json({ customTests: customTests.map((test) => ({ id: test.id, title: test.title })) });
});

app.get("/api/custom-tests/:testId", async (req, res) => {
  const customTest = await getCustomTestFromDb(String(req.params.testId));
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

  const customTest = await getCustomTestFromDb(testId);
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

app.get("/api/answers", requireUser, async (_req, res) => {
  const [tickets, topics, customTests] = await Promise.all([getTicketsFromDb(), getTopicsFromDb(), getCustomTestsFromDb()]);
  const questions = [
    ...tickets.flatMap((ticket) =>
      (Array.isArray(ticket.questions) ? ticket.questions : []).map((question, index) =>
        buildAnswerQuestion({ kind: "ticket", id: ticket.id, title: ticket.title, question, questionIndex: index })
      )
    ),
    ...topics.flatMap((topic) =>
      (Array.isArray(topic.questions) ? topic.questions : []).map((question, index) =>
        buildAnswerQuestion({ kind: "topic", id: topic.id, title: topic.title, question, questionIndex: index })
      )
    ),
    ...customTests.flatMap((customTest) =>
      (Array.isArray(customTest.questions) ? customTest.questions : []).map((question, index) =>
        buildAnswerQuestion({ kind: "custom", id: customTest.id, title: customTest.title, question, questionIndex: index })
      )
    )
  ];

  res.json({ questions });
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

  res.json({ ok: true, completed, score: correct, total: topic.questions.length });
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
  const token = signAccessToken(req.user.id);
  res.json({ ok: true, token });
});

app.get("/api/tickets", requireUser, async (req, res) => {
  const tickets = await getTicketsFromDb();
  const list = tickets.map((t, idx) => {
    return { id: t.id, title: t.title, locked: false };
  });
  res.json({ tickets: list, isPro: true });
});

app.get("/api/tickets/:ticketId", requireUser, async (req, res) => {
  const ticket = await getTicketByIdFromDb(String(req.params.ticketId));
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

async function getAllQuestionsPool() {
  const pool = [];
  const tickets = await getTicketsFromDb();
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

async function buildExamQuestions(count = 50) {
  const pool = await getAllQuestionsPool();
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

app.post("/api/exam/start", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const questions = await buildExamQuestions(50);
  if (questions.length !== 50) return res.status(400).json({ error: "Imtihon savollari yetarli emas" });

  const selection = questions.map((q) => ({ ticketId: q.ticketId, questionId: q.id }));
  const payload = { selection, answers: {} };

  await dbApi.run(
    `
    INSERT INTO test_progress (user_id, ticket_id, answers, completed, score, updated_at)
    VALUES (?, 'exam', ?, FALSE, 0, NOW())
    ON CONFLICT(user_id, ticket_id) DO UPDATE SET
      answers = excluded.answers,
      completed = FALSE,
      score = 0,
      updated_at = excluded.updated_at
  `,
    [userId, JSON.stringify(payload)]
  );

  res.json({ ok: true, exam: { questionsCount: 50 } });
});

app.get("/api/exam", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const row = await dbApi.get("SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = 'exam'", [
    userId
  ]);
  if (!row) return res.status(404).json({ error: "Exam not started" });

  const parsed = JSON.parse(row.answers || "{}");
  const selection = Array.isArray(parsed.selection) ? parsed.selection : [];
  const answers = parsed.answers && typeof parsed.answers === "object" ? parsed.answers : {};

  const pool = await getAllQuestionsPool();
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

app.post("/api/exam/progress", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const newAnswers = req.body?.answers;
  if (!newAnswers || typeof newAnswers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const row = await dbApi.get("SELECT * FROM test_progress WHERE user_id = ? AND ticket_id = 'exam'", [
    userId
  ]);
  if (!row) return res.status(404).json({ error: "Exam not started" });

  const parsed = JSON.parse(row.answers || "{}");
  const selection = Array.isArray(parsed.selection) ? parsed.selection : [];

  const pool = await getAllQuestionsPool();
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
    WHERE user_id = ? AND ticket_id = 'exam'
  `,
    [JSON.stringify(payload), completed, correct, new Date().toISOString(), userId]
  );

  res.json({ ok: true, completed, score: correct, total: selection.length });
});

app.post("/api/exam/reset", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  await dbApi.run("DELETE FROM test_progress WHERE user_id = ? AND ticket_id = 'exam'", [userId]);
  res.json({ ok: true });
});

app.post("/api/progress/:ticketId", requireUser, async (req, res) => {
  const userId = String(req.user.id);
  const ticketId = String(req.params.ticketId);
  const answers = req.body?.answers;
  if (!answers || typeof answers !== "object") return res.status(400).json({ error: "Javoblar obyekti kerak" });

  const ticket = await getTicketByIdFromDb(ticketId);
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
  res.json({ topics: topics.map((topic) => ({ id: topic.id, title: topic.title })) });
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
