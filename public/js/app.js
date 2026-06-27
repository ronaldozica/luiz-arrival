/* ═══════════════════════════════════════
   LuizOS 95 — app.js  (v3 — secure)
═══════════════════════════════════════ */

const API = "/api";

// ─── State ────────────────────────────────────────────────────────────────────
let adminToken = "";      // token de sessão de admin (em memória, não persistido)
let allUsers = [];
let currentUser = null;   // { name, isHCM } — sem senha
let sessionToken = null;  // token JWT-like retornado pelo servidor
let todayStatusCache = null;

const windows = {
  "win-login": "🔑 Login",
  "win-guess": "🎯 Aposta",
  "win-today": "📋 Hoje",
  "win-history": "📅 Histórico",
  "win-rank": "🏆 Ranking",
  "win-register": "👤 Cadastro",
  "win-admin": "🔒 Admin",
  "win-gamerank": "🎮 Rank Jogos",
  "win-store": "🛒 Loja",
  "win-achievements": "🏅 Conquistas",
};

// ─── Helpers de autenticação ─────────────────────────────────────────────────
// O token de sessão é armazenado apenas em memória (não no localStorage).
// Isso evita que a senha viaje em toda requisição e protege contra XSS básico.

function authHeaders(token) {
  const authToken = token || sessionToken;
  if (!authToken) return { "Content-Type": "application/json" };
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${authToken}`,
  };
}

function authParams() {
  // Para rotas GET que precisam de autenticação, passa o token como header
  // via fetch com credentials. Não há mais password em query string.
  return sessionToken ? { headers: { "Authorization": `Bearer ${sessionToken}` } } : {};
}

// ─── Cache local de leituras (localStorage) ──────────────────────────────────
// Reduz comandos de leitura no Redis: dados que não mudam a cada segundo
// (ranking, histórico, perfis, rank de jogos) ficam guardados no navegador por
// um curto período. O backend já invalida seu próprio cache quando os dados
// de origem mudam, então um TTL curto aqui só evita refetch ao reabrir a
// mesma janela repetidamente.
const CACHE_PREFIX = "luizos_cache_";

function cacheGet(key, maxAgeMs) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > maxAgeMs) return null;
    return data;
  } catch {
    return null;
  }
}

function cacheSet(key, data) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
}

async function cachedFetchJSON(key, url, maxAgeMs, options) {
  const cached = cacheGet(key, maxAgeMs);
  if (cached !== null) return cached;
  const res = await fetch(url, options);
  const data = await res.json();
  if (res.ok) cacheSet(key, data);
  return data;
}

const CACHE_TTL_MS = 60 * 1000;

function invalidateProfileCache() {
  try { localStorage.removeItem(CACHE_PREFIX + "profiles"); } catch {}
}

// ─── Decorations toggle ──────────────────────────────────────────────────────
const SHOW_DECORATIONS_KEY = "luizos_show_decorations";
let showDecorations = true;
let userProfiles = {};
let currentGameRankData = [];
let currentGameRankMeta = { game: "snake", difficulty: null };

function loadShowDecorations() {
  try {
    const saved = localStorage.getItem(SHOW_DECORATIONS_KEY);
    if (saved !== null) showDecorations = saved === "true";
  } catch {}
}

function saveShowDecorations() {
  try {
    localStorage.setItem(SHOW_DECORATIONS_KEY, String(showDecorations));
  } catch {}
}

function syncDecorationsCheckboxes() {
  document.querySelectorAll("#rank-decorations-checkbox, .rank-decorations-checkbox").forEach((checkbox) => {
    checkbox.checked = showDecorations;
  });
}

async function loadProfiles() {
  try {
    const data = await cachedFetchJSON("profiles", `${API}/profiles`, CACHE_TTL_MS);
    if (data) userProfiles = data;
  } catch {}
}

function renderPlayerName(name, includeAchievement) {
  const profile = userProfiles[name] || {};
  let style = "";
  let colorClass = "";
  if (showDecorations && profile.nameColor) {
    colorClass = getColorClass(profile.nameColor.id);
    if (!colorClass) {
      style = `style="color:${profile.nameColor.color};${getColorEffect(profile.nameColor.id)}"`;
    }
  }
  const achievementBadge =
    showDecorations && includeAchievement && profile.achievement
      ? `<span class="achievement-badge" title="${escHtml(profile.achievement.title)}">${profile.achievement.icon}</span>`
      : "";
  const emojiPrefix = showDecorations && profile.emoji ? `<span class="profile-emoji-badge">${profile.emoji}</span> ` : "";
  return `${emojiPrefix}<span class="${colorClass}" ${style}>${escHtml(name)}</span>${achievementBadge}`;
}

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
  if (id === "win-store") { loadStore(); loadProfileEmoji(); }
  if (id === "win-achievements") loadAchievements();
  if (id === "win-scoring-rules") renderScoringRules();
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

document.querySelectorAll(".win95-window").forEach((w) => {
  w.addEventListener("mousedown", () => bringToFront(w));
});

function updateTaskbar() {
  const bar = document.getElementById("taskbar-apps");
  bar.innerHTML = "";
  const windows = {
    "win-login": "🔑 Login",
    "win-guess": "🎯 Aposta",
    "win-today": "📋 Hoje",
    "win-history": "📅 Histórico",
    "win-rank": "🏆 Ranking",
    "win-register": "👤 Cadastro",
    "win-admin": "🔒 Admin",
    "win-gamerank": "🎮 Rank Jogos",
    "win-achievements": "🏅 Conquistas",
    "win-profile": "🧑‍🎨 Perfil",
    "win-release-notes": "📰 Novidades",
    "win-scoring-rules": "📐 Regras",
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
        else {
          bringToFront(w);
          if (id === "win-store") { loadStore(); loadProfileEmoji(); }
          if (id === "win-profile") loadProfileTabData(currentProfileTab);
        }
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
let iconDrag = null;
let selRect = null;
let selectedIcons = new Set();

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
      icon.style.top = position.top;
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
      origTop: icon.offsetTop,
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
  selEl.style.left = sx + "px";
  selEl.style.top = sy + "px";
  selEl.style.width = "0px";
  selEl.style.height = "0px";
  desktop.appendChild(selEl);

  selRect = { startX: sx, startY: sy, el: selEl };
  e.preventDefault();
});

document.addEventListener("mousemove", (e) => {
  if (drag && drag.isWindow) {
    const x = Math.max(0, Math.min(e.clientX - drag.startX, window.innerWidth - drag.el.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - drag.startY, window.innerHeight - drag.el.offsetHeight - 34));
    drag.el.style.left = x + "px";
    drag.el.style.top = y + "px";
    return;
  }

  if (iconDrag) {
    const dx = e.clientX - iconDrag.startX;
    const dy = e.clientY - iconDrag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) iconDrag.moved = true;
    if (iconDrag.moved) {
      const desktop = document.querySelector(".desktop");
      const dr = desktop.getBoundingClientRect();
      const newLeft = Math.max(0, Math.min(iconDrag.origLeft + dx, dr.width - iconDrag.el.offsetWidth));
      const newTop = Math.max(0, Math.min(iconDrag.origTop + dy, dr.height - iconDrag.el.offsetHeight));
      iconDrag.el.style.position = "absolute";
      iconDrag.el.style.left = newLeft + "px";
      iconDrag.el.style.top = newTop + "px";
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
    selRect.el.style.left = x1 + "px";
    selRect.el.style.top = y1 + "px";
    selRect.el.style.width = x2 - x1 + "px";
    selRect.el.style.height = y2 - y1 + "px";

    clearIconSelection();
    document.querySelectorAll(".desktop-icon").forEach((icon) => {
      const ir = icon.getBoundingClientRect();
      const ix1 = ir.left - dr.left;
      const iy1 = ir.top - dr.top;
      const ix2 = ir.right - dr.left;
      const iy2 = ir.bottom - dr.top;
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
  contextMenu.style.left = e.clientX + "px";
  contextMenu.style.top = e.clientY + "px";
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
const WALLPAPER_KEY = "luizos_wallpaper";
const CUSTOM_COLOR_KEY = "luizos_custom_color";
const WALLPAPERS = {
  padrao: { label: "Padrão", type: "color", value: "#008080" },
  windows: { label: "Windows", type: "image", value: "/wallpapers/windows.png" },
  michaelsoft: { label: "Michaelsoft", type: "image", value: "/wallpapers/michaelsoft.png" },
  luiz: { label: "Luiz", type: "image", value: "/wallpapers/luiz.png" },
  custom: { label: "Personalizado", type: "color", value: "#008080" },
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
    desktop.style.backgroundImage = `url('${wp.value}')`;
    desktop.style.backgroundSize = "cover";
    desktop.style.backgroundPosition = "center";
  }
  localStorage.setItem(WALLPAPER_KEY, key);
  document.querySelectorAll(".ctx-wallpaper-item[data-wp]").forEach((el) => {
    el.classList.toggle("checked", el.dataset.wp === key);
  });
  document.querySelectorAll("#profile-tab-wallpaper [data-wp]").forEach((el) => {
    el.classList.toggle("active", el.dataset.wp === key);
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

// ─── Session (apenas token + nome — sem senha) ────────────────────────────────
const SESSION_KEY = "luizos_session";

function saveSession(user, token) {
  // Salva o token de sessão e os dados do usuário (sem senha)
  localStorage.setItem(SESSION_KEY, JSON.stringify({ user, token }));
}

function loadSession() {
  try {
    const s = localStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
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

async function logout() {
  if (sessionToken) {
    try {
      await fetch(`${API}/logout`, { method: "POST", headers: authHeaders() });
    } catch {}
  }
  currentUser = null;
  sessionToken = null;
  clearSession();
  updateUserDisplay();
  openWindow("win-login");
}

async function doLogin() {
  const name = document.getElementById("login-name-select").value;
  const password = document.getElementById("login-password").value;
  const msg = document.getElementById("login-msg");

  if (!name || !password) {
    showMsg(msg, "Selecione seu nome e digite a senha.", "err");
    return;
  }

  showLoading("Autenticando...");
  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (res.ok) {
      // Armazena o token em memória; salva no localStorage apenas nome+token (sem senha)
      sessionToken = data.token;
      currentUser = { name: data.name, isHCM: data.isHCM };
      saveSession(currentUser, sessionToken);
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
  } catch (e) {
    console.error("loadUsers", e);
  }
}

// ─── Today Status ─────────────────────────────────────────────────────────────
async function fetchTodayFresh() {
  const headers = sessionToken ? { "Authorization": `Bearer ${sessionToken}` } : {};
  const res = await fetch(`${API}/today`, { headers });
  const data = await res.json();
  todayStatusCache = { data, ts: Date.now() };
  return { res, data };
}

async function refreshTodayStatus() {
  const banner = document.getElementById("guess-status-banner");
  const loading = document.getElementById("guess-loading");

  setGuessFormOpen(false);
  if (loading) {
    loading.textContent = "⏳ Verificando...";
    loading.style.display = "block";
  }

  try {
    const { res, data } = await fetchTodayFresh();
    const bettingOpen = Boolean(res.ok && data.bettingOpen);
    const currentTime = data.currentTime || getBrasiliaTime();

    const isNextDay = data.activeBetDate && data.activeBetDate !== data.date;

    if (isNextDay) {
      const [y, m, d] = data.activeBetDate.split("-");
      banner.textContent = `✅ Apostas abertas para o próximo dia útil (${d}/${m})!`;
      banner.className = "win95-status-bar show open";
    } else if (data.arrival) {
      banner.textContent = `⛔ Luiz chegou às ${data.arrival}! Apostas encerradas.`;
      banner.className = "win95-status-bar show closed";
    } else if (!bettingOpen) {
      banner.textContent = `⛔ Apostas encerradas (passou das 10h). Horário: ${currentTime}.`;
      banner.className = "win95-status-bar show closed";
    } else {
      banner.textContent = `✅ Apostas abertas! Horário atual: ${currentTime}.`;
      banner.className = "win95-status-bar show open";
    }

    const userInfoEl = document.getElementById("guess-user-info");
    const userNameEl = document.getElementById("guess-user-name");
    if (userInfoEl) userInfoEl.style.display = currentUser ? "block" : "none";
    if (userNameEl && currentUser) userNameEl.textContent = `👤 ${currentUser.name}`;

    if (currentUser) {
      const sel = document.getElementById("guess-user-select");
      if (sel) sel.value = currentUser.name;
      loadUserPhoto();
    }

    if (!currentUser) {
      const msg = document.getElementById("guess-msg");
      showMsg(msg, "⚠️ Faça login para apostar.", "err");
      setGuessFormOpen(false);
    } else if (data.viewerHasGuessed && bettingOpen) {
      const msg = document.getElementById("guess-msg");
      const dayLabel = isNextDay ? "para o próximo dia" : "hoje";
      showMsg(msg, `✅ Você já apostou ${dayLabel}: ${data.viewerGuess.time}. Só 1 palpite por dia!`, "ok");
      setGuessFormOpen(false);
    } else {
      setGuessFormOpen(bettingOpen);
    }
  } catch {
    if (banner) {
      banner.textContent = `⚠️ Erro ao verificar status. Horário: ${getBrasiliaTime()}.`;
      banner.className = "win95-status-bar show closed";
    }
    setGuessFormOpen(false);
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function loadUserPhoto() {
  const sel = document.getElementById("guess-user-select");
  const name = sel ? sel.value : currentUser ? currentUser.name : "";
  const area = document.getElementById("user-photo-area");
  const img = document.getElementById("user-photo");
  if (!name) {
    if (area) area.style.display = "none";
    return;
  }
  const user = allUsers.find((u) => u.name === name);
  if (user && user.photo) {
    img.src = `/photos/${user.photo}`;
    img.onerror = () => { area.style.display = "none"; };
    img.onload = () => { area.style.display = "flex"; };
  } else {
    area.style.display = "none";
  }
}

function setGuessFormOpen(isOpen) {
  const timeGroup = document.getElementById("guess-time-group");
  const submitRow = document.getElementById("guess-submit-row");
  const timeInput = document.getElementById("guess-time");
  const timeOptions = document.getElementById("guess-time-options");
  const loading = document.getElementById("guess-loading");
  const loginHint = document.getElementById("guess-login-hint");

  if (timeGroup) timeGroup.style.display = isOpen ? "flex" : "none";
  if (submitRow) submitRow.style.display = isOpen ? "flex" : "none";
  if (timeInput) timeInput.disabled = !isOpen;
  if (!isOpen && timeOptions) timeOptions.classList.remove("show");
  if (loading) loading.style.display = "none";
  if (loginHint) loginHint.style.display = !currentUser && !isOpen ? "block" : "none";
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
  if (!currentUser) {
    openWindow("win-login");
    return;
  }

  normalizeGuessTime();
  const { res: checkRes, data: checkData } = await fetchTodayFresh();

  if (checkData.viewerHasGuessed) {
    const msg = document.getElementById("guess-msg");
    const isNextDay = checkData.activeBetDate && checkData.activeBetDate !== checkData.date;
    const dayLabel = isNextDay ? "para o próximo dia" : "hoje";
    showMsg(msg, `❌ Você já apostou ${dayLabel}: ${checkData.viewerGuess.time}. Só 1 palpite por dia!`, "err");
    setGuessFormOpen(false);
    return;
  }

  if (!checkData.bettingOpen) {
    const msg = document.getElementById("guess-msg");
    showMsg(msg, "❌ Apostas já encerradas.", "err");
    setGuessFormOpen(false);
    return;
  }

  const time = document.getElementById("guess-time").value;
  const msg = document.getElementById("guess-msg");

  if (!time) {
    showMsg(msg, "Selecione um horário.", "err");
    return;
  }

  showLoading("Registrando aposta...");
  try {
    // Envia apenas o time — o servidor identifica o usuário pelo token
    const res = await fetch(`${API}/guess`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ time }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Aposta registrada! Você apostou ${time}.`, "ok");
      setGuessFormOpen(false);
      todayStatusCache = null;
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      if (res.status === 409) await refreshTodayStatus();
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

  if (!currentUser) {
    container.innerHTML = `<div class="info-box">🔒 Faça login para ver as apostas.</div>
      <div style="text-align:center;margin-top:12px">
        <button class="win95-action-btn" onclick="openWindow('win-login')">🔑 Fazer Login</button>
      </div>`;
    return;
  }

  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  showLoading("Carregando apostas...");
  try {
    const res = await fetch(`${API}/today`, { headers: sessionToken ? { "Authorization": `Bearer ${sessionToken}` } : {} });
    const data = await res.json();
    let html = "";

    const targetDate = data.displayDate || data.activeBetDate || data.date;
    const isNextDay = targetDate !== data.date;
    const [y, m, d] = targetDate.split("-");

    if (isNextDay) {
      html += `<div class="section-label">📅 Próximo Dia Útil: ${d}/${m}/${y} — Horário atual: ${data.currentTime}</div>`;
    } else {
      html += `<div class="section-label">📅 Hoje: ${d}/${m}/${y} — Horário atual: ${data.currentTime}</div>`;
    }

    if (data.arrival) {
      html += `<div class="today-arrival-box">🚪 Luiz chegou às <strong>${data.arrival}</strong>!</div>`;
    } else if (isNextDay) {
      html += `<div class="info-box">✅ Apostas abertas para o próximo dia útil.</div>`;
    } else {
      const nowMins = timeToMinutes(data.currentTime);
      const cutoffMins = 10 * 60;
      if (nowMins >= cutoffMins) {
        html += `<div class="info-box">⏰ Apostas encerradas. Aguardando chegada do Luiz...</div>`;
      } else {
        html += `<div class="info-box">✅ Apostas abertas até as 10:00 ou até o Luiz chegar.</div>`;
      }
    }

    if (!data.viewerHasGuessed && !data.arrival) {
      html += `<div class="info-box" style="margin-top:8px">⚠️ Você ainda não apostou! Aposte primeiro para ver os palpites dos outros.</div>`;
    }

    if (data.arrival && data.rankings && data.rankings.length > 0) {
      html += `<div class="section-label" style="margin-top:8px">🏆 Resultado do Dia</div>`;
      html += renderRankingsTable(data.rankings, data.arrival);
    } else if (!data.arrival && data.guesses.length > 0) {
      html += `<div class="section-label" style="margin-top:8px">🎯 Sua aposta</div>`;
      html += renderRankingsTable(data.guesses, null);
      if (data.hiddenCount > 0) {
        html += `<div class="info-box" style="margin-top:8px">🔒 Mais ${data.hiddenCount} aposta(s) registrada(s) — os palpites dos outros ficam ocultos até as apostas fecharem.</div>`;
      }
    } else if (!data.arrival && data.hiddenCount > 0) {
      const total = data.hiddenCount;
      html += `<div class="section-label" style="margin-top:8px">🎯 Apostas registradas</div>`;
      html += `<div class="info-box">🔒 Já há ${total} aposta(s) registrada(s). Aposte para ver os palpites dos outros!</div>`;
    } else if (!data.arrival) {
      html += `<div class="no-data">Nenhuma aposta registrada ainda.</div>`;
    }

    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally {
    hideLoading();
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
  const container = document.getElementById("history-content");
  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  showLoading("Carregando histórico...");
  try {
    const days = await cachedFetchJSON("history", `${API}/history`, CACHE_TTL_MS);
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
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally {
    hideLoading();
  }
}

function toggleHistory(header) {
  const body = header.nextElementSibling;
  const isOpen = body.classList.contains("open");
  body.classList.toggle("open", !isOpen);
  header.querySelector("span:last-child").textContent = isOpen ? "▼" : "▲";
}

// ─── Ranking (semana atual / total / anteriores) ─────────────────────────────
let activeRankMainTab = "week";
let activeRankTab = "all";
let weekRankData = null;
let overallRankData = null;
let weeklyHistoryData = null;

// Função chamada ao abrir a janela de ranking (mantida com este nome porque
// já está referenciada no HTML do menu Iniciar / ícone da área de trabalho).
async function loadOverallRank() {
  userProfiles = (await cachedFetchJSON("profiles", `${API}/profiles`, CACHE_TTL_MS)) || {};
  await loadRankMainTab(activeRankMainTab);
}

function switchRankMainTab(tab) {
  activeRankMainTab = tab;
  document.querySelectorAll(".rank-main-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.mainTab === tab);
  });
  const filterTabs = document.getElementById("rank-filter-tabs");
  if (filterTabs) filterTabs.style.display = tab === "previous" ? "none" : "flex";
  loadRankMainTab(tab);
}

async function loadRankMainTab(tab) {
  const container = document.getElementById("rank-content");
  container.innerHTML = '<div class="loading">⏳ Calculando ranking...</div>';
  showLoading("Calculando ranking...");
  try {
    if (tab === "week") {
      weekRankData = await cachedFetchJSON("weekly_rank", `${API}/weekly-rank`, CACHE_TTL_MS);
      renderRankTab(activeRankTab);
    } else if (tab === "total") {
      overallRankData = await cachedFetchJSON("overall_rank", `${API}/overall-rank`, CACHE_TTL_MS);
      renderRankTab(activeRankTab);
    } else {
      weeklyHistoryData = await cachedFetchJSON("weekly_history", `${API}/weekly-history`, CACHE_TTL_MS);
      renderPreviousWeeks();
    }
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar.</div>';
  } finally {
    hideLoading();
  }
}

function toggleDecorations(checked) {
  showDecorations = typeof checked === "boolean" ? checked : !showDecorations;
  saveShowDecorations();
  syncDecorationsCheckboxes();
  if (activeRankMainTab === "previous") renderPreviousWeeks();
  else renderRankTab(activeRankTab);
  if (currentGameRankData.length > 0) renderGameRank();
}

function switchRankTab(tab) {
  activeRankTab = tab;
  document.querySelectorAll(".rank-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === tab);
  });
  renderRankTab(tab);
}

