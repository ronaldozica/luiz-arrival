/* ═══════════════════════════════════════
   LuizOS 95 — app.js  (v2)
═══════════════════════════════════════ */

const API = "/api";

// ─── State ────────────────────────────────────────────────────────────────────
let adminPassword  = "";
let allUsers       = [];
let currentUser    = null; // { name, password, photo, isHCM } — set after login
let todayStatusCache = null; // { data, ts } — cache to prevent stale re-guess
let todayPollTimer = null;

const windows = {
    "win-login":    "🔑 Login",
    "win-guess":    "🎯 Aposta",
    "win-today":    "📋 Hoje",
    "win-history":  "📅 Histórico",
    "win-rank":     "🏆 Ranking",
    "win-register": "👤 Cadastro",
    "win-admin":    "🔒 Admin",
    "win-gamerank": "🎮 Rank Jogos",
    "win-store":    "🛒 Loja",
  };

// ─── Loading overlay ─────────────────────────────────────────────────────────
function showLoading(msg) {
  let el = document.getElementById("global-loading");
  if (!el) {
    el = document.createElement("div");
    el.id = "global-loading";
    el.innerHTML = `<div class="loading-hourglass">⏳</div><div class="loading-text"></div>`;
    document.body.appendChild(el);
  }
  el.querySelector(".loading-text").textContent = msg || "Aguarde...";
  el.style.display = "flex";
}
function hideLoading() {
  const el = document.getElementById("global-loading");
  if (el) el.style.display = "none";
}

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
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
    refreshTodayStatus();
  }
  delete minimizedWindows[id];
  bringToFront(w);
  updateTaskbar();
}

function centerWindow(w) {
  const taskbarHeight = 34;
  const availableHeight = window.innerHeight - taskbarHeight;
  w.style.left = `${Math.max(0, Math.round((window.innerWidth  - w.offsetWidth)  / 2))}px`;
  w.style.top  = `${Math.max(0, Math.round((availableHeight   - w.offsetHeight) / 2))}px`;
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

document.querySelectorAll(".win95-window").forEach((w) => {
  w.addEventListener("mousedown", () => bringToFront(w));
});

function updateTaskbar() {
  const bar = document.getElementById("taskbar-apps");
  bar.innerHTML = "";
  const windows = {
    "win-login":    "🔑 Login",
    "win-guess":    "🎯 Aposta",
    "win-today":    "📋 Hoje",
    "win-history":  "📅 Histórico",
    "win-rank":     "🏆 Ranking",
    "win-register": "👤 Cadastro",
    "win-admin":    "🔒 Admin",
    "win-gamerank": "🎮 Rank Jogos",
  };
  for (const [id, label] of Object.entries(windows)) {
    const w = document.getElementById(id);
    if (!w) continue;
    if (w.style.display !== "none" || minimizedWindows[id]) {
      const btn = document.createElement("button");
      btn.className = "taskbar-app-btn";
      btn.textContent = label;
      btn.style.fontWeight = minimizedWindows[id] ? "normal" : "bold";
      btn.onclick = () => {
        if (minimizedWindows[id]) openWindow(id);
        else bringToFront(w);
      };
      bar.appendChild(btn);
    }
  }
}

// ─── Window Dragging ──────────────────────────────────────────────────────────
let drag = null;

function startDrag(e, id) {
  if (e.target.closest(".win95-btn-ctrl")) return;
  const w = document.getElementById(id);
  bringToFront(w);
  drag = {
    el: w,
    startX: e.clientX - w.offsetLeft,
    startY: e.clientY - w.offsetTop,
    isWindow: true,
  };
  e.preventDefault();
}

// ─── Desktop Icon Dragging + Selection Rectangle ──────────────────────────────
let iconDrag       = null;
let selRect        = null;
let selectedIcons  = new Set();

const ICON_POSITIONS_KEY = "luizos_icon_positions";
let defaultIconPositions = {};

function captureDefaultIconPositions() {
  defaultIconPositions = {};
  document.querySelectorAll(".desktop-icon").forEach((icon) => {
    const id = icon.dataset.iconId;
    if (!id) return;
    defaultIconPositions[id] = {
      left: `${icon.offsetLeft}px`,
      top: `${icon.offsetTop}px`,
    };
  });
}

function saveIconPositions() {
  const pos = {};
  document.querySelectorAll(".desktop-icon").forEach((icon) => {
    const id = icon.dataset.iconId;
    if (id) pos[id] = { left: icon.style.left, top: icon.style.top };
  });
  localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(pos));
}

