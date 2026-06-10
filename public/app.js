/* ═══════════════════════════════════════
   LuizOS 95 — app.js
═══════════════════════════════════════ */

const API = "/api";

// ─── State ────────────────────────────────────────────────────────────────────
let adminPassword = "";
let allUsers = [];

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  // Show in Brasília time (UTC-3)
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const brt = new Date(utc - 3 * 3600000);
  const h = String(brt.getHours()).padStart(2, "0");
  const m = String(brt.getMinutes()).padStart(2, "0");
  document.getElementById("taskbar-clock").textContent = `${h}:${m}`;
}
setInterval(updateClock, 1000);
updateClock();

// ─── Window management ────────────────────────────────────────────────────────
const minimizedWindows = {};

function openWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.style.display = "block";
  if (id === "win-guess") {
    centerWindow(w);
    checkTodayStatus();
  }
  delete minimizedWindows[id];
  bringToFront(w);
  updateTaskbar();
}

function centerWindow(w) {
  const taskbarHeight = 34;
  const availableHeight = window.innerHeight - taskbarHeight;
  w.style.left = `${Math.max(0, Math.round((window.innerWidth - w.offsetWidth) / 2))}px`;
  w.style.top = `${Math.max(0, Math.round((availableHeight - w.offsetHeight) / 2))}px`;
}

function closeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  w.style.display = "none";
  delete minimizedWindows[id];
  updateTaskbar();
}

function minimizeWindow(id) {
  const w = document.getElementById(id);
  if (!w) return;
  minimizedWindows[id] = true;
  w.style.display = "none";
  updateTaskbar();
}

function bringToFront(el) {
  document.querySelectorAll(".win95-window").forEach((w) => w.classList.remove("active"));
  el.classList.add("active");
}

// Click on window to bring to front
document.querySelectorAll(".win95-window").forEach((w) => {
  w.addEventListener("mousedown", () => bringToFront(w));
});

function updateTaskbar() {
  const bar = document.getElementById("taskbar-apps");
  bar.innerHTML = "";
  const windows = {
    "win-guess": "🎯 Aposta",
    "win-today": "📋 Hoje",
    "win-history": "📅 Histórico",
    "win-rank": "🏆 Ranking",
    "win-register": "👤 Cadastro",
    "win-admin": "🔒 Admin",
  };
  for (const [id, label] of Object.entries(windows)) {
    const w = document.getElementById(id);
    if (!w) continue;
    // Show in taskbar if open OR minimized
    if (w.style.display !== "none" || minimizedWindows[id]) {
      const btn = document.createElement("button");
      btn.className = "taskbar-app-btn";
      btn.textContent = label;
      btn.style.fontWeight = minimizedWindows[id] ? "normal" : "bold";
      btn.onclick = () => {
        if (minimizedWindows[id]) {
          openWindow(id);
        } else {
          bringToFront(w);
        }
      };
      bar.appendChild(btn);
    }
  }
}

// ─── Dragging ─────────────────────────────────────────────────────────────────
let drag = null;

function startDrag(e, id) {
  const w = document.getElementById(id);
  bringToFront(w);
  drag = {
    el: w,
    startX: e.clientX - w.offsetLeft,
    startY: e.clientY - w.offsetTop,
  };
  e.preventDefault();
}

document.addEventListener("mousemove", (e) => {
  if (!drag) return;
  const x = Math.max(0, Math.min(e.clientX - drag.startX, window.innerWidth - drag.el.offsetWidth));
  const y = Math.max(0, Math.min(e.clientY - drag.startY, window.innerHeight - drag.el.offsetHeight - 34));
  drag.el.style.left = x + "px";
  drag.el.style.top = y + "px";
});

document.addEventListener("mouseup", () => { drag = null; });

// ─── Start Menu ───────────────────────────────────────────────────────────────
function toggleStartMenu() {
  const m = document.getElementById("start-menu");
  m.style.display = m.style.display === "none" ? "block" : "none";
}
function closeStartMenu() {
  document.getElementById("start-menu").style.display = "none";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".start-menu") && !e.target.closest(".start-btn")) closeStartMenu();
});

// ─── Load Users ───────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch(`${API}/users`);
    allUsers = await res.json();
    const sel = document.getElementById("guess-user-select");
    sel.innerHTML = '<option value="">-- Selecione --</option>';
    allUsers.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.name;
      opt.textContent = u.name;
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error("loadUsers", e);
  }
}