function renderPlayerCell(r) {
  const hcmBadge = r.isHCM ? ' <span class="hcm-badge">HCM</span>' : "";
  const profile = userProfiles[r.name] || {};
  let nameStyle = "";
  let nameColorClass = "";
  if (showDecorations && profile.nameColor) {
    nameColorClass = getColorClass(profile.nameColor.id);
    if (!nameColorClass) {
      nameStyle = `style="color:${profile.nameColor.color};${getColorEffect(profile.nameColor.id)}"`;
    }
  }
  const achBadge =
    showDecorations && profile.achievement
      ? `<span class="achievement-badge" title="${escHtml(profile.achievement.title)}">${profile.achievement.icon}</span>`
      : "";
  const emojiPrefix = showDecorations && profile.emoji ? `<span class="profile-emoji-badge">${profile.emoji}</span> ` : "";
  return `${emojiPrefix}<span class="${nameColorClass}" ${nameStyle}>${escHtml(r.name)}</span>${hcmBadge}${achBadge}`;
}

// Renderiza uma lista de jogadores (já ordenada) numa tabela win95.
// `pointsLabel`/`pointsValue` permitem reaproveitar a mesma tabela tanto para
// a soma semanal quanto para a média diária do ranking total.
function renderRankTable(ranks, { pointsLabel, pointsValue }) {
  let html = `<table class="win95-table"><thead><tr>
    <th>#</th><th>Nome</th><th>${pointsLabel}</th><th>🥇</th><th>Dias</th><th>Erro médio</th>
  </tr></thead><tbody>`;
  ranks.forEach((r, i) => {
    const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
    html += `<tr class="${medalClass}">
      <td>${i + 1}º</td>
      <td>${renderPlayerCell(r)}</td>
      <td><strong>${pointsValue(r)}</strong></td>
      <td>${r.wins}</td>
      <td>${r.days}</td>
      <td>${formatMinutes(r.avgDiffMins)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function renderRankTab(tab) {
  const container =
    document.getElementById("rank-table-container") ||
    document.getElementById("rank-content");
  if (!container) return;

  if (activeRankMainTab === "week") {
    if (!weekRankData) return;
    const ranks = tab === "hcm" ? weekRankData.ranking.filter((r) => r.isHCM) : weekRankData.ranking;
    if (ranks.length === 0) {
      container.innerHTML = '<div class="no-data">Nenhuma aposta resolvida nesta semana ainda.</div>';
      return;
    }
    let html = renderRankTable(ranks, { pointsLabel: "Pts", pointsValue: (r) => r.points });
    html += `<div class="info-box" style="margin-top:8px">Ranking da semana ISO atual (segunda a domingo). Pontos = soma das LuizCoins ganhas por precisão em cada dia.</div>`;
    container.innerHTML = html;
    return;
  }

  // tab === "total"
  if (!overallRankData) return;
  const { ranked, rookies, minDays } = overallRankData;
  const rankedFiltered = tab === "hcm" ? ranked.filter((r) => r.isHCM) : ranked;
  const rookiesFiltered = tab === "hcm" ? rookies.filter((r) => r.isHCM) : rookies;

  if (rankedFiltered.length === 0 && rookiesFiltered.length === 0) {
    container.innerHTML = '<div class="no-data">Nenhum dado disponível ainda.</div>';
    return;
  }

  let html = "";
  if (rankedFiltered.length > 0) {
    html += renderRankTable(rankedFiltered, { pointsLabel: "Média/dia", pointsValue: (r) => r.avgPoints });
  } else {
    html += '<div class="no-data">Ninguém atingiu o mínimo de dias jogados ainda.</div>';
  }
  html += `<div class="info-box" style="margin-top:8px">Ranking total = média de LuizCoins por dia jogado (mínimo de ${minDays} dias). Erro médio = diferença média entre chute e chegada real.</div>`;

  if (rookiesFiltered.length > 0) {
    html += `<div class="section-label" style="margin-top:12px">🌱 Novatos em ascensão (menos de ${minDays} dias jogados)</div>`;
    html += renderRankTable(rookiesFiltered, { pointsLabel: "Média/dia", pointsValue: (r) => r.avgPoints });
  }
  container.innerHTML = html;
}

function renderPreviousWeeks() {
  const container = document.getElementById("rank-content");
  if (!container) return;
  if (!weeklyHistoryData || weeklyHistoryData.length === 0) {
    container.innerHTML = '<div class="no-data">Nenhuma semana anterior registrada ainda.</div>';
    return;
  }
  let html = "";
  weeklyHistoryData.forEach((week) => {
    const [sy, sm, sd] = week.startDate.split("-");
    const [ey, em, ed] = week.endDate.split("-");
    html += `
      <div class="history-day">
        <div class="history-day-header" onclick="toggleHistory(this)">
          <span>🗂️ ${sd}/${sm} a ${ed}/${em}/${ey}</span>
          <span>▼</span>
        </div>
        <div class="history-day-body">
          ${renderRankTable(week.ranking, { pointsLabel: "Pts", pointsValue: (r) => r.points })}
        </div>
      </div>`;
  });
  container.innerHTML = html;
}

function getColorEffect(colorId) {
  switch (colorId) {
    case "color_esmeralda": return "text-shadow: 0 0 6px #00e676, 0 0 12px #00c853; font-weight:bold;";
    case "color_rubi": return "text-shadow: 0 0 6px #ff5252, 0 0 12px #e53935; font-weight:bold;";
    // dourado e diamante usam classes CSS (.name-gold-blink / .name-diamond-shine) em vez de inline style
    default: return "";
  }
}

// Dourado e diamante precisam de classes CSS (animação de piscar / brilho deslizante
// com background-clip:text), o que não é possível via inline style simples.
function getColorClass(colorId) {
  switch (colorId) {
    case "color_dourado": return "name-gold-blink";
    case "color_diamante": return "name-diamond-shine";
    default: return "";
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
  showLoading("Criando usuário...");
  try {
    const res = await fetch(`${API}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, password }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(
        msg,
        `✅ Usuário "${name}" criado! Como compensação pela instabilidade do aplicativo, todos os novos usuários ganham 125 LuizCoins™. Faça login para entrar.`,
        "ok"
      );
      document.getElementById("reg-name").value = "";
      document.getElementById("reg-password").value = "";
      loadUsers();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const pwd = document.getElementById("admin-password").value;
  const msg = document.getElementById("admin-login-msg");
  if (!pwd) {
    showMsg(msg, "Digite a senha.", "err");
    return;
  }
  showLoading("Verificando senha...");
  try {
    const res = await fetch(`${API}/admin/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token; // Armazena o token de admin em memória
      document.getElementById("admin-password").value = ""; // Limpa o campo de senha
      document.getElementById("admin-login-panel").style.display = "none";
      document.getElementById("admin-panel").style.display = "block";
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function setAdminTab(tab) {
  document.querySelectorAll("#win-admin .rank-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.adminTab === tab);
  });
  document.getElementById("admin-tab-arrival").style.display = tab === "arrival" ? "block" : "none";
  document.getElementById("admin-tab-rankcheat").style.display = tab === "rankcheat" ? "block" : "none";
  document.getElementById("admin-tab-tags").style.display = tab === "tags" ? "block" : "none";
  document.getElementById("admin-tab-coins").style.display = tab === "coins" ? "block" : "none";
  if (tab === "coins") loadAdminCoinsPlayers();
}

async function loadAdminCoinsPlayers() {
  const select = document.getElementById("admin-coins-player");
  const msg = document.getElementById("admin-coins-msg");
  try {
    const res = await fetch(`${API}/admin/users`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    const users = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${users.error || "Erro ao carregar."}`, "err");
      handleAdminAuthError(res.status);
      return;
    }
    const previousValue = select.value;
    select.innerHTML = users.map((u) => `<option value="${escHtml(u.name)}">${escHtml(u.name)}</option>`).join("");
    if (previousValue && users.some((u) => u.name === previousValue)) select.value = previousValue;
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  }
}