function loadIconPositions() {
  try {
    const saved = JSON.parse(localStorage.getItem(ICON_POSITIONS_KEY) || "{}");
    let updated = false;
    document.querySelectorAll(".desktop-icon").forEach((icon) => {
      const id = icon.dataset.iconId;
      if (!id) return;
      const position = saved[id] || defaultIconPositions[id];
      if (!position) return;
      icon.style.position = "absolute";
      icon.style.left = position.left;
      icon.style.top  = position.top;
      if (!saved[id] && defaultIconPositions[id]) {
        saved[id] = defaultIconPositions[id];
        updated = true;
      }
    });
    if (updated) localStorage.setItem(ICON_POSITIONS_KEY, JSON.stringify(saved));
  } catch {}
}

function resetIconPositions() {
  localStorage.removeItem(ICON_POSITIONS_KEY);
  loadIconPositions();
  closeContextMenu();
}

function clearIconSelection() {
  selectedIcons.forEach((ic) => ic.classList.remove("selected"));
  selectedIcons.clear();
}

function selectIcon(icon) {
  icon.classList.add("selected");
  selectedIcons.add(icon);
}

document.querySelector(".desktop").addEventListener("mousedown", (e) => {
  closeContextMenu();

  const icon = e.target.closest(".desktop-icon");
  if (icon) {
    if (!e.shiftKey) clearIconSelection();
    selectIcon(icon);

    iconDrag = {
      el: icon,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: icon.offsetLeft,
      origTop:  icon.offsetTop,
      moved: false,
    };
    e.preventDefault();
    return;
  }

  clearIconSelection();
  const desktop = document.querySelector(".desktop");
  const rect = desktop.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const selEl = document.createElement("div");
  selEl.className = "selection-rect";
  selEl.style.left   = sx + "px";
  selEl.style.top    = sy + "px";
  selEl.style.width  = "0px";
  selEl.style.height = "0px";
  desktop.appendChild(selEl);

  selRect = { startX: sx, startY: sy, el: selEl };
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (drag && drag.isWindow) {
    const x = Math.max(0, Math.min(e.clientX - drag.startX, window.innerWidth  - drag.el.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - drag.startY, window.innerHeight - drag.el.offsetHeight - 34));
    drag.el.style.left = x + "px";
    drag.el.style.top  = y + "px";
    return;
  }

  if (iconDrag) {
    const dx = e.clientX - iconDrag.startX;
    const dy = e.clientY - iconDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) iconDrag.moved = true;
    if (iconDrag.moved) {
      const desktop = document.querySelector(".desktop");
      const dr = desktop.getBoundingClientRect();
      const newLeft = Math.max(0, Math.min(iconDrag.origLeft + dx, dr.width  - iconDrag.el.offsetWidth));
      const newTop  = Math.max(0, Math.min(iconDrag.origTop  + dy, dr.height - iconDrag.el.offsetHeight));
      iconDrag.el.style.position = "absolute";
      iconDrag.el.style.left = newLeft + "px";
      iconDrag.el.style.top  = newTop  + "px";
    }
    return;
  }

  if (selRect) {
    const desktop = document.querySelector(".desktop");
    const dr = desktop.getBoundingClientRect();
    const cx = e.clientX - dr.left;
    const cy = e.clientY - dr.top;
    const x1 = Math.min(selRect.startX, cx);
    const y1 = Math.min(selRect.startY, cy);
    const x2 = Math.max(selRect.startX, cx);
    const y2 = Math.max(selRect.startY, cy);
    selRect.el.style.left   = x1 + "px";
    selRect.el.style.top    = y1 + "px";
    selRect.el.style.width  = (x2 - x1) + "px";
    selRect.el.style.height = (y2 - y1) + "px";

    clearIconSelection();
    document.querySelectorAll(".desktop-icon").forEach((icon) => {
      const ir = icon.getBoundingClientRect();
      const ix1 = ir.left - dr.left; const iy1 = ir.top - dr.top;
      const ix2 = ir.right - dr.left; const iy2 = ir.bottom - dr.top;
      if (ix2 > x1 && ix1 < x2 && iy2 > y1 && iy1 < y2) selectIcon(icon);
    });
  }
});

document.addEventListener("mouseup", (e) => {
  if (iconDrag) {
    if (iconDrag.moved) saveIconPositions();
    iconDrag = null;
  }
  if (selRect) {
    selRect.el.remove();
    selRect = null;
  }
  drag = null;
});