function loadUserPhoto() {
  const sel = document.getElementById("guess-user-select");
  const name = sel.value;
  const area = document.getElementById("user-photo-area");
  const img = document.getElementById("user-photo");
  if (!name) { area.style.display = "none"; return; }
  const user = allUsers.find((u) => u.name === name);
  if (user && user.photo) {
    img.src = `/photos/${user.photo}`;
    img.onerror = () => { area.style.display = "none"; };
    img.onload = () => { area.style.display = "flex"; };
  } else {
    area.style.display = "none";
  }
}

// ─── Guess ────────────────────────────────────────────────────────────────────
async function checkTodayStatus() {
  try {
    const res = await fetch(`${API}/today`);
    const data = await res.json();
    const banner = document.getElementById("guess-status-banner");
    const currentTime = data.currentTime || getBrasiliaTime();
    const bettingOpen = Boolean(res.ok && data.bettingOpen);

    if (data.arrival) {
      banner.textContent = `⛔ Luiz chegou às ${data.arrival}! Apostas encerradas.`;
      banner.className = "win95-status-bar show closed";
    } else if (!bettingOpen) {
      banner.textContent = `⛔ Apostas encerradas (passou das 10h). Horário atual: ${currentTime}.`;
      banner.className = "win95-status-bar show closed";
    } else {
      banner.textContent = `✅ Apostas abertas! Horário atual: ${currentTime}.`;
      banner.className = "win95-status-bar show open";
    }
    setGuessFormOpen(bettingOpen);
  } catch {
    const banner = document.getElementById("guess-status-banner");
    if (banner) {
      banner.textContent = `⛔ Apostas indisponíveis no momento. Horário atual: ${getBrasiliaTime()}.`;
      banner.className = "win95-status-bar show closed";
    }
    setGuessFormOpen(false);
  }
}

function setGuessFormOpen(isOpen) {
  const timeGroup = document.getElementById("guess-time-group");
  const submitRow = document.getElementById("guess-submit-row");
  const timeInput = document.getElementById("guess-time");
  const timeOptions = document.getElementById("guess-time-options");

  if (timeGroup) timeGroup.style.display = isOpen ? "flex" : "none";
  if (submitRow) submitRow.style.display = isOpen ? "flex" : "none";
  if (timeInput) timeInput.disabled = !isOpen;
  if (!isOpen && timeOptions) timeOptions.classList.remove("show");
}

function setGuessTime(time) {
  const input = document.getElementById("guess-time");
  const options = document.getElementById("guess-time-options");
  if (!input) return;

  input.value = clampTime(time);
  if (options) options.classList.remove("show");
}

function adjustGuessTime(deltaMinutes) {
  const input = document.getElementById("guess-time");
  if (!input || input.disabled) return;

  const mins = timeToMinutes(input.value || "09:00");
  input.value = minutesToTime(clampMinutes(mins + deltaMinutes));
}

function normalizeGuessTime() {
  const input = document.getElementById("guess-time");
  if (!input) return;

  input.value = clampTime(input.value || "09:00");
}

function openGuessTimeOptions() {
  const input = document.getElementById("guess-time");
  const options = document.getElementById("guess-time-options");
  if (!input || input.disabled || !options) return;

  normalizeGuessTime();
  options.classList.toggle("show");
}