async function adjustAdminCoins(sign) {
  const name = document.getElementById("admin-coins-player").value;
  const amountInput = document.getElementById("admin-coins-amount");
  const amount = Number(amountInput.value);
  const msg = document.getElementById("admin-coins-msg");

  if (!name) {
    showMsg(msg, "Selecione um jogador.", "err");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    showMsg(msg, "Informe uma quantidade válida (> 0).", "err");
    return;
  }

  showLoading("Atualizando moedas...");
  try {
    const res = await fetch(`${API}/admin/coins/adjust`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ name, amount: amount * sign }),
    });
    const data = await res.json();
    if (res.ok) {
      const verb = sign > 0 ? "adicionadas a" : "removidas de";
      showMsg(msg, `✅ ${amount} moedas ${verb} "${name}". Saldo atual: ${data.gameCoins}.`, "ok");
      amountInput.value = "";
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      handleAdminAuthError(res.status);
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

async function loadAdminTags() {
  const msg = document.getElementById("admin-tags-msg");
  const result = document.getElementById("admin-tags-result");
  showMsg(msg, "", "ok");
  showLoading("Carregando jogadores...");
  try {
    const res = await fetch(`${API}/admin/users`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    const users = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${users.error || "Erro ao carregar."}`, "err");
      handleAdminAuthError(res.status);
      return;
    }
    renderAdminTags(users);
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function renderAdminTags(users) {
  const result = document.getElementById("admin-tags-result");
  if (!users || users.length === 0) {
    result.innerHTML = '<div class="no-data">Nenhum jogador cadastrado.</div>';
    return;
  }
  let html = `<table class="win95-table"><thead><tr>
    <th>Jogador</th><th>HCM</th>
  </tr></thead><tbody>`;
  users.forEach((u) => {
    html += `<tr>
      <td>${u.name}</td>
      <td style="text-align:center">
        <input type="checkbox" ${u.isHCM ? "checked" : ""} onchange="toggleAdminHCM('${String(u.name).replace(/'/g, "\\'")}', this.checked)" />
      </td>
    </tr>`;
  });
  html += "</tbody></table>";
  result.innerHTML = html;
}

async function toggleAdminHCM(name, isHCM) {
  const msg = document.getElementById("admin-tags-msg");
  showLoading("Atualizando tag...");
  try {
    const res = await fetch(`${API}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ name, isHCM }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Tag HCM de "${name}" ${isHCM ? "ativada" : "removida"}.`, "ok");
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      handleAdminAuthError(res.status);
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function onAdminRankGameChange() {
  const game = document.getElementById("admin-rank-game").value;
  document.getElementById("admin-rank-difficulty-group").style.display = game === "minesweeper" ? "block" : "none";
}

function handleAdminAuthError(status, msg) {
  if (status !== 401) return false;
  adminToken = "";
  document.getElementById("admin-login-panel").style.display = "block";
  document.getElementById("admin-panel").style.display = "none";
  showMsg(document.getElementById("admin-login-msg"), "Sessão expirada. Faça login novamente.", "err");
  return true;
}

async function loadAdminRankCheat() {
  const game = document.getElementById("admin-rank-game").value;
  const difficulty = game === "minesweeper" ? document.getElementById("admin-rank-difficulty").value : null;
  const msg = document.getElementById("admin-rankcheat-msg");
  const result = document.getElementById("admin-rankcheat-result");
  showMsg(msg, "", "ok");
  showLoading("Carregando ranking...");
  try {
    const params = difficulty ? `?game=${game}&difficulty=${difficulty}` : `?game=${game}`;
    const res = await fetch(`${API}/game-rank${params}`);
    const scores = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${scores.error || "Erro ao carregar."}`, "err");
      result.innerHTML = "";
      return;
    }
    renderAdminRankCheat(scores, game, difficulty);
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function renderAdminRankCheat(scores, game, difficulty) {
  const result = document.getElementById("admin-rankcheat-result");
  if (!scores || scores.length === 0) {
    result.innerHTML = '<div class="no-data">Nenhum recorde neste ranking.</div>';
    return;
  }
  let html = `<table class="win95-table"><thead><tr>
    <th>Jogador</th><th>Pontuação</th><th>Data</th><th></th>
  </tr></thead><tbody>`;
  scores.forEach((s) => {
    const date = new Date(s.date).toLocaleDateString("pt-BR");
    html += `<tr>
      <td>${s.name}</td>
      <td><strong>${s.score}</strong></td>
      <td>${date}</td>
      <td><button class="win95-action-btn" style="font-size:10px;padding:1px 6px" onclick="deleteAdminRankEntry('${game}', ${difficulty ? `'${difficulty}'` : null}, '${String(s.name).replace(/'/g, "\\'")}')">🗑️</button></td>
    </tr>`;
  });
  html += "</tbody></table>";
  result.innerHTML = html;
}