document.querySelector(".desktop").addEventListener("dblclick", (e) => {
  const icon = e.target.closest(".desktop-icon");
  if (!icon) return;
  const action = icon.dataset.action;
  if (action) eval(action);
});

// ─── Context Menu ─────────────────────────────────────────────────────────────
const contextMenu = document.getElementById("context-menu");

document.querySelector(".desktop").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".desktop-icon")) return;
  e.preventDefault();
  closeContextMenu();
  contextMenu.style.left    = e.clientX + "px";
  contextMenu.style.top     = e.clientY + "px";
  contextMenu.style.display = "block";
});

document.addEventListener("click", (e) => {
  if (!e.target.closest("#context-menu")) closeContextMenu();
});

document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest(".desktop") && !e.target.closest("#context-menu")) closeContextMenu();
});

function closeContextMenu() {
  if (contextMenu) contextMenu.style.display = "none";
}

// ─── Wallpaper ────────────────────────────────────────────────────────────────
const WALLPAPER_KEY   = "luizos_wallpaper";
const CUSTOM_COLOR_KEY = "luizos_custom_color";
const WALLPAPERS = {
  padrao:      { label: "Padrão",       type: "color", value: "#008080" },
  windows:     { label: "Windows",      type: "image", value: "/wallpapers/windows.png" },
  michaelsoft: { label: "Michaelsoft",  type: "image", value: "/wallpapers/michaelsoft.png" },
  luiz:        { label: "Luiz",         type: "image", value: "/wallpapers/luiz.png" },
  custom:      { label: "Personalizado",type: "color", value: "#008080" },
};

function applyWallpaper(key) {
  const wp = WALLPAPERS[key];
  if (!wp) return;
  const desktop = document.querySelector(".desktop");
  if (wp.type === "color") {
    document.body.style.background = wp.value;
    desktop.style.backgroundImage = "none";
  } else {
    document.body.style.background = "#000";
    desktop.style.backgroundImage  = `url('${wp.value}')`;
    desktop.style.backgroundSize   = "cover";
    desktop.style.backgroundPosition = "center";
  }
  localStorage.setItem(WALLPAPER_KEY, key);
  document.querySelectorAll(".ctx-wallpaper-item").forEach((el) => {
    el.classList.toggle("checked", el.dataset.wp === key);
  });
  closeContextMenu();
}

function loadWallpaper() {
  const saved = localStorage.getItem(WALLPAPER_KEY) || "padrao";
  if (saved === "custom") {
    const customColor = localStorage.getItem(CUSTOM_COLOR_KEY) || "#008080";
    WALLPAPERS.custom.value = customColor;
  }
  applyWallpaper(saved);
}

function openCustomColorPicker() {
  const colorInput = document.getElementById("custom-color-input");
  const savedColor = localStorage.getItem(CUSTOM_COLOR_KEY) || "#008080";
  colorInput.value = savedColor;
  colorInput.click();
}

function applyCustomColor() {
  const colorInput = document.getElementById("custom-color-input");
  const color = colorInput.value;
  WALLPAPERS.custom.value = color;
  localStorage.setItem(CUSTOM_COLOR_KEY, color);
  applyWallpaper("custom");
}

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

// ─── Login System ─────────────────────────────────────────────────────────────
const SESSION_KEY = "luizos_session";

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
}

function loadSession() {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function updateUserDisplay() {
  const nameEl = document.getElementById("current-user-name");
  const logoutBtn = document.getElementById("taskbar-logout");
  if (currentUser) {
    nameEl.textContent = `👤 ${currentUser.name}`;
    logoutBtn.style.display = "inline-block";
  } else {
    nameEl.textContent = "👤 Visitante";
    logoutBtn.style.display = "none";
  }
}

function logout() {
  currentUser = null;
  clearSession();
  updateUserDisplay();
  // Show login window again
  openWindow("win-login");
}

async function doLogin() {
  const name     = document.getElementById("login-name-select").value;
  const password = document.getElementById("login-password").value;
  const msg      = document.getElementById("login-msg");

  if (!name || !password) {
    showMsg(msg, "Selecione seu nome e digite a senha.", "err");
    return;
  }

  showLoading("Autenticando...");
  try {
    const res  = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (res.ok) {
      currentUser = { name: data.name, password, photo: data.photo, isHCM: data.isHCM };
      saveSession(currentUser);
      updateUserDisplay();
      closeWindow("win-login");
      showMsg(msg, "", "ok");
      document.getElementById("login-password").value = "";
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function continueAsGuest() {
  currentUser = null;
  updateUserDisplay();
  closeWindow("win-login");
}

// ─── Load Users ───────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const res = await fetch(`${API}/users`);
    allUsers = await res.json();

    // Populate login select
    const loginSel = document.getElementById("login-name-select");
    if (loginSel) {
      loginSel.innerHTML = '<option value="">-- Selecione --</option>';
      allUsers.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.name;
        opt.textContent = u.name;
        loginSel.appendChild(opt);
      });
    }

    // Populate guess select (kept for compatibility, hidden behind login now)
    const guessSel = document.getElementById("guess-user-select");
    if (guessSel) {
      guessSel.innerHTML = '<option value="">-- Selecione --</option>';
      allUsers.forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.name;
        opt.textContent = u.name;
        guessSel.appendChild(opt);
      });
    }
  } catch (e) { console.error("loadUsers", e); }
}