async function submitGuess() {
  normalizeGuessTime();

  const name = document.getElementById("guess-user-select").value;
  const password = document.getElementById("guess-password").value;
  const time = document.getElementById("guess-time").value;
  const msg = document.getElementById("guess-msg");

  if (!name || !password || !time) {
    showMsg(msg, "Preencha todos os campos.", "err");
    return;
  }

  try {
    const res = await fetch(`${API}/guess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password, time }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Aposta registrada! Você apostou ${time}.`, "ok");
      document.getElementById("guess-password").value = "";
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch (e) {
    showMsg(msg, "Erro de conexão.", "err");
  }
}

// ─── Today ────────────────────────────────────────────────────────────────────
async function loadToday() {
  const container = document.getElementById("today-content");
  container.innerHTML = '<div class="loading">Carregando...</div>';
  try {
    const res = await fetch(`${API}/today`);
    const data = await res.json();
    let html = "";

    const [y, m, d] = data.date.split("-");
    html += `<div class="section-label">📅 ${d}/${m}/${y} — Horário atual: ${data.currentTime}</div>`;

    if (data.arrival) {
      html += `<div class="today-arrival-box">🚪 Luiz chegou às <strong>${data.arrival}</strong>!</div>`;
    } else if (!data.bettingOpen) {
      html += `<div class="info-box">⏰ Apostas encerradas (passou das 10h). Aguardando chegada do Luiz...</div>`;
    } else {
      html += `<div class="info-box">✅ Apostas abertas até as 10:00 ou até o Luiz chegar.</div>`;
    }

    if (data.rankings && data.rankings.length > 0) {
      html += `<div class="section-label" style="margin-top:8px">🏆 Resultado do Dia</div>`;
      html += renderRankingsTable(data.rankings, data.arrival);
    } else if (data.guesses && data.guesses.length > 0) {
      html += `<div class="section-label" style="margin-top:8px">🎯 Apostas registradas (${data.guesses.length})</div>`;
      html += renderGuessesTable(data.guesses);
    } else {
      html += `<div class="no-data">Nenhuma aposta ainda hoje.</div>`;
    }

    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const container = document.getElementById("history-content");
  container.innerHTML = '<div class="loading">Carregando...</div>';
  try {
    const res = await fetch(`${API}/history`);
    const days = await res.json();
    if (days.length === 0) {
      container.innerHTML = '<div class="no-data">Nenhum histórico disponível ainda.</div>';
      return;
    }
    let html = "";
    for (const day of days) {
      const [y, m, d] = day.date.split("-");
      const dateLabel = `${d}/${m}/${y}`;
      html += `
        <div class="history-day">
          <div class="history-day-header" onclick="toggleHistory(this)">
            <span>📅 ${dateLabel} — Luiz chegou às <strong>${day.arrival}</strong></span>
            <span>▼</span>
          </div>
          <div class="history-day-body">
            ${day.rankings.length > 0 ? renderRankingsTable(day.rankings, day.arrival) : '<div class="no-data">Sem apostas.</div>'}
          </div>
        </div>`;
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  }
}

function toggleHistory(header) {
  const body = header.nextElementSibling;
  const isOpen = body.classList.contains("open");
  body.classList.toggle("open", !isOpen);
  header.querySelector("span:last-child").textContent = isOpen ? "▼" : "▲";
}

// ─── Overall Rank ─────────────────────────────────────────────────────────────
async function loadOverallRank() {
  const container = document.getElementById("rank-content");
  container.innerHTML = '<div class="loading">Calculando ranking...</div>';
  try {
    const res = await fetch(`${API}/overall-rank`);
    const ranks = await res.json();
    if (ranks.length === 0) {
      container.innerHTML = '<div class="no-data">Nenhum dado disponível ainda.</div>';
      return;
    }

    let html = `<div class="section-label">🏆 Ranking Geral (último mês)</div>`;
    html += `<table class="win95-table">
      <thead><tr>
        <th>#</th>
        <th>Nome</th>
        <th>Pontos</th>
        <th>Vitórias 🥇</th>
        <th>Dias</th>
        <th>Erro médio</th>
      </tr></thead><tbody>`;

    ranks.forEach((r, i) => {
      const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
      const errStr = formatMinutes(r.avgDiffMins);
      html += `<tr class="${medalClass}">
        <td>${i + 1}º</td>
        <td>${escHtml(r.name)}</td>
        <td><strong>${r.points}</strong></td>
        <td>${r.wins}</td>
        <td>${r.days}</td>
        <td>${errStr}</td>
      </tr>`;
    });
    html += "</tbody></table>";
    html += `<div class="info-box" style="margin-top:8px">Pontos: 1º lugar recebe N pts, 2º recebe N-1, etc. Erro médio = média da diferença entre o chute e a chegada real.</div>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  }
}

// ─── Register ─────────────────────────────────────────────────────────────────
async function registerUser() {
  const name = document.getElementById("reg-name").value.trim();
  const password = document.getElementById("reg-password").value;
  const msg = document.getElementById("reg-msg");

  if (!name || !password) {
    showMsg(msg, "Preencha nome e senha.", "err");
    return;
  }
  try {
    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Usuário "${name}" criado com sucesso!`, "ok");
      document.getElementById("reg-name").value = "";
      document.getElementById("reg-password").value = "";
      loadUsers(); // Refresh select list
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────────
function adminLogin() {
  const pwd = document.getElementById("admin-password").value;
  const msg = document.getElementById("admin-login-msg");
  if (!pwd) { showMsg(msg, "Digite a senha.", "err"); return; }
  adminPassword = pwd;
  // Optimistic: show panel and verify on next action
  document.getElementById("admin-login-panel").style.display = "none";
  document.getElementById("admin-panel").style.display = "block";
}

async function setArrival() {
  const time = document.getElementById("admin-arrival-time").value;
  const date = document.getElementById("admin-date").value || undefined;
  const msg = document.getElementById("admin-msg");

  if (!time) { showMsg(msg, "Informe o horário.", "err"); return; }

  try {
    const body = { password: adminPassword, time };
    if (date) body.date = date;

    const res = await fetch(`${API}/admin/arrival`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Chegada registrada: ${time}`, "ok");
      const result = document.getElementById("admin-result");
      if (data.rankings && data.rankings.length > 0) {
        result.innerHTML = `<div class="section-label">🏆 Resultado</div>` + renderRankingsTable(data.rankings, time);
      }
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      if (res.status === 401) {
        // Wrong password — go back to login
        adminPassword = "";
        document.getElementById("admin-login-panel").style.display = "block";
        document.getElementById("admin-panel").style.display = "none";
        showMsg(document.getElementById("admin-login-msg"), "Senha incorreta.", "err");
      }
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `win95-msg ${type}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 5000);
}

function getBrasiliaTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const brt = new Date(utc - 3 * 3600000);
  const h = String(brt.getHours()).padStart(2, "0");
  const m = String(brt.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(value) {
  const raw = String(value).trim();
  let hours;
  let minutes;

  if (raw.includes(":")) {
    const [h, m = "0"] = raw.split(":");
    hours = Number(h);
    minutes = Number(m);
  } else {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return 9 * 60;

    if (digits.length <= 2) {
      hours = Number(digits);
      minutes = 0;
    } else {
      hours = Number(digits.slice(0, -2));
      minutes = Number(digits.slice(-2));
    }
  }

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 9 * 60;

  return hours * 60 + Math.max(0, Math.min(59, minutes));
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function clampMinutes(minutes) {
  const min = 6 * 60;
  const max = 13 * 60;
  return Math.max(min, Math.min(max, minutes));
}

function clampTime(value) {
  return minutesToTime(clampMinutes(timeToMinutes(value)));
}

function togglePassword(inputId, button) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const shouldShow = input.type === "password";
  input.type = shouldShow ? "text" : "password";
  button.setAttribute("aria-label", shouldShow ? "Ocultar senha" : "Mostrar senha");
  button.title = shouldShow ? "Ocultar senha" : "Mostrar senha";
  button.classList.toggle("active", shouldShow);
}

function escHtml(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

function renderRankingsTable(rankings, arrival) {
  let html = `<table class="win95-table">
    <thead><tr>
      <th>#</th>
      <th>Nome</th>
      <th>Chute</th>
      ${arrival ? "<th>Diferença</th>" : ""}
    </tr></thead><tbody>`;

  const medals = ["🥇","🥈","🥉"];
  rankings.forEach((r, i) => {
    const medal = medals[r.position - 1] || `${r.position}º`;
    const diffStr = r.diff !== undefined ? formatMinutes(r.diff) : "";
    html += `<tr>
      <td>${medal}</td>
      <td>${escHtml(r.name)}</td>
      <td><strong>${r.time}</strong></td>
      ${arrival ? `<td>${diffStr}</td>` : ""}
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

function renderGuessesTable(guesses) {
  let html = `<table class="win95-table">
    <thead><tr><th>Nome</th><th>Chute</th></tr></thead><tbody>`;
  guesses.forEach((g) => {
    html += `<tr><td>${escHtml(g.name)}</td><td><strong>${g.time}</strong></td></tr>`;
  });
  html += "</tbody></table>";
  return html;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadUsers();
checkTodayStatus();
centerWindow(document.getElementById("win-guess"));
// Auto-refresh today status every 60 seconds
setInterval(checkTodayStatus, 60000);
updateTaskbar();
