const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const DEFAULT_ADMIN = {
  full_name: "Admin",
  phone: "+998901234567",
  password: "Admin123"
};

function toPgSql(sql) {
  // Convert sqlite-style "?" placeholders to Postgres "$1..$n" placeholders.
  // Keeps it minimal so we don't have to rewrite every query.
  let idx = 0;
  let out = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const prev = i > 0 ? sql[i - 1] : "";

    if (!inDouble && ch === "'" && prev !== "\\") inSingle = !inSingle;
    if (!inSingle && ch === '"' && prev !== "\\") inDouble = !inDouble;

    if (!inSingle && !inDouble && ch === "?") {
      idx += 1;
      out += `$${idx}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function openDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL (PostgreSQL connection string)");

  const pool = new Pool({
    connectionString: databaseUrl,
    max: Number(process.env.PG_POOL_MAX || 10)
  });

  const run = async (sql, params = []) => {
    const r = await pool.query(toPgSql(sql), params);
    return r;
  };

  const get = async (sql, params = []) => {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows[0] || null;
  };

  const all = async (sql, params = []) => {
    const r = await pool.query(toPgSql(sql), params);
    return r.rows || [];
  };

  return { pool, run, get, all };
}

async function initDb(dbApi) {
  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      full_name TEXT,
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      google_sub TEXT UNIQUE,
      apple_sub TEXT UNIQUE,
      password_hash TEXT,
      password_reset_required BOOLEAN NOT NULL DEFAULT FALSE,
      pro_until TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Lightweight "migrations" for existing DBs
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;`);
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT FALSE;`);
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;`);
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;`);
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_sub TEXT;`);
  await dbApi.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;`);
  await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email)) WHERE email IS NOT NULL;`);
  await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx ON users (google_sub) WHERE google_sub IS NOT NULL;`);
  await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS users_apple_sub_unique_idx ON users (apple_sub) WHERE apple_sub IS NOT NULL;`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS promo_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      screenshot_file_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      activated BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS test_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL,
      answers TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, ticket_id)
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS user_mistakes (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      question_key TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_title TEXT NOT NULL DEFAULT '',
      question_index INTEGER NOT NULL DEFAULT 0,
      question JSONB NOT NULL,
      wrong_answer INTEGER NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, question_key)
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      admin_marked BOOLEAN NOT NULL DEFAULT FALSE,
      description TEXT NOT NULL DEFAULT '',
      accent TEXT NOT NULL DEFAULT '#2f6dff',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS slug TEXT;`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS admin_marked BOOLEAN NOT NULL DEFAULT FALSE;`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS accent TEXT NOT NULL DEFAULT '#2f6dff';`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE topics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS topics_slug_unique_idx ON topics (slug);`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS topic_question_bank (
      question_key TEXT PRIMARY KEY,
      topic_id BIGINT NOT NULL,
      topic_slug TEXT NOT NULL DEFAULT '',
      topic_title TEXT NOT NULL,
      question_id TEXT NOT NULL,
      question_index INTEGER NOT NULL DEFAULT 0,
      question JSONB NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS topic_id BIGINT NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS topic_slug TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS topic_title TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS question_id TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS question_index INTEGER NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS question JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE topic_question_bank ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await dbApi.run(`CREATE UNIQUE INDEX IF NOT EXISTS topic_question_bank_sort_order_unique_idx ON topic_question_bank (sort_order);`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS custom_tests (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      questions JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbApi.run(`ALTER TABLE custom_tests ADD COLUMN IF NOT EXISTS questions JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await dbApi.run(`ALTER TABLE custom_tests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS video_lessons (
      id BIGSERIAL PRIMARY KEY,
      topic_id BIGINT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      premium_only BOOLEAN NOT NULL DEFAULT FALSE,
      bunny_video_id TEXT NOT NULL DEFAULT '',
      bunny_library_id TEXT NOT NULL DEFAULT '',
      video_status TEXT NOT NULL DEFAULT 'processing',
      video_duration INTEGER NOT NULL DEFAULT 0,
      video_thumbnail TEXT NOT NULL DEFAULT '',
      playback_url TEXT NOT NULL DEFAULT '',
      youtube_url TEXT NOT NULL DEFAULT '',
      youtube_id TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS topic_id BIGINT NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS premium_only BOOLEAN NOT NULL DEFAULT FALSE;`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS bunny_video_id TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS bunny_library_id TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS video_status TEXT NOT NULL DEFAULT 'processing';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS video_duration INTEGER NOT NULL DEFAULT 0;`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS video_thumbnail TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS playback_url TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS youtube_url TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS youtube_id TEXT NOT NULL DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await dbApi.run(`UPDATE video_lessons SET youtube_url = '' WHERE youtube_url IS NULL;`);
  await dbApi.run(`UPDATE video_lessons SET youtube_id = '' WHERE youtube_id IS NULL;`);
  await dbApi.run(`ALTER TABLE video_lessons ALTER COLUMN youtube_url SET DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ALTER COLUMN youtube_id SET DEFAULT '';`);
  await dbApi.run(`ALTER TABLE video_lessons ALTER COLUMN youtube_url SET NOT NULL;`);
  await dbApi.run(`ALTER TABLE video_lessons ALTER COLUMN youtube_id SET NOT NULL;`);
  await dbApi.run(`CREATE INDEX IF NOT EXISTS video_lessons_topic_id_idx ON video_lessons (topic_id);`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS custom_test_progress (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      custom_test_id BIGINT NOT NULL REFERENCES custom_tests(id) ON DELETE CASCADE,
      answers TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, custom_test_id)
    );
  `);
  await dbApi.run(`ALTER TABLE custom_test_progress DROP CONSTRAINT IF EXISTS custom_test_progress_custom_test_id_fkey;`);
  await dbApi.run(`ALTER TABLE custom_test_progress ALTER COLUMN custom_test_id TYPE TEXT USING custom_test_id::TEXT;`);

  await dbApi.run(`
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_count INTEGER NOT NULL DEFAULT 50,
      duration_seconds INTEGER NOT NULL DEFAULT 3000,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed BOOLEAN NOT NULL DEFAULT FALSE,
      score INTEGER NOT NULL DEFAULT 0,
      selection JSONB NOT NULL DEFAULT '[]'::jsonb,
      answers JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id)
    );
  `);

  const passwordHash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
  await dbApi.run(
    `
      INSERT INTO users (full_name, phone, password_hash, is_admin)
      VALUES (?, ?, ?, TRUE)
      ON CONFLICT (phone) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        password_hash = EXCLUDED.password_hash,
        is_admin = TRUE
    `,
    [DEFAULT_ADMIN.full_name, DEFAULT_ADMIN.phone, passwordHash]
  );

  console.log(`[admin] default admin ready -> phone: ${DEFAULT_ADMIN.phone}, password: ${DEFAULT_ADMIN.password}`);
}

module.exports = { openDb, initDb };