// ─── Today Status (with fresh fetch to prevent stale re-guess) ────────────────
async function fetchTodayFresh() {
  const params = currentUser
    ? `?viewer=${encodeURIComponent(currentUser.name)}&password=${encodeURIComponent(currentUser.password)}`
    : "";
  const res  = await fetch(`${API}/today${params}`);
  const data = await res.json();
  todayStatusCache = { data, ts: Date.now() };
  return { res, data };
}

async function refreshTodayStatus() {
  const banner  = document.getElementById("guess-status-banner");
  const loading = document.getElementById("guess-loading");

  setGuessFormOpen(false);
  if (loading) { loading.textContent = "⏳ Verificando..."; loading.style.display = "block"; }

  try {
    const { res, data } = await fetchTodayFresh();
    const bettingOpen = Boolean(res.ok && data.bettingOpen);
    const currentTime = data.currentTime || getBrasiliaTime();

    if (data.arrival) {
      banner.textContent = `⛔ Luiz chegou às ${data.arrival}! Apostas encerradas.`;
      banner.className   = "win95-status-bar show closed";
    } else if (!bettingOpen) {
      banner.textContent = `⛔ Apostas encerradas (passou das 10h). Horário: ${currentTime}.`;
      banner.className   = "win95-status-bar show closed";
    } else {
      banner.textContent = `✅ Apostas abertas! Horário atual: ${currentTime}.`;
      banner.className   = "win95-status-bar show open";
    }

    // Show user info panel if logged in
    const userInfoEl  = document.getElementById("guess-user-info");
    const userNameEl  = document.getElementById("guess-user-name");
    if (userInfoEl) userInfoEl.style.display = currentUser ? "block" : "none";
    if (userNameEl && currentUser) userNameEl.textContent = `👤 ${currentUser.name}`;

    // Prefill hidden select and photo
    if (currentUser) {
      const sel = document.getElementById("guess-user-select");
      if (sel) sel.value = currentUser.name;
      loadUserPhoto();
    }

    // Handle logged-in user state
    if (!currentUser) {
      // Not logged in — show prompt
      const msg = document.getElementById("guess-msg");
      showMsg(msg, "⚠️ Faça login para apostar.", "err");
      setGuessFormOpen(false);
    } else if (data.viewerHasGuessed && bettingOpen) {
      const msg = document.getElementById("guess-msg");
      showMsg(msg, `✅ Você já apostou hoje: ${data.viewerGuess.time}. Só 1 palpite por dia!`, "ok");
      setGuessFormOpen(false);
    } else {
      setGuessFormOpen(bettingOpen);
    }
  } catch {
    if (banner) {
      banner.textContent = `⚠️ Erro ao verificar status. Horário: ${getBrasiliaTime()}.`;
      banner.className   = "win95-status-bar show closed";
    }
    setGuessFormOpen(false);
  } finally {
    if (loading) loading.style.display = "none";
  }
}

// Periodically refresh status while win-guess is open (fix stale re-guess bug)
function startTodayPoll() {
  stopTodayPoll();
  todayPollTimer = setInterval(() => {
    const winGuess = document.getElementById("win-guess");
    if (winGuess && winGuess.style.display !== "none" && !minimizedWindows["win-guess"]) {
      refreshTodayStatus();
    }
  }, 30000); // refresh every 30s
}

function stopTodayPoll() {
  if (todayPollTimer) { clearInterval(todayPollTimer); todayPollTimer = null; }
}