async function deleteAdminRankEntry(game, difficulty, name) {
  const msg = document.getElementById("admin-rankcheat-msg");
  if (!confirm(`Remover o recorde de "${name}"?`)) return;
  showLoading("Removendo registro...");
  try {
    const res = await fetch(`${API}/admin/game-rank/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ game, difficulty, name }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Recorde de "${name}" removido.`, "ok");
      try { localStorage.removeItem(CACHE_PREFIX + `game_rank_${game}_${difficulty || "default"}`); } catch {}
      renderAdminRankCheat(data.rank, game, difficulty);
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      handleAdminAuthError(res.status);
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

async function setArrival() {
  const time = document.getElementById("admin-arrival-time").value;
  const date = document.getElementById("admin-date").value || undefined;
  const msg = document.getElementById("admin-msg");
  if (!time) {
    showMsg(msg, "Informe o horário.", "err");
    return;
  }
  showLoading("Registrando chegada...");
  try {
    const body = { time };
    if (date) body.date = date;
    const res = await fetch(`${API}/admin/arrival`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Chegada registrada: ${time}`, "ok");
      const result = document.getElementById("admin-result");
      if (data.rankings && data.rankings.length > 0) {
        result.innerHTML = `<div class="section-label">🏆 Resultado</div>` + renderRankingsTable(data.rankings, time);
      }
      todayStatusCache = null;
      try {
        localStorage.removeItem(CACHE_PREFIX + "history");
        localStorage.removeItem(CACHE_PREFIX + "overall_rank");
        localStorage.removeItem(CACHE_PREFIX + "weekly_rank");
        localStorage.removeItem(CACHE_PREFIX + "weekly_history");
      } catch {}
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
      handleAdminAuthError(res.status);
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Game Ranking ─────────────────────────────────────────────────────────────
let activeGameRankTab = "snake";

async function openGameRank(game, difficulty) {
  activeGameRankTab = game;
  currentGameRankMeta = { game, difficulty };
  openWindow("win-gamerank");
  await loadGameRank(game, difficulty);
}

async function loadGameRank(game, difficulty) {
  const container = document.getElementById("gamerank-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">⏳ Carregando ranking...</div>';
  try {
    const params = difficulty ? `?game=${game}&difficulty=${difficulty}` : `?game=${game}`;
    const cacheKey = `game_rank_${game}_${difficulty || "default"}`;
    const scores = await cachedFetchJSON(cacheKey, `${API}/game-rank${params}`, 20 * 1000);
    currentGameRankData = scores;
    currentGameRankMeta = { game, difficulty };

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
        const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}º`;
        const date = new Date(s.date).toLocaleDateString("pt-BR");
        const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
        html += `<tr class="${medalClass}"><td>${medal}</td><td>${renderPlayerName(s.name, true)}</td><td><strong>${s.score}</strong></td><td>${date}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar ranking.</div>';
  }
}

function renderGameRank() {
  const container = document.getElementById("gamerank-content");
  if (!container) return;

  const { game, difficulty } = currentGameRankMeta;
  const gameLabel = game === "snake" ? "🐍 Snake 95" : "💣 Campo Minado";
  const diffLabel = difficulty ? ` — ${getDifficultyLabel(difficulty)}` : "";
  let html = `<div class="section-label">${gameLabel}${diffLabel} — Top 10</div>`;

  if (currentGameRankData.length === 0) {
    html += '<div class="no-data">Nenhum recorde ainda. Seja o primeiro!</div>';
  } else {
    html += `<table class="win95-table"><thead><tr>
      <th>#</th><th>Jogador</th><th>Pontuação</th><th>Data</th>
    </tr></thead><tbody>`;
    currentGameRankData.forEach((s, i) => {
      const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}º`;
      const date = new Date(s.date).toLocaleDateString("pt-BR");
      const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
      html += `<tr class="${medalClass}"><td>${medal}</td><td>${renderPlayerName(s.name, true)}</td><td><strong>${s.score}</strong></td><td>${date}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  container.innerHTML = html;
}

async function submitGameScore(game, difficulty, score, callback, token) {
  const authToken = token || sessionToken;
  if (!currentUser || !authToken) return;
  try {
    const personalKey = difficulty ? `luizos_pb_${game}_${difficulty}` : `luizos_pb_${game}`;
    const personalBest = parseInt(localStorage.getItem(personalKey) || "0", 10);
    const scoreValue = Number(score);
    const isNewBest = scoreValue > personalBest;

    // Não envia playerName — o servidor usa o token de sessão
    const body = { game, score: scoreValue };
    if (difficulty) body.difficulty = difficulty;
    if (!isNewBest) body.skipRank = true;

    const res = await fetch(`${API}/game-rank`, {
      method: "POST",
      headers: authHeaders(authToken),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok && isNewBest) {
      localStorage.setItem(personalKey, String(scoreValue));
    }
    if (callback) callback(data.coinsEarned || 0);

    if (data.newAchievements && data.newAchievements.length > 0) {
      setTimeout(() => showAchievementToast(data.newAchievements), 2500);
    }
  } catch (e) {
    console.error("submitGameScore", e);
  }
}

let gameToastTimeout = null;
function formatCoinValue(coins) {
  const value = Number(coins);
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function showGameCoinsToast(coins) {
  const amount = Number(coins);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const el = document.getElementById("game-toast");
  if (!el) return;
  el.textContent = `+${formatCoinValue(amount)} LuizCoins™`;
  el.style.display = "block";
  el.classList.add("show");
  if (gameToastTimeout) clearTimeout(gameToastTimeout);
  gameToastTimeout = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { el.style.display = "none"; }, 250);
  }, 2200);
}

function getPersonalBest(game, difficulty) {
  const key = difficulty ? `luizos_pb_${game}_${difficulty}` : `luizos_pb_${game}`;
  return parseInt(localStorage.getItem(key) || "0", 10);
}

function getDifficultyLabel(diff) {
  return ({ beginner: "Iniciante", intermediate: "Intermediário", expert: "Especialista" }[diff] || diff);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `win95-msg ${type}`;
  setTimeout(() => { if (el.textContent === text) el.textContent = ""; }, 6000);
}

function getBrasiliaTime() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const brt = new Date(utc - 3 * 3600000);
  return `${String(brt.getHours()).padStart(2, "0")}:${String(brt.getMinutes()).padStart(2, "0")}`;
}

function timeToMinutes(value) {
  const raw = String(value).trim();
  let hours, minutes;
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
  return Math.max(6 * 60, Math.min(13 * 60, minutes));
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
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${String(m).padStart(2, "0")}m`;
}

function renderRankingsTable(rankings, arrival) {
  let html = `<table class="win95-table"><thead><tr>
    <th>#</th><th>Nome</th><th>Chute</th>${arrival ? "<th>Diferença</th>" : ""}
  </tr></thead><tbody>`;
  const medals = ["🥇", "🥈", "🥉"];
  rankings.forEach((r) => {
    const medal = r.position ? medals[r.position - 1] || `${r.position}º` : "—";
    const diffStr = r.diff !== undefined ? formatMinutes(r.diff) : "";
    const invalidatedBadge = r.invalidated
      ? ' <span class="invalidated-badge" title="Aposta feita a menos de 30 min da chegada real — não concorre a precisão nem ao pódio do dia.">⚠️ invalidada</span>'
      : "";
    html += `<tr>
      <td>${medal}</td>
      <td>${renderPlayerName(r.name, false)}${invalidatedBadge}</td>
      <td><strong>${r.time}</strong></td>
      ${arrival ? `<td>${diffStr}</td>` : ""}
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
captureDefaultIconPositions();
loadShowDecorations();
syncDecorationsCheckboxes();
loadProfiles();
loadUsers().then(() => {
  // Restaura sessão: carrega token e dados do usuário (sem senha)
  const saved = loadSession();
  if (saved && saved.token && saved.user) {
    sessionToken = saved.token;
    currentUser = saved.user;
    updateUserDisplay();
    refreshTodayStatus();
  } else {
    updateUserDisplay();
    openWindow("win-login");
  }
});

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
}

async function loadStore() {
  const grid = document.getElementById("store-items");
  const balanceEl = document.getElementById("store-balance");

  grid.innerHTML = '<div class="loading">⏳ Carregando prêmios...</div>';

  try {
    // Autenticação via header Authorization, sem password na URL
    const res = await fetch(`${API}/store`, { headers: sessionToken ? { "Authorization": `Bearer ${sessionToken}` } : {} });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    const safeBalance = Math.max(0, Number(data.balance) || 0);
    balanceEl.textContent = safeBalance;

    if (data.items.length === 0) {
      grid.innerHTML = '<div class="no-data">A loja está vazia no momento.</div>';
      return;
    }

    const mediaItems = data.items.filter((i) => (i.type || "media") === "media");
    const colorItems = data.items.filter((i) => i.type === "namecolor");

    let html = "";

    if (mediaItems.length > 0) {
      html += `<div class="section-label" style="margin-bottom:8px">🖼️ Skins do Luiz</div>`;
      html += `<div class="store-grid">`;
      mediaItems.forEach((item) => {
        const isUnlocked = data.purchases.includes(item.id);
        const itemClass = isUnlocked ? "store-item unlocked" : "store-item locked";
        const imgSrc = isUnlocked ? item.src : "/photos/luizCoinIcon.png";
        html += `
          <div class="${itemClass}">
            <div class="store-item-title">${escHtml(item.title)}</div>
            <img src="${imgSrc}" class="store-item-preview" draggable="false" />
            ${!isUnlocked
              ? `<div class="store-item-price"><img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}</div>
                 <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${safeBalance})">Comprar</button>`
              : `<div class="store-item-price" style="color:#006400">✅ Seu</div>
                 <button class="win95-action-btn" onclick="openGallery('${item.id}', '${item.src}', '${escHtml(item.title)}')">Abrir</button>`
            }
          </div>`;
      });
      html += `</div>`;
    }

    if (colorItems.length > 0) {
      html += `<div class="section-label" style="margin:16px 0 8px">💎 Cores para o nome</div>`;
      html += `<div class="store-color-grid">`;
      colorItems.forEach((item) => {
        const isUnlocked = data.purchases.includes(item.id);
        const effect = getStoreColorEffect(item.id, item.color);
        html += `
          <div class="store-color-item ${isUnlocked ? "unlocked" : "locked"}">
            <div class="store-color-preview" style="${effect}">
              <span style="color:${item.color};${getColorEffect(item.id)}">Seu nome</span>
            </div>
            <div class="store-item-title">${escHtml(item.title)}</div>
            ${!isUnlocked
              ? `<div class="store-item-price"><img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}</div>
                 <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${safeBalance})">Comprar</button>`
              : `<div class="store-item-price" style="color:#006400">✅ Desbloqueado</div>`
            }
          </div>`;
      });
      html += `</div>`;
    }

    grid.innerHTML = html;
  } catch (e) {
    grid.innerHTML = `<div class="win95-msg err">Erro ao carregar loja: ${e.message}</div>`;
  }
}

function getStoreColorEffect(colorId, color) {
  switch (colorId) {
    case "color_esmeralda": return `background: linear-gradient(135deg, #1a2e1a, #0d1f0d); border: 1px solid ${color}; box-shadow: 0 0 12px #00c85344; border-radius:4px; padding:12px; text-align:center;`;
    case "color_rubi": return `background: linear-gradient(135deg, #2e0d0d, #1a0505); border: 1px solid ${color}; box-shadow: 0 0 12px #e5393544; border-radius:4px; padding:12px; text-align:center;`;
    case "color_dourado": return `background: linear-gradient(135deg, #2a2000, #1a1400); border: 1px solid ${color}; box-shadow: 0 0 12px #ffd60044; border-radius:4px; padding:12px; text-align:center;`;
    case "color_diamante": return `background: linear-gradient(135deg, #0d1a2e, #050d1a); border: 1px solid ${color}; box-shadow: 0 0 16px #81d4fa66; border-radius:4px; padding:12px; text-align:center;`;
    default: return `padding:12px; text-align:center;`;
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
    // Sem password no body — autenticação via token
    const res = await fetch(`${API}/store/buy`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ itemId }),
    });
    const data = await res.json();
    if (res.ok) {
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
    const a = document.createElement("a");
    a.href = src;
    a.download = `Luiz_Meme_${id}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  openWindow("win-gallery");
}

// ─── Conquistas (Achievements) ────────────────────────────────────────────────
async function openAchievements() {
  if (!currentUser) {
    alert("Você precisa fazer login para ver suas conquistas.");
    openWindow("win-login");
    return;
  }
  openWindow("win-achievements");
}

let achievementsData = null;

async function loadAchievements() {
  const container = document.getElementById("achievements-content");
  if (!container) return;
  if (!currentUser) {
    container.innerHTML = `<div class="info-box">🔒 Faça login para ver suas conquistas.</div>`;
    return;
  }
  container.innerHTML = '<div class="loading">⏳ Carregando conquistas...</div>';
  try {
    // Autenticação via token no header, sem password na query string
    const res = await fetch(`${API}/achievements`, {
      headers: sessionToken ? { "Authorization": `Bearer ${sessionToken}` } : {},
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    achievementsData = data;
    renderAchievements(data);
  } catch (e) {
    container.innerHTML = `<div class="win95-msg err">Erro: ${e.message}</div>`;
  }
}

function renderAchievements(data) {
  const container = document.getElementById("achievements-content");
  if (!container) return;
  const { definitions, unlocked, active } = data;

  let html = `<div class="section-label">🏅 Suas Conquistas</div>`;
  html += `<div class="achievements-hint">Clique em uma conquista desbloqueada para exibi-la ao lado do seu nome no ranking.</div>`;
  html += `<div class="achievements-grid">`;

  definitions.forEach((def) => {
    const isUnlocked = unlocked.includes(def.id);
    const isActive = active === def.id;
    const cls = isUnlocked ? `achievement-item unlocked${isActive ? " active" : ""}` : "achievement-item locked";
    const onclick = isUnlocked ? `onclick="toggleActiveAchievement('${def.id}')"` : "";
    html += `
      <div class="${cls}" ${onclick} title="${isUnlocked ? (isActive ? "Clique para remover do ranking" : "Clique para exibir no ranking") : "Ainda bloqueada"}">
        <div class="achievement-icon">${isUnlocked ? def.icon : "🔒"}</div>
        <div class="achievement-title">${escHtml(def.title)}</div>
        <div class="achievement-desc">${escHtml(def.description)}</div>
        ${isActive ? '<div class="achievement-active-label">✨ Exibindo no ranking</div>' : ""}
      </div>`;
  });

  html += `</div>`;
  const totalUnlocked = unlocked.length;
  const total = definitions.length;
  html += `<div class="info-box" style="margin-top:12px">Desbloqueadas: ${totalUnlocked}/${total}</div>`;
  container.innerHTML = html;
}

async function toggleActiveAchievement(achievementId) {
  if (!currentUser || !achievementsData) return;
  const isCurrentlyActive = achievementsData.active === achievementId;
  const newActiveId = isCurrentlyActive ? null : achievementId;

  try {
    const res = await fetch(`${API}/achievements/set-active`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ achievementId: newActiveId }),
    });
    const data = await res.json();
    if (res.ok) {
      achievementsData.active = newActiveId;
      renderAchievements(achievementsData);
      invalidateProfileCache();
    } else {
      alert(`❌ ${data.error}`);
    }
  } catch {
    alert("Erro de conexão.");
  }
}

// ─── Perfil (cor, conquista, emoji, papel de parede) ─────────────────────────
let currentProfileTab = "color";
let profileColorData = null;
let profileAchievementData = null;
let profileEmojiData = null;

async function openProfileWindow() {
  if (!currentUser) {
    alert("Você precisa fazer login para personalizar seu perfil.");
    openWindow("win-login");
    return;
  }
  openWindow("win-profile");
  setProfileTab(currentProfileTab);
}

function setProfileTab(tab) {
  currentProfileTab = tab;
  document.querySelectorAll("#win-profile .rank-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.profileTab === tab);
  });
  ["color", "achievement", "emoji", "wallpaper"].forEach((t) => {
    document.getElementById(`profile-tab-${t}`).style.display = t === tab ? "block" : "none";
  });
  loadProfileTabData(tab);
}

function loadProfileTabData(tab) {
  if (tab === "color") loadProfileColor();
  else if (tab === "achievement") loadProfileAchievement();
  else if (tab === "emoji") loadProfileEmoji();
}

async function loadProfileColor() {
  const result = document.getElementById("profile-color-result");
  const msg = document.getElementById("profile-color-msg");
  result.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/store`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    profileColorData = data;
    renderProfileColor();
  } catch (e) {
    showMsg(msg, `Erro: ${e.message}`, "err");
  }
}

function renderProfileColor() {
  const result = document.getElementById("profile-color-result");
  if (!profileColorData) return;
  const ownedColors = profileColorData.items.filter(
    (i) => i.type === "namecolor" && profileColorData.purchases.includes(i.id),
  );
  if (ownedColors.length === 0) {
    result.innerHTML = '<div class="no-data">Você ainda não comprou nenhuma cor. Visite a Loja!</div>';
    return;
  }
  const activeColorId = profileColorData.activeColorId;
  let html = `<div class="btn-row" style="flex-wrap:wrap">`;
  html += `<button class="win95-action-btn${!activeColorId ? " active" : ""}" onclick="selectProfileColor(null)">Padrão</button>`;
  ownedColors.forEach((c) => {
    html += `<button class="win95-action-btn${activeColorId === c.id ? " active" : ""}"
      style="color:${c.color};${getColorEffectPreview(c.id)}"
      onclick="selectProfileColor('${c.id}')">${escHtml(c.title)}</button>`;
  });
  html += `</div>`;
  result.innerHTML = html;
}

function getColorEffectPreview(colorId) {
  switch (colorId) {
    case "color_esmeralda": return "text-shadow:0 0 4px #00e676; font-weight:bold;";
    case "color_rubi": return "text-shadow:0 0 4px #ff5252; font-weight:bold;";
    case "color_dourado": return "font-weight:bold;";
    case "color_diamante": return "font-weight:bold;";
    default: return "";
  }
}

async function selectProfileColor(colorId) {
  const msg = document.getElementById("profile-color-msg");
  showLoading("Atualizando cor...");
  try {
    const res = await fetch(`${API}/profile/color`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ colorId }),
    });
    const data = await res.json();
    if (res.ok) {
      profileColorData.activeColorId = colorId;
      renderProfileColor();
      showMsg(msg, "✅ Cor atualizada.", "ok");
      invalidateProfileCache();
      loadProfiles();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

async function loadProfileAchievement() {
  const result = document.getElementById("profile-achievement-result");
  const msg = document.getElementById("profile-achievement-msg");
  result.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/achievements`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    profileAchievementData = data;
    renderProfileAchievement();
  } catch (e) {
    showMsg(msg, `Erro: ${e.message}`, "err");
  }
}

function renderProfileAchievement() {
  const result = document.getElementById("profile-achievement-result");
  if (!profileAchievementData) return;
  const { definitions, unlocked, active } = profileAchievementData;
  const unlockedDefs = definitions.filter((d) => unlocked.includes(d.id));
  if (unlockedDefs.length === 0) {
    result.innerHTML = '<div class="no-data">Você ainda não desbloqueou nenhuma conquista.</div>';
    return;
  }
  let html = `<div class="btn-row" style="flex-wrap:wrap">`;
  html += `<button class="win95-action-btn${!active ? " active" : ""}" onclick="selectProfileAchievement(null)">Nenhuma</button>`;
  unlockedDefs.forEach((d) => {
    html += `<button class="win95-action-btn${active === d.id ? " active" : ""}"
      onclick="selectProfileAchievement('${d.id}')">${d.icon} ${escHtml(d.title)}</button>`;
  });
  html += `</div>`;
  result.innerHTML = html;
}

async function selectProfileAchievement(achievementId) {
  const msg = document.getElementById("profile-achievement-msg");
  showLoading("Atualizando conquista...");
  try {
    const res = await fetch(`${API}/achievements/set-active`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ achievementId }),
    });
    const data = await res.json();
    if (res.ok) {
      profileAchievementData.active = achievementId;
      renderProfileAchievement();
      showMsg(msg, "✅ Conquista atualizada.", "ok");
      invalidateProfileCache();
      loadProfiles();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

async function loadProfileEmoji() {
  const result = document.getElementById("profile-emoji-owned");
  const msg = document.getElementById("profile-emoji-msg");
  result.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/profile/emoji`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    profileEmojiData = data;
    renderProfileEmoji();
  } catch (e) {
    showMsg(msg, `Erro: ${e.message}`, "err");
  }
}

function renderProfileEmoji() {
  if (!profileEmojiData) return;
  const { owned, active, nextPrice } = profileEmojiData;

  let html;
  if (owned.length === 0) {
    html = `<div class="no-data">Você ainda não comprou nenhum emoji.</div>`;
  } else {
    html = `<div class="info-box" style="margin-bottom:6px">Emojis comprados: ${owned.length} (próximo custa ${nextPrice} LuizCoins)</div>`;
    html += `<div class="btn-row" style="flex-wrap:wrap">`;
    owned.forEach((e) => {
      const isActive = active === e;
      html += `<span class="emoji-owned-item${isActive ? " active" : ""}">
        <button class="win95-action-btn" style="font-size:18px;padding:2px 8px" title="${isActive ? "Exibindo no ranking" : "Clique para exibir no ranking"}"
          onclick="setActiveProfileEmoji('${isActive ? "" : e}')">${e}</button>
      </span>`;
    });
    html += `</div>`;
  }

  ["profile", "store"].forEach((ctx) => {
    const result = document.getElementById(`${ctx}-emoji-owned`);
    const buyBtn = document.getElementById(`${ctx}-emoji-buy-btn`);
    if (result) result.innerHTML = html;
    if (buyBtn) buyBtn.textContent = `🛒 Comprar (${nextPrice} LuizCoins)`;
  });
}

async function setActiveProfileEmoji(emoji) {
  const msg = document.getElementById("profile-emoji-msg");
  showLoading("Atualizando emoji...");
  try {
    const res = await fetch(`${API}/profile/emoji/set-active`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ emoji: emoji || null }),
    });
    const data = await res.json();
    if (res.ok) {
      profileEmojiData.active = emoji || null;
      renderProfileEmoji();
      showMsg(msg, "✅ Emoji atualizado.", "ok");
      invalidateProfileCache();
      loadProfiles();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Seletor de emoji ─────────────────────────────────────────────────────────
const EMOJI_CATEGORIES = {
  "😀 Carinhas": ["😀","😁","😂","🤣","😊","😍","😘","😜","🤔","😎","🥳","😭","😡","🥺","😴","🤯","🤩","😇","🙄","😬","🤗","🥶","🤤","🫡"],
  "🐶 Animais": ["🐶","🐱","🦊","🐻","🐼","🐨","🦁","🐯","🐸","🐵","🐔","🐧","🦄","🐢","🐍","🦈","🐙","🦋","🐝","🦂","🐲","🦖","🐳","🦔"],
  "🍕 Comida": ["🍕","🍔","🌮","🍣","🍩","🍪","🍰","🍫","🍿","🍉","🍎","🍌","🥑","🌶️","🍺","☕","🧃","🍷","🥩","🍦","🍇","🍓","🥨","🍙"],
  "⚽ Atividades": ["⚽","🏀","🏈","🎮","🎲","🎸","🎯","🏆","🥇","🎳","🏓","🥊","🛹","🎤","🎨","🚀","🏁","🎰","🃏","♟️","🎢","🪂","🏄","⛳"],
  "🚗 Viagens": ["🚗","✈️","🚀","🚲","🏖️","🗽","🌋","🏔️","🛸","⛵","🚂","🏰","🗿","🌍","🚁","🛺","🏕️","🎡","🛶","🚤","🚓","🛵","🚆","🌉"],
  "💎 Objetos": ["💎","👑","🔥","⭐","💰","🎁","🔮","🗝️","💣","🧨","🪄","⚔️","🛡️","🎩","👻","🤖","💀","🧿","🪙","📿","🧰","🔱","🏹","🎭"],
  "❤️ Símbolos": ["❤️","💜","💙","💚","🧡","💛","🖤","🤍","💯","✅","❌","⚡","✨","☀️","🌙","🌈","♻️","☢️","☣️","♾️","🔱","🆗","🔰","🎵"],
  "🏳️ Bandeiras": ["🏳️","🏴","🏁","🚩","🏳️‍🌈","🇧🇷","🇺🇸","🇯🇵","🇩🇪","🇫🇷","🇬🇧","🇪🇸","🇮🇹","🇵🇹","🇦🇷","🇨🇦","🇲🇽","🇰🇷","🇨🇳","🇷🇺"],
};
let pickedEmoji = null;
let activeEmojiCategory = Object.keys(EMOJI_CATEGORIES)[0];
let emojiPickerContext = "profile";

function openEmojiPicker(context = "profile") {
  emojiPickerContext = context;
  renderEmojiPickerTabs();
  renderEmojiPickerGrid();
  openWindow("win-emoji-picker");
}

function renderEmojiPickerTabs() {
  const tabs = document.getElementById("emoji-picker-tabs");
  tabs.innerHTML = Object.keys(EMOJI_CATEGORIES)
    .map((cat) => `<button class="rank-tab${cat === activeEmojiCategory ? " active" : ""}" onclick="setEmojiPickerCategory('${cat}')">${cat.split(" ")[0]}</button>`)
    .join("");
}

function setEmojiPickerCategory(cat) {
  activeEmojiCategory = cat;
  renderEmojiPickerTabs();
  renderEmojiPickerGrid();
}

function renderEmojiPickerGrid() {
  const grid = document.getElementById("emoji-picker-grid");
  grid.innerHTML = EMOJI_CATEGORIES[activeEmojiCategory]
    .map((e) => `<button class="emoji-picker-btn" title="${e}" onclick="setPickedEmoji('${e}')">${e}</button>`)
    .join("");
}

function setPickedEmoji(emoji) {
  pickedEmoji = emoji;
  ["profile", "store"].forEach((ctx) => {
    const btn = document.getElementById(`${ctx}-emoji-picked`);
    if (btn) btn.textContent = emoji || "➕";
  });
  if (emoji) closeWindow("win-emoji-picker");
}

async function buyProfileEmoji(context = "profile") {
  const emoji = pickedEmoji;
  const msg = document.getElementById(`${context}-emoji-msg`);
  if (!emoji) {
    showMsg(msg, "Escolha um emoji primeiro.", "err");
    return;
  }
  showLoading("Comprando emoji...");
  try {
    const res = await fetch(`${API}/profile/emoji/buy`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ emoji }),
    });
    const data = await res.json();
    if (res.ok) {
      profileEmojiData.owned = data.owned;
      profileEmojiData.nextPrice = data.nextPrice;
      renderProfileEmoji();
      showMsg(msg, `✅ Emoji ${emoji} comprado por ${data.pricePaid} LuizCoins! O próximo emoji custará ${data.nextPrice} LuizCoins.`, "ok");
      setPickedEmoji(null);
      invalidateProfileCache();
      loadProfiles();
      if (document.getElementById("win-store")?.style.display !== "none") loadStore();
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// Achievement unlock toast
let achToastTimeout = null;
function showAchievementToast(achievementIds) {
  achievementIds.forEach((id, idx) => {
    setTimeout(() => {
      const el = document.getElementById("achievement-toast");
      if (!el) return;

      const def = {
        snake_500: { title: "Serpente Veloz", icon: "🐍" },
        minesweeper_beginner: { title: "Detonador Iniciante", icon: "💣" },
        minesweeper_intermediate: { title: "Detonador Intermediário", icon: "🧨" },
        minesweeper_expert: { title: "Detonador Especialista", icon: "🏆" },
        bet_winner: { title: "Profeta do Luiz", icon: "🔮" },
        novato_em_ascensao: { title: "Novato em Ascensão", icon: "🌱" },
        weekly_champion: { title: "Campeão da Semana", icon: "👑" },
        weekly_top3: { title: "Pódio Semanal", icon: "📈" },
      }[id];

      if (!def) return;

      el.innerHTML = `🎖️ Conquista: <strong>${def.icon} ${def.title}</strong>`;
      el.style.display = "block";
      el.classList.add("show");

      if (achToastTimeout) clearTimeout(achToastTimeout);
      achToastTimeout = setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => { el.style.display = "none"; }, 300);
      }, 3500);
    }, idx * 1000);
  });
}

