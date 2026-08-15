import { getAllCachedTickets, type CachedQuestion, type CachedTicket } from "./content-db";

// Exact port of backend/server.js's shuffleWithSeed() — deliberately NOT the same function as
// lib/test-page-settings.tsx's shuffleQuestionsWithSeed(), which adds an "avoid identity
// permutation" correction for in-test option shuffling. Generated custom tests need to match the
// server's raw algorithm exactly so the same test id shows the same questions online and offline.
function rawShuffleWithSeed<T>(items: T[], seedValue: number): T[] {
  const result = [...items];
  let seed = Number.isFinite(seedValue) && seedValue > 0 ? Math.floor(seedValue) >>> 0 : 1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

// Local, offline-capable equivalents of two backend read paths that both ultimately flatten every
// COMPLETED ticket's questions into one ordered pool: getTicketQuestionBankFromDb() (backend
// server.js) backs /api/answers (marathon + "Barcha testlar javoblari"), and
// buildGeneratedCustomTestFromBankSize() backs /api/custom-tests (the "Sozlamali testlar" list).
// Both are ported here byte-for-byte against the already-cached `tickets` IndexedDB store so they
// work with no network at all once tickets have synced once.

export type AnswerQuestion = {
  id: string;
  kind: "ticket";
  sourceId: string;
  sourceTitle: string;
  questionIndex: number;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  correctAnswer: string;
  explanation: string;
  hasImage: boolean;
};

export type LocalGeneratedQuestion = {
  id: string;
  kind: "ticket";
  sourceId: string;
  sourceTitle: string;
  questionIndex: number;
  text: string;
  image?: string;
  audio?: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  i18n?: Record<string, unknown>;
};

export type LocalGeneratedCustomTest = {
  id: number;
  title: string;
  questions: LocalGeneratedQuestion[];
  questionsCount: number;
};

type BankItem = {
  id: string; // = questionKey; satisfies shuffleQuestionsWithSeed's {id:string} constraint
  questionKey: string;
  ticketId: string;
  ticketTitle: string;
  questionIndex: number;
  question: CachedQuestion;
};

function buildTicketQuestionBankKey(ticketId: string, questionId: string) {
  return `ticket:${ticketId}:${questionId}`;
}

function ticketSortKey(ticket: CachedTicket) {
  return {
    number: Number(ticket.ticketNumber || 0),
    created: ticket.created_at ? Date.parse(ticket.created_at) : 0,
    id: String(ticket.id || "")
  };
}

// Mirrors getTicketQuestionBankFromDb(): iterate COMPLETED tickets in ticket_number/created_at/id
// order, then each ticket's questions in array order, skipping empty slots.
export async function getLocalTicketQuestionBank(): Promise<BankItem[]> {
  const tickets = await getAllCachedTickets();
  const completed = tickets
    .filter((ticket) => (ticket.status || "").toUpperCase() === "COMPLETED")
    .sort((a, b) => {
      const ak = ticketSortKey(a);
      const bk = ticketSortKey(b);
      if (ak.number !== bk.number) return ak.number - bk.number;
      if (ak.created !== bk.created) return ak.created - bk.created;
      return ak.id.localeCompare(bk.id);
    });

  const bank: BankItem[] = [];
  for (const ticket of completed) {
    const questions = Array.isArray(ticket.questions) ? ticket.questions : [];
    questions.forEach((question, index) => {
      if (!question) return;
      const questionId = String(question.id || `${index + 1}`);
      const questionKey = buildTicketQuestionBankKey(String(ticket.id), questionId);
      bank.push({
        id: questionKey,
        questionKey,
        ticketId: String(ticket.id),
        ticketTitle: String(ticket.title || ""),
        questionIndex: index,
        question
      });
    });
  }
  return bank;
}

function buildAnswerQuestion(sourceId: string, sourceTitle: string, question: CachedQuestion, questionIndex: number): AnswerQuestion {
  const options = Array.isArray(question?.options) ? question.options.map((option) => String(option || "")) : [];
  const correctIndex = Number.isFinite(Number(question?.correctIndex)) ? Number(question.correctIndex) : 0;
  const questionId = String(question?.id || questionIndex);
  return {
    id: `ticket:${sourceId}:${questionId}`,
    kind: "ticket",
    sourceId: String(sourceId),
    sourceTitle: String(sourceTitle || ""),
    questionIndex: Number(questionIndex) + 1,
    text: String(question?.text || ""),
    image: String(question?.image || ""),
    audio: String(question?.audio || ""),
    options,
    correctIndex,
    correctAnswer: options[correctIndex] || "",
    explanation: String(question?.explanation || ""),
    hasImage: Boolean(String(question?.image || "").trim())
  };
}

// Local equivalent of GET /api/answers (unfiltered) — used by marathon (shuffled) and the answers
// browse page (filtered/searched/paginated client-side, see those pages).
export async function getLocalAnswerBank(): Promise<AnswerQuestion[]> {
  const bank = await getLocalTicketQuestionBank();
  return bank.map((item) => buildAnswerQuestion(item.ticketId, item.ticketTitle, item.question, item.questionIndex));
}

function sizesForBankLength(bankLength: number): number[] {
  const sizes: number[] = [];
  for (let size = 20; size <= bankLength; size += 20) sizes.push(size);
  return sizes;
}

// Pure — takes an already-built bank, does no IndexedDB reads. Must stay a byte-for-byte port of
// buildGeneratedCustomTestFromBankSize() (same rawShuffleWithSeed algorithm, same 9000+size seed,
// same slice) so a given generated test id shows the same questions online and offline.
function buildGeneratedCustomTestFromBank(bank: BankItem[], size: number): LocalGeneratedCustomTest | null {
  if (!Number.isFinite(size) || size <= 0 || size % 20 !== 0 || size > bank.length) return null;

  const shuffled = rawShuffleWithSeed(bank, 9000 + size);
  const questions: LocalGeneratedQuestion[] = shuffled.slice(0, size).map((item) => {
    const question = item.question || ({} as CachedQuestion);
    return {
      id: String(item.questionKey || question.id || ""),
      kind: "ticket",
      sourceId: String(item.ticketId || ""),
      sourceTitle: String(item.ticketTitle || ""),
      questionIndex: Number(item.questionIndex || 0) + 1,
      text: String(question.text || ""),
      image: String(question.image || ""),
      audio: String(question.audio || ""),
      options: Array.isArray(question.options) ? question.options.map((option) => String(option || "")) : [],
      correctIndex: Number.isFinite(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
      explanation: String(question.explanation || ""),
      i18n: question.i18n as Record<string, unknown> | undefined
    };
  });

  return { id: 1000 + size, title: `${size} ta`, questions, questionsCount: questions.length };
}

export async function getLocalGeneratedCustomTest(size: number): Promise<LocalGeneratedCustomTest | null> {
  const bank = await getLocalTicketQuestionBank();
  return buildGeneratedCustomTestFromBank(bank, size);
}

export async function getLocalGeneratedCustomTestById(testId: string | number): Promise<LocalGeneratedCustomTest | null> {
  const raw = Number(testId);
  if (!Number.isFinite(raw)) return null;
  const size = raw >= 1000 ? raw - 1000 : raw;
  return getLocalGeneratedCustomTest(size);
}

// Builds every generated test in one pass — fetches the ticket bank exactly once instead of once
// per size, which is what made the "Sozlamali testlar" list page slow (it used to call
// getLocalGeneratedCustomTest() per size, each rebuilding the whole bank from IndexedDB from
// scratch).
export async function getLocalGeneratedCustomTestList(): Promise<LocalGeneratedCustomTest[]> {
  const bank = await getLocalTicketQuestionBank();
  const sizes = sizesForBankLength(bank.length);
  const tests: LocalGeneratedCustomTest[] = [];
  for (const size of sizes) {
    const test = buildGeneratedCustomTestFromBank(bank, size);
    if (test) tests.push(test);
  }
  return tests;
}