function loadUserPhoto() {
  const sel  = document.getElementById("guess-user-select");
  const name = sel ? sel.value : (currentUser ? currentUser.name : "");
  const area = document.getElementById("user-photo-area");
  const img  = document.getElementById("user-photo");
  if (!name) { if (area) area.style.display = "none"; return; }
  const user = allUsers.find((u) => u.name === name);
  if (user && user.photo) {
    img.src     = `/photos/${user.photo}`;
    img.onerror = () => { area.style.display = "none"; };
    img.onload  = () => { area.style.display = "flex"; };
  } else {
    area.style.display = "none";
  }
}

function setGuessFormOpen(isOpen) {
  const timeGroup   = document.getElementById("guess-time-group");
  const submitRow   = document.getElementById("guess-submit-row");
  const timeInput   = document.getElementById("guess-time");
  const timeOptions = document.getElementById("guess-time-options");
  const loading     = document.getElementById("guess-loading");
  const loginHint   = document.getElementById("guess-login-hint");

  if (timeGroup)   timeGroup.style.display   = isOpen ? "flex" : "none";
  if (submitRow)   submitRow.style.display   = isOpen ? "flex" : "none";
  if (timeInput)   timeInput.disabled        = !isOpen;
  if (!isOpen && timeOptions) timeOptions.classList.remove("show");
  if (loading)     loading.style.display     = "none";
  if (loginHint)   loginHint.style.display   = (!currentUser && !isOpen) ? "block" : "none";
}

function setGuessTime(time) {
  const input   = document.getElementById("guess-time");
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
  const input   = document.getElementById("guess-time");
  const options = document.getElementById("guess-time-options");
  if (!input || input.disabled || !options) return;
  normalizeGuessTime();
  options.classList.toggle("show");
}