// ─── Release Notes ────────────────────────────────────────────────────────────
// Sempre que uma feature ou correção for implementada nesta sessão de código,
// adicione um item na entrada de versão atual (ou crie uma nova entrada no topo
// do array, seguindo semver, se a mudança merecer uma versão própria). Cada
// entrada vira automaticamente a tela exibida ao usuário que ainda não viu essa
// versão (ver RELEASE_NOTES_CURRENT_VERSION/checkReleaseNotes abaixo) — não pule
// esta atualização mesmo que não tenha sido pedida explicitamente.
const RELEASE_NOTES_SEEN_KEY = "luizos_release_notes_seen";
const RELEASE_NOTES = [
  {
    version: "1.2.0",
    date: "27/06/2026",
    isNew: true,
    title: "Novo sistema de apostas: precisão, anti-sniping e rankings semanais",
    items: [
      "🎯 Pontuação agora é por precisão absoluta (quão perto você chegou do horário real), não mais por posição relativa aos outros apostadores do dia.",
      "🥇 Empates de horário são desempatados por quem apostou primeiro — sempre há um top 3 definido no dia.",
      "⚠️ Apostas feitas a menos de 30 min do horário real de chegada são marcadas como inválidas para precisão/pódio (suspeita de \"sniping\"), mas ainda contam participação.",
      "📅 Ranking agora tem 3 abas: Semana atual (padrão), Total e Anteriores (histórico de semanas passadas).",
      "🌐 Ranking total passou a usar média de LuizCoins por dia jogado (mínimo 5 dias), em vez de soma — joga mais justo para quem começou recentemente.",
      "🌱 Nova seção \"Novatos em ascensão\" para quem ainda não bateu o mínimo de dias.",
      "🏅 3 conquistas novas: Novato em Ascensão, Campeão da Semana e Pódio Semanal.",
      "🗂️ Removido o limite de retenção de 22 dias — o histórico fica guardado indefinidamente.",
      "📐 Novo app \"Regras de Pontuação\" explicando todo o cálculo em detalhe técnico.",
    ],
  },
  {
    version: "1.1.0",
    date: "27/06/2026",
    isNew: false,
    title: "Loja renovada, emojis e mais performance",
    items: [
      "🙂 Emoji de ranking: compre emojis para exibir ao lado do seu nome, na aba Perfil ou direto na Loja. Sem limite de quantidade — cada novo emoji custa 100 LuizCoins mais que o anterior.",
      "🔓 Sessão não expira mais — você continua logado sem precisar refazer login toda hora.",
      "🛡️ Novas ferramentas de admin: remover pontuações falsas dos jogos e ajustar LuizCoins de qualquer usuário manualmente.",
      "💣 Correção no cálculo de pontuação do Campo Minado.",
      "⚡ Cache de leituras pesadas no servidor e no navegador, deixando o app mais rápido e reduzindo a carga no banco de dados.",
    ],
  },
  {
    version: "1.0.0",
    date: "21/06/2026",
    isNew: false,
    title: "Versão inicial do LuizOS",
    items: [
      "🎯 Aposte no horário de chegada do Luiz, veja as apostas abertas do dia e o histórico de dias anteriores.",
      "📅 Suporte a apostar para o próximo dia útil quando o dia atual já fechou.",
      "🏆 Ranking geral e LuizCoins™: ganhe moedas acertando ou ficando bem posicionado no palpite do dia.",
      "🛒 Loja do Luiz: troque LuizCoins™ por skins/gifs do Luiz e cores especiais para o seu nome no ranking.",
      "🏅 Conquistas: desbloqueie badges e exiba a favorita ao lado do seu nome.",
      "🐍💣 Mini-games Snake 95 e Campo Minado, com ranking próprio.",
      "👤 Login e cadastro de usuários, painel administrativo.",
      "🖼️ Customização de papel de parede e posição dos ícones da área de trabalho.",
      "🔒 Melhorias de segurança no login e nas sessões.",
    ],
  },
];
const RELEASE_NOTES_CURRENT_VERSION = RELEASE_NOTES[0].version;

