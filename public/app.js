const tg = window.Telegram?.WebApp;

const state = {
  me: null,
  isPro: false,
  tickets: [],
  activeTicket: null,
  activeQuestionIndex: 0,
  answers: {},
  mode: "tickets" // tickets | ticket | exam
};

const FALLBACK_IMAGE = "/placeholder.svg";
const IMAGE_PROXY_PATH = "/img?u=";
const BOT_LINK = "https://t.me/JorabekAvtotest_bot";

function $(id) {
  return document.getElementById(id);
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
}

function getTheme() {
  return localStorage.getItem("theme") || "dark";
}

function setThemeIcon(theme) {
  const icon = $("themeIcon");
  if (!icon) return;
  icon.className = theme === "light" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";
}

function openModal() {
  $("modalOverlay").classList.remove("hidden");
  $("proModal").classList.remove("hidden");
  $("promoMsg").classList.add("hidden");
  $("promoMsg").textContent = "";
  $("promoInput").value = "";
}

function closeModal() {
  $("modalOverlay").classList.add("hidden");
  $("proModal").classList.add("hidden");
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const initData = tg?.initData || "";
  if (initData) headers["x-telegram-init-data"] = initData;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function renderTickets() {
  const grid = $("ticketsGrid");
  grid.innerHTML = "";

  for (const t of state.tickets) {
    const div = document.createElement("div");
    div.className = "card ticketCard";
    div.innerHTML = `
      <div class="ticketTitle">${t.title}</div>
      <div class="muted">${t.locked ? "Yopiq" : "Ochiq"}</div>
      ${t.locked ? `<div class="lock">PRO 🔒</div>` : ""}
    `;
    div.onclick = () => {
      if (t.locked) return openModal();
      openTicket(t.id);
    };
    grid.appendChild(div);
  }
}

function showTicketsView() {
  $("ticketsView").classList.remove("hidden");
  $("ticketView").classList.add("hidden");
  state.mode = "tickets";
}

function showTicketView() {
  $("ticketsView").classList.add("hidden");
  $("ticketView").classList.remove("hidden");
}

function renderQuestionNav() {
  const qNav = $("qNav");
  qNav.innerHTML = "";
  const qs = state.activeTicket.questions;

  qs.forEach((q, idx) => {
    const b = document.createElement("button");
    b.className = "qbtn";
    if (idx === state.activeQuestionIndex) b.classList.add("active");
    if (state.answers[q.id] !== undefined) b.classList.add("answered");
    b.textContent = String(idx + 1);
    b.onclick = () => {
      state.activeQuestionIndex = idx;
      renderTicket();
    };
    qNav.appendChild(b);
  });
}

function renderTicketMeta() {
  const total = state.activeTicket.questions.length;
  const answered = Object.keys(state.answers).length;
  if (state.mode === "exam") $("ticketMeta").textContent = `Imtihon: ${answered}/${total}`;
  else $("ticketMeta").textContent = `Javoblar: ${answered}/${total}`;
}

function renderQuestion() {
  const q = state.activeTicket.questions[state.activeQuestionIndex];
  const img = $("qImage");
  img.onerror = () => {
    if (img.src !== FALLBACK_IMAGE) img.src = FALLBACK_IMAGE;
  };
  const rawUrl = q.image || FALLBACK_IMAGE;
  const isExternal = /^https?:\/\//i.test(rawUrl);
  img.src = isExternal ? `${IMAGE_PROXY_PATH}${encodeURIComponent(rawUrl)}` : rawUrl;
  $("qText").textContent = q.text;

  const options = $("options");
  options.innerHTML = "";

  const selected = state.answers[q.id];
  const hasAnswered = selected !== undefined;

  q.options.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "option";
    btn.textContent = opt;
    btn.disabled = hasAnswered;
    if (hasAnswered) {
      if (idx === q.correctIndex) btn.classList.add("correct");
      else if (idx === selected) btn.classList.add("wrong");
    }
    btn.onclick = async () => {
      state.answers[q.id] = idx;
      await saveProgress();
      renderTicket();
    };
    options.appendChild(btn);
  });

  const answerMeta = $("answerMeta");
  const exp = $("explanation");
  if (hasAnswered) {
    const correctText = q.options[q.correctIndex];
    const selectedText = q.options[selected];
    const isCorrect = Number(selected) === Number(q.correctIndex);

    answerMeta.classList.remove("hidden");
    answerMeta.innerHTML = isCorrect
      ? `<b>To‘g‘ri!</b> To‘g‘ri javob: <b>${escapeHtml(correctText)}</b>`
      : `<b>Xato.</b> Siz tanlagan: <b>${escapeHtml(selectedText)}</b><br/>To‘g‘ri javob: <b>${escapeHtml(correctText)}</b>`;

    exp.classList.remove("hidden");
    exp.textContent = `Izoh: ${q.explanation || ""}`;
  } else {
    answerMeta.classList.add("hidden");
    answerMeta.textContent = "";
    exp.classList.add("hidden");
    exp.textContent = "";
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderResultIfCompleted() {
  const total = state.activeTicket.questions.length;
  const answered = Object.keys(state.answers).length;
  const result = $("result");
  if (answered < total) {
    result.classList.add("hidden");
    result.innerHTML = "";
    return;
  }

  let correct = 0;
  const wrongItems = [];
  for (const q of state.activeTicket.questions) {
    const selected = state.answers[q.id];
    const isCorrect = Number(selected) === Number(q.correctIndex);
    if (isCorrect) correct += 1;
    else {
      wrongItems.push({
        q,
        selected,
        correctIndex: q.correctIndex
      });
    }
  }
  const wrong = total - correct;

  const analysisHtml =
    wrongItems.length === 0
      ? `<div class="analysisItem"><div class="analysisItemTitle">Zo‘r! Hamma javoblar to‘g‘ri.</div></div>`
      : wrongItems
          .map((w, i) => {
            const selectedText = w.q.options[w.selected];
            const correctText = w.q.options[w.correctIndex];
            return `
              <div class="analysisItem">
                <div class="analysisItemTitle">Xato savol ${i + 1}</div>
                <div class="analysisItemText">
                  <b>Savol:</b> ${escapeHtml(w.q.text)}<br/>
                  <b>Siz tanlagan:</b> ${escapeHtml(selectedText)}<br/>
                  <b>To‘g‘ri javob:</b> ${escapeHtml(correctText)}<br/>
                  <b>Izoh:</b> ${escapeHtml(w.q.explanation || "")}
                </div>
              </div>
            `;
          })
          .join("");

  result.classList.remove("hidden");
  result.innerHTML = `
    <div class="resultTop">
      <div class="pillRow">
        <div class="pill ok"><i class="bi bi-check2-circle" aria-hidden="true"></i> To‘g‘ri: ${correct}</div>
        <div class="pill bad"><i class="bi bi-x-circle" aria-hidden="true"></i> Xato: ${wrong}</div>
        <div class="pill"><i class="bi bi-list-ol" aria-hidden="true"></i> Jami: ${total}</div>
      </div>
      <div class="muted">Taxlil: xato savollar bo‘yicha</div>
    </div>
    <div class="analysisList">${analysisHtml}</div>
  `;
}

function renderTicket() {
  $("ticketTitle").textContent = state.activeTicket.title;
  renderTicketMeta();
  renderQuestionNav();
  renderQuestion();
  renderResultIfCompleted();

  $("prevBtn").disabled = state.activeQuestionIndex <= 0;
  $("nextBtn").disabled = state.activeQuestionIndex >= state.activeTicket.questions.length - 1;
}

async function openTicket(ticketId) {
  const data = await api(`/api/tickets/${ticketId}`);
  state.activeTicket = data.ticket;
  state.activeQuestionIndex = 0;
  state.mode = "ticket";

  const progress = await api(`/api/progress/${ticketId}`);
  state.answers = progress.progress?.answers || {};

  showTicketView();
  renderTicket();
}

async function saveProgress() {
  if (!state.activeTicket) return;
  if (state.mode === "exam") {
    await api(`/api/exam/progress`, { method: "POST", body: { answers: state.answers } });
  } else {
    await api(`/api/progress/${state.activeTicket.id}`, {
      method: "POST",
      body: { answers: state.answers }
    });
  }
}

async function resetProgress() {
  if (!state.activeTicket) return;
  if (state.mode === "exam") {
    await api(`/api/exam/reset`, { method: "POST" });
    await api(`/api/exam/start`, { method: "POST" });
    await openExam({ keepRandom: true });
    return;
  }

  await api(`/api/progress/${state.activeTicket.id}/reset`, { method: "POST" });
  state.answers = {};
  state.activeQuestionIndex = 0;
  renderTicket();
}

async function openExam({ keepRandom = false } = {}) {
  // PRO required on server; if not pro, it will throw
  state.mode = "exam";
  state.activeQuestionIndex = 0;

  if (!keepRandom) {
    // If there's no existing exam, server returns 404; start a new one.
    try {
      await api("/api/exam");
    } catch (e) {
      if ((e?.message || "").toLowerCase().includes("not started")) {
        await api("/api/exam/start", { method: "POST" });
      } else {
        throw e;
      }
    }
  }

  const data = await api("/api/exam");
  state.activeTicket = { id: "exam", title: "Imtihon", questions: data.exam.questions };
  state.answers = data.exam.answers || {};
  showTicketView();
  renderTicket();
}

async function refreshTickets() {
  await api("/api/auth", { method: "POST" });
  const me = await api("/api/me");
  state.me = me.user;
  state.isPro = me.isPro;

  const data = await api("/api/tickets");
  state.tickets = data.tickets;
  state.isPro = data.isPro;
  renderProfile();
  renderTickets();
}

function renderProfile() {
  const el = $("profileName");
  if (!state.me) return el.classList.add("hidden");
  const name = state.me.first_name || state.me.username || "User";
  el.classList.remove("hidden");
  el.textContent = name;
}

function showPromoMsg(text, type = "info") {
  const el = $("promoMsg");
  el.classList.remove("hidden");
  el.textContent = text;
  el.style.borderColor = type === "ok" ? "rgba(54,211,153,0.5)" : "rgba(255,107,107,0.5)";
}

async function activatePromo() {
  const code = $("promoInput").value.trim();
  if (!code) return showPromoMsg("Promo kod kiriting.", "bad");
  if (!/^\d{5}$/.test(code)) return showPromoMsg("Promo kod 5 xonali bo‘lishi kerak.", "bad");

  try {
    const data = await api("/api/promo/activate", { method: "POST", body: { code } });
    state.isPro = data.isPro;
    showPromoMsg("✅ PRO faollashdi! Endi barcha biletlar ochildi.", "ok");
    await refreshTickets();
  } catch (e) {
    showPromoMsg(e.message || "Xatolik", "bad");
  }
}

function initUi() {
  const initialTheme = getTheme();
  setTheme(initialTheme);
  setThemeIcon(initialTheme);

  $("themeToggle").onclick = () => {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    setThemeIcon(next);
  };

  $("proBtn").onclick = openModal;
  $("examBtn").onclick = async () => {
    try {
      await api("/api/me");
      await openExam();
    } catch (e) {
      // If not PRO or auth fails, show promo modal
      openModal();
      if (e?.message) showPromoMsg(e.message, "bad");
    }
  };
  $("modalClose").onclick = closeModal;
  $("modalOverlay").onclick = closeModal;
  $("promoActivate").onclick = activatePromo;

  $("buyPromo").onclick = () => {
    // Go back to bot chat (works in Telegram and in regular browser)
    try {
      if (tg?.openTelegramLink) tg.openTelegramLink(BOT_LINK);
      else window.open(BOT_LINK, "_blank", "noopener,noreferrer");
    } catch {
      window.open(BOT_LINK, "_blank", "noopener,noreferrer");
    }
    try {
      tg?.close();
    } catch {}
  };

  $("backBtn").onclick = () => {
    state.activeTicket = null;
    state.answers = {};
    showTicketsView();
  };

  $("resetBtn").onclick = resetProgress;

  $("prevBtn").onclick = () => {
    if (!state.activeTicket) return;
    state.activeQuestionIndex = Math.max(0, state.activeQuestionIndex - 1);
    renderTicket();
  };

  $("nextBtn").onclick = () => {
    if (!state.activeTicket) return;
    state.activeQuestionIndex = Math.min(
      state.activeTicket.questions.length - 1,
      state.activeQuestionIndex + 1
    );
    renderTicket();
  };
}

async function bootstrap() {
  if (tg) {
    tg.ready();
    tg.expand();
  }

  initUi();

  try {
    await refreshTickets();
  } catch (e) {
    // If opened outside Telegram and not logged in, redirect to Telegram Login widget page.
    const msg = String(e.message || "");
    if (msg.includes("Missing initData")) {
      window.location.href = "/login.html";
      return;
    }
    const grid = $("ticketsGrid");
    grid.innerHTML = `<div class="card ticketCard"><div class="ticketTitle">Auth xatosi</div><div class="muted">${escapeHtml(msg || "Kirish xatosi")}</div></div>`;
  }
}

bootstrap();