async function submitGuess() {
  if (!currentUser) {
    openWindow("win-login");
    return;
  }

  normalizeGuessTime();
  // Always re-fetch status to prevent stale re-guess (bug #6)
  const { res: checkRes, data: checkData } = await fetchTodayFresh();
  if (checkData.viewerHasGuessed) {
    const msg = document.getElementById("guess-msg");
    showMsg(msg, `❌ Você já apostou hoje: ${checkData.viewerGuess.time}. Só 1 palpite por dia!`, "err");
    setGuessFormOpen(false);
    return;
  }
  if (!checkData.bettingOpen) {
    const msg = document.getElementById("guess-msg");
    showMsg(msg, "❌ Apostas já encerradas.", "err");
    setGuessFormOpen(false);
    return;
  }

  const time     = document.getElementById("guess-time").value;
  const msg      = document.getElementById("guess-msg");

  if (!time) { showMsg(msg, "Selecione um horário.", "err"); return; }

  showLoading("Registrando aposta...");
  try {
    const res  = await fetch(`${API}/guess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentUser.name, password: currentUser.password, time }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Aposta registrada! Você apostou ${time}.`, "ok");
      setGuessFormOpen(false);
      todayStatusCache = null; // Invalidate cache
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      // Re-check status in case server says already guessed
      if (res.status === 409) {
        await refreshTodayStatus();
      }
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Today Window ─────────────────────────────────────────────────────────────
async function loadToday() {
  const container = document.getElementById("today-content");
  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  showLoading("Carregando apostas de hoje...");
  try {
    const params = currentUser
      ? `?viewer=${encodeURIComponent(currentUser.name)}&password=${encodeURIComponent(currentUser.password)}`
      : "";
    const res  = await fetch(`${API}/today${params}`);
    const data = await res.json();
    let html   = "";

    const [y, m, d] = data.date.split("-");
    html += `<div class="section-label">📅 ${d}/${m}/${y} — Horário atual: ${data.currentTime}</div>`;

    if (data.arrival) {
      html += `<div class="today-arrival-box">🚪 Luiz chegou às <strong>${data.arrival}</strong>!</div>`;
    } else if (!data.bettingOpen) {
      html += `<div class="info-box">⏰ Apostas encerradas. Aguardando chegada do Luiz...</div>`;
    } else {
      html += `<div class="info-box">✅ Apostas abertas até as 10:00 ou até o Luiz chegar.</div>`;
    }

    if (data.arrival && data.rankings && data.rankings.length > 0) {
      html += `<div class="section-label" style="margin-top:8px">🏆 Resultado do Dia</div>`;
      html += renderRankingsTable(data.rankings, data.arrival);
    } else if (!data.arrival && (data.guesses.length > 0 || data.hiddenCount > 0)) {
      const total = data.guesses.length + (data.hiddenCount || 0);
      html += `<div class="section-label" style="margin-top:8px">🎯 Apostas registradas</div>`;
      html += `<div class="info-box">🔒 ${total} aposta${total !== 1 ? "s" : ""} registrada${total !== 1 ? "s" : ""}. Os palpites ficam ocultos até o Luiz chegar.</div>`;
    } else if (!data.arrival) {
      html += `<div class="no-data">Nenhuma aposta ainda hoje.</div>`;
    }

    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally { hideLoading(); }
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const container = document.getElementById("history-content");
  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  showLoading("Carregando histórico...");
  try {
    const res  = await fetch(`${API}/history`);
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
            ${day.rankings.length > 0
              ? renderRankingsTable(day.rankings, day.arrival)
              : '<div class="no-data">Sem apostas.</div>'}
          </div>
        </div>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally { hideLoading(); }
}

function toggleHistory(header) {
  const body   = header.nextElementSibling;
  const isOpen = body.classList.contains("open");
  body.classList.toggle("open", !isOpen);
  header.querySelector("span:last-child").textContent = isOpen ? "▼" : "▲";
}

// ─── Overall Rank (with HCM tabs) ────────────────────────────────────────────
let overallRankData = [];
let activeRankTab   = "all";

async function loadOverallRank() {
  const container = document.getElementById("rank-content");
  container.innerHTML = '<div class="loading">⏳ Calculando ranking...</div>';
  showLoading("Calculando ranking...");
  try {
    const res   = await fetch(`${API}/overall-rank`);
    overallRankData = await res.json();
    renderRankTab(activeRankTab);
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally { hideLoading(); }
}

function switchRankTab(tab) {
  activeRankTab = tab;
  document.querySelectorAll(".rank-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  renderRankTab(tab);
}

function renderRankTab(tab) {
  // Prefer the dedicated table container, but fall back to the main rank-content
  // so the UI updates even if the inner container isn't present in the DOM.
  const container = document.getElementById("rank-table-container") || document.getElementById("rank-content");
  if (!container) return;

  const ranks = tab === "hcm"
    ? overallRankData.filter((r) => r.isHCM)
    : overallRankData;

  if (ranks.length === 0) {
    container.innerHTML = '<div class="no-data">Nenhum dado disponível ainda.</div>';
    return;
  }

  let html = `<table class="win95-table"><thead><tr>
    <th>#</th><th>Nome</th><th>Pts</th><th>🥇</th><th>Dias</th><th>Erro médio</th>
  </tr></thead><tbody>`;
  ranks.forEach((r, i) => {
    const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
    const hcmBadge   = r.isHCM ? ' <span class="hcm-badge">HCM</span>' : "";
    html += `<tr class="${medalClass}">
      <td>${i + 1}º</td>
      <td>${escHtml(r.name)}${hcmBadge}</td>
      <td><strong>${r.points}</strong></td>
      <td>${r.wins}</td>
      <td>${r.days}</td>
      <td>${formatMinutes(r.avgDiffMins)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  html += `<div class="info-box" style="margin-top:8px">Pontos: 1º lugar recebe N pts, 2º N-1, etc. Erro médio = diferença média entre chute e chegada real.</div>`;
  container.innerHTML = html;
}

// ─── Register ─────────────────────────────────────────────────────────────────
async function registerUser() {
  const name     = document.getElementById("reg-name").value.trim();
  const password = document.getElementById("reg-password").value;
  const msg      = document.getElementById("reg-msg");
  if (!name || !password) { showMsg(msg, "Preencha nome e senha.", "err"); return; }
  showLoading("Criando usuário...");
  try {
    const res  = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Usuário "${name}" criado! Faça login para apostar.`, "ok");
      document.getElementById("reg-name").value     = "";
      document.getElementById("reg-password").value = "";
      loadUsers();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch { showMsg(msg, "Erro de conexão.", "err"); }
  finally { hideLoading(); }
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const pwd = document.getElementById("admin-password").value;
  const msg = document.getElementById("admin-login-msg");
  if (!pwd) { showMsg(msg, "Digite a senha.", "err"); return; }
  showLoading("Verificando senha...");
  try {
    const res  = await fetch(`${API}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    if (res.ok) {
      adminPassword = pwd;
      document.getElementById("admin-login-panel").style.display = "none";
      document.getElementById("admin-panel").style.display       = "block";
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch { showMsg(msg, "Erro de conexão.", "err"); }
  finally { hideLoading(); }
}

async function setArrival() {
  const time = document.getElementById("admin-arrival-time").value;
  const date = document.getElementById("admin-date").value || undefined;
  const msg  = document.getElementById("admin-msg");
  if (!time) { showMsg(msg, "Informe o horário.", "err"); return; }
  showLoading("Registrando chegada...");
  try {
    const body = { password: adminPassword, time };
    if (date) body.date = date;
    const res  = await fetch(`${API}/admin/arrival`, {
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
      todayStatusCache = null; // invalidate cache
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      if (res.status === 401) {
        adminPassword = "";
        document.getElementById("admin-login-panel").style.display = "block";
        document.getElementById("admin-panel").style.display       = "none";
        showMsg(document.getElementById("admin-login-msg"), "Senha incorreta.", "err");
      }
    }
  } catch { showMsg(msg, "Erro de conexão.", "err"); }
  finally { hideLoading(); }
}

// ─── Game Ranking ─────────────────────────────────────────────────────────────
let activeGameRankTab = "snake";

async function openGameRank(game, difficulty) {
  activeGameRankTab = game;
  openWindow("win-gamerank");
  await loadGameRank(game, difficulty);
}

async function loadGameRank(game, difficulty) {
  const container = document.getElementById("gamerank-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">⏳ Carregando ranking...</div>';
  try {
    const params = difficulty ? `?game=${game}&difficulty=${difficulty}` : `?game=${game}`;
    const res    = await fetch(`${API}/game-rank${params}`);
    const scores = await res.json();

    const gameLabel = game === "snake" ? "🐍 Snake 95" : "💣 Campo Minado";
    const diffLabel = difficulty ? ` — ${getDifficultyLabel(difficulty)}` : "";
    let html = `<div class="section-label">${gameLabel}${diffLabel} — Top 10</div>`;

    if (scores.length === 0) {
      html += '<div class="no-data">Nenhum recorde ainda. Seja o primeiro!</div>';
    } else {
      html += `<table class="win95-table"><thead><tr>
        <th>#</th><th>Jogador</th><th>Pontuação</th><th>Data</th>
      </tr></thead><tbody>`;
      scores.forEach((s, i) => {
        const medal = ["🥇","🥈","🥉"][i] || `${i+1}º`;
        const date  = new Date(s.date).toLocaleDateString("pt-BR");
        const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
        html += `<tr class="${medalClass}"><td>${medal}</td><td>${escHtml(s.name)}</td><td><strong>${s.score}</strong></td><td>${date}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar ranking.</div>';
  }
}

async function submitGameScore(game, difficulty, score, callback) {
  if (!currentUser) return; // Only logged-in users save scores
  try {
    // Check personal best in localStorage first
    const personalKey = difficulty
      ? `luizos_pb_${game}_${difficulty}`
      : `luizos_pb_${game}`;
    const personalBest = parseInt(localStorage.getItem(personalKey) || "0", 10);
    if (score <= personalBest) return; // Not a new personal best

    localStorage.setItem(personalKey, String(score));

    // Submit to API
    const body = { game, playerName: currentUser.name, score };
    if (difficulty) body.difficulty = difficulty;
    const res = await fetch(`${API}/game-rank`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (callback) callback(data.coinsEarned || 0);
  } catch (e) {
    console.error("submitGameScore", e);
  }
}

function getPersonalBest(game, difficulty) {
  const key = difficulty ? `luizos_pb_${game}_${difficulty}` : `luizos_pb_${game}`;
  return parseInt(localStorage.getItem(key) || "0", 10);
}

function getDifficultyLabel(diff) {
  return { beginner: "Iniciante", intermediate: "Intermediário", expert: "Especialista" }[diff] || diff;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showMsg(el, text, type) {
  el.textContent = text;
  el.className   = `win95-msg ${type}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 6000);
}

function getBrasiliaTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const brt = new Date(utc - 3 * 3600000);
  return `${String(brt.getHours()).padStart(2,"0")}:${String(brt.getMinutes()).padStart(2,"0")}`;
}

function timeToMinutes(value) {
  const raw = String(value).trim();
  let hours, minutes;
  if (raw.includes(":")) {
    const [h, m = "0"] = raw.split(":");
    hours = Number(h); minutes = Number(m);
  } else {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return 9 * 60;
    if (digits.length <= 2) { hours = Number(digits); minutes = 0; }
    else { hours = Number(digits.slice(0, -2)); minutes = Number(digits.slice(-2)); }
  }
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 9 * 60;
  return hours * 60 + Math.max(0, Math.min(59, minutes));
}

function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

function clampMinutes(minutes) { return Math.max(6 * 60, Math.min(13 * 60, minutes)); }
function clampTime(value) { return minutesToTime(clampMinutes(timeToMinutes(value))); }

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
  return `${h}h${String(m).padStart(2,"0")}m`;
}

function renderRankingsTable(rankings, arrival) {
  let html = `<table class="win95-table"><thead><tr>
    <th>#</th><th>Nome</th><th>Chute</th>${arrival ? "<th>Diferença</th>" : ""}
  </tr></thead><tbody>`;
  const medals = ["🥇","🥈","🥉"];
  rankings.forEach((r) => {
    const medal   = medals[r.position - 1] || `${r.position}º`;
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

// ─── Init ─────────────────────────────────────────────────────────────────────
captureDefaultIconPositions();
loadUsers().then(() => {
  // Restore session
  const saved = loadSession();
  if (saved) {
    currentUser = saved;
    updateUserDisplay();
    refreshTodayStatus();
    // Don't show login window if already logged in
  } else {
    updateUserDisplay();
    // Show login window on startup
    openWindow("win-login");
  }
});

// Keep guess window in sync
setInterval(refreshTodayStatus, 60000);
startTodayPoll();
updateTaskbar();
loadIconPositions();
loadWallpaper();

// ─── Loja do Luiz ─────────────────────────────────────────────────────────────

async function openStore() {
  if (!currentUser) {
    alert("Você precisa fazer login para acessar a loja e ver suas moedas.");
    openWindow("win-login");
    return;
  }
  openWindow("win-store");
  await loadStore();
}

async function loadStore() {
  const grid = document.getElementById("store-items");
  const balanceEl = document.getElementById("store-balance");
  
  grid.innerHTML = '<div class="loading">⏳ Carregando prêmios...</div>';
  
  try {
    const params = `?viewer=${encodeURIComponent(currentUser.name)}&password=${encodeURIComponent(currentUser.password)}`;
    const res = await fetch(`${API}/store${params}`);
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error);

    balanceEl.textContent = data.balance;

    if (data.items.length === 0) {
      grid.innerHTML = '<div class="no-data">A loja está vazia no momento.</div>';
      return;
    }

    let html = "";
    data.items.forEach(item => {
      const isUnlocked = data.purchases.includes(item.id);
      const itemClass = isUnlocked ? "store-item unlocked" : "store-item locked";
      // Se não comprou, mostramos um placeholder visual.
      const imgSrc = isUnlocked ? item.src : "/photos/luizCoinIcon.png"; 

      html += `
        <div class="${itemClass}">
          <div class="store-item-title">${escHtml(item.title)}</div>
          <img src="${imgSrc}" class="store-item-preview" draggable="false" />
          
          ${!isUnlocked ? `
            <div class="store-item-price">
               <img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}
            </div>
            <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${data.balance})">Comprar</button>
          ` : `
            <div class="store-item-price" style="color:#006400">✅ Seu</div>
            <button class="win95-action-btn" onclick="openGallery('${item.id}', '${item.src}', '${escHtml(item.title)}')">Abrir</button>
          `}
        </div>`;
    });
    
    grid.innerHTML = html;
  } catch (e) {
    grid.innerHTML = `<div class="win95-msg err">Erro ao carregar loja: ${e.message}</div>`;
  }
}

async function buyStoreItem(itemId, price, currentBalance) {
  if (currentBalance < price) {
    alert("Você não tem LuizCoins™ suficientes para comprar este item!");
    return;
  }
  if (!confirm(`Tem certeza que deseja gastar ${price} LuizCoins™ para comprar esse item?`)) return;

  showLoading("Processando compra...");
  try {
    const res = await fetch(`${API}/store/buy`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: currentUser.name, password: currentUser.password, itemId })
    });
    const data = await res.json();
    
    if (res.ok) {
      // Compra feita com sucesso, recarrega a janela da loja
      await loadStore();
    } else {
      alert(`❌ Erro: ${data.error}`);
    }
  } catch (e) {
    alert("Erro de conexão.");
  } finally {
    hideLoading();
  }
}

function openGallery(id, src, title) {
  document.getElementById("gallery-title").textContent = `🖼️ Visualizador - ${title}`;
  document.getElementById("gallery-img").src = src;
  
  const btn = document.getElementById("gallery-download-btn");
  btn.onclick = () => {
    // Força o download da imagem via JS
    const a = document.createElement("a");
    a.href = src;
    a.download = `Luiz_Meme_${id}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  
  openWindow("win-gallery");
}