function renderReleaseNotes() {
  const container = document.getElementById("release-notes-content");
  if (!container) return;
  let html = "";
  RELEASE_NOTES.forEach((release) => {
    html += `<div class="release-version-block">
      <div class="release-version-header">
        <span>🗂️ Versão ${release.version} — ${escHtml(release.title)}${release.isNew ? '<span class="release-version-badge">NOVO</span>' : ""}</span>
        <span class="release-version-date">${release.date}</span>
      </div>
      <ul class="release-version-items">
        ${release.items.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>`;
  });
  container.innerHTML = html;
}

function openReleaseNotes() {
  renderReleaseNotes();
  openWindow("win-release-notes");
  localStorage.setItem(RELEASE_NOTES_SEEN_KEY, RELEASE_NOTES_CURRENT_VERSION);
}

function checkReleaseNotes() {
  const seenVersion = localStorage.getItem(RELEASE_NOTES_SEEN_KEY);
  if (seenVersion !== RELEASE_NOTES_CURRENT_VERSION) {
    openReleaseNotes();
  }
}

checkReleaseNotes();

// ─── Regras de Pontuação (referência técnica) ────────────────────────────────
// Conteúdo estático espelhando a implementação real em api/lib/store-items.js,
// api/lib/rankings.js e api/routes/admin.js. Se a lógica de pontuação mudar,
// atualize este texto também — é a fonte de verdade que os jogadores (todos
// devs) vão ler para entender o cálculo.
let scoringRulesAdvancedOpen = false;

function renderScoringRules() {
  const container = document.getElementById("scoring-rules-content");
  if (!container) return;
  container.innerHTML = `
    <div class="section-label">🎯 Como ganho LuizCoins na aposta</div>
    <div class="info-box">Quanto mais perto você chutar do horário real que o Luiz chegou, mais LuizCoins você ganha — não importa quantas pessoas apostaram naquele dia.</div>
    <ul class="rules-simple-list">
      <li>🎯 Acertou em cheio → recompensa máxima.</li>
      <li>🟢 Chutou bem perto → recompensa boa.</li>
      <li>🟡 Chutou mais ou menos → recompensa pequena.</li>
      <li>⚪ Chutou longe → ganha só por participar.</li>
    </ul>

    <div class="section-label" style="margin-top:14px">🥇 Pódio do dia</div>
    <div class="info-box">Em caso de empate no horário, quem apostou primeiro fica na frente. O 1º lugar do dia desbloqueia a conquista 🔮 Profeta do Luiz.</div>

    <div class="section-label" style="margin-top:14px">⚠️ Não vale esperar o Luiz chegar para apostar</div>
    <div class="info-box">Apostas feitas muito perto do horário real de chegada (nos últimos 30 minutos) não concorrem ao pódio nem à recompensa de precisão — só a moeda de participação. É para ninguém ganhar vantagem vendo o Luiz chegar antes de apostar.</div>

    <div class="section-label" style="margin-top:14px">📅 Ranking semanal e geral</div>
    <div class="info-box">O ranking padrão reseta toda semana, para todo mundo ter chance. Tem também um ranking geral (usa a média, não a soma, para não favorecer só quem joga há mais tempo) e uma aba com o histórico de semanas anteriores. Quem está jogando há pouco tempo aparece numa seção separada de "Novatos em ascensão" — e pode ganhar uma conquista própria se se destacar logo no início.</div>

    <div class="rules-advanced-toggle">
      <button class="win95-action-btn" onclick="toggleScoringRulesAdvanced()">
        ${scoringRulesAdvancedOpen ? "🔼 Esconder detalhes técnicos" : "🔽 Mostrar detalhes técnicos"}
      </button>
    </div>

    <div id="scoring-rules-advanced" style="display:${scoringRulesAdvancedOpen ? "block" : "none"}">
      <div class="section-label" style="margin-top:14px">🎯 Pontuação diária (por aposta)</div>
      <div class="info-box">
        Cada palpite resolvido gera <code>diff = abs(palpite - chegada_real)</code>, em minutos.
        A recompensa é por <strong>banda de precisão absoluta</strong> — não depende de quantas
        pessoas apostaram naquele dia.
      </div>
      <pre class="rules-code">diff == 0min        -> 30 LuizCoins  (exato)
diff <= 2min        -> 20 LuizCoins
diff <= 5min        -> 10 LuizCoins
diff <= 10min       ->  5 LuizCoins
diff > 10min        ->  1 LuizCoin  (participação)
invalidated == true ->  1 LuizCoin  (ver anti-sniping abaixo)</pre>
      <div class="info-box">Implementação: <code>coinsForGuess()</code> em <code>api/lib/store-items.js</code>.</div>

      <div class="section-label" style="margin-top:14px">🥇 Top 3 do dia &amp; desempate</div>
      <div class="info-box">
        O pódio do dia é ordenado por <code>diff</code> ascendente. Em caso de empate exato no
        <code>diff</code>, quem apostou primeiro (<code>createdAt</code> mais antigo) fica na posição
        melhor — sem posições compartilhadas. O 1º lugar desbloqueia a conquista
        <strong>🔮 Profeta do Luiz</strong>.
      </div>
      <pre class="rules-code">sort by: diff asc, então createdAt asc
position = índice + 1 (sequencial, sem gaps/compartilhamento)</pre>

      <div class="section-label" style="margin-top:14px">⚠️ Anti-sniping (janela de 30 min)</div>
      <div class="info-box">
        Para coibir quem aposta só depois de literalmente ver o Luiz chegar (antes do admin
        registrar o horário), qualquer palpite feito a <strong>30 minutos ou menos</strong> antes do
        horário real de chegada é marcado <code>invalidated: true</code>. A penalização é suave: a
        aposta ainda conta como participação (1 LuizCoin), mas não concorre a precisão nem ao
        pódio do dia, e some no ranking exibida com a tag "⚠️ invalidada".
      </div>
      <pre class="rules-code">arrivalInstant = brasiliaWallTimeToInstant(data, horario_chegada)
invalidated = (arrivalInstant - createdAt) in [0, 30min]</pre>
      <div class="info-box">Implementação: <code>POST /api/admin/arrival</code> em <code>api/routes/admin.js</code>.</div>

      <div class="section-label" style="margin-top:14px">📅 Ranking semanal</div>
      <div class="info-box">
        Soma das LuizCoins ganhas em cada dia <strong>dentro da semana ISO atual</strong>
        (segunda a domingo), recalculada a partir de <code>days_index</code> + <code>day:&lt;data&gt;</code>
        a cada consulta (cacheada). Reseta toda semana — é a aba padrão da janela de Ranking.
        O 1º lugar do fim de semana (avaliado na sexta-feira) desbloqueia <strong>👑 Campeão da
        Semana</strong>; top 3 desbloqueia <strong>📈 Pódio Semanal</strong>.
      </div>
      <div class="info-box">Implementação: <code>computeWeekRanking()</code> em <code>api/lib/rankings.js</code>.</div>

      <div class="section-label" style="margin-top:14px">🌐 Ranking geral</div>
      <div class="info-box">
        Métrica é <strong>média de LuizCoins por dia jogado</strong> (não soma total), para não
        penalizar quem começou a jogar há pouco tempo. Exige um mínimo de <strong>5 dias
        jogados</strong> para entrar no ranking "oficial"; abaixo disso, o jogador aparece na seção
        separada <strong>🌱 Novatos em ascensão</strong>. Terminar entre os 3 primeiros de um dia
        com menos de 5 dias jogados desbloqueia essa conquista.
      </div>
      <pre class="rules-code">avgPoints = round((totalPoints / playedDays) * 10) / 10
ranked  = jogadores com playedDays >= 5, ordenado por avgPoints desc
rookies = jogadores com playedDays  < 5, ordenado por avgPoints desc</pre>
      <div class="info-box">Implementação: <code>computeOverallRanking()</code> em <code>api/lib/rankings.js</code>.</div>

      <div class="section-label" style="margin-top:14px">🗂️ Rankings anteriores &amp; dados históricos</div>
      <div class="info-box">
        A aba "Anteriores" lista o ranking final de cada semana passada (exclui a semana
        atual). O histórico de dias <strong>não tem mais limite de retenção</strong> — fica tudo
        guardado no Redis. Mudanças de regra de pontuação só valem para dias novos: resultados
        já registrados antes do deploy continuam com o cálculo da época, não são recalculados.
      </div>
    </div>
  `;
}

function toggleScoringRulesAdvanced() {
  scoringRulesAdvancedOpen = !scoringRulesAdvancedOpen;
  renderScoringRules();
}