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
let currentGameRankCache = { game: null, data: {} }; // { game, data: { [diff|'default']: scores[] } }

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

// ─── Legacy score toggle (Sudoku/Campo Minado) ───────────────────────────────
// Esses jogos salvam score = max(1, 9999 - tempoEmSegundos). Por padrão
// exibimos o tempo em segundos (mais legível); o checkbox permite ver o
// "placar legado" (9999 - tempo) de volta. Conversão é só de exibição,
// feita no front — o valor salvo no banco não muda.
const SHOW_LEGACY_SCORE_KEY = "luizos_show_legacy_score";
let showLegacyScore = false;

function loadShowLegacyScore() {
  try {
    const saved = localStorage.getItem(SHOW_LEGACY_SCORE_KEY);
    if (saved !== null) showLegacyScore = saved === "true";
  } catch {}
}

function saveShowLegacyScore() {
  try {
    localStorage.setItem(SHOW_LEGACY_SCORE_KEY, String(showLegacyScore));
  } catch {}
}

function syncLegacyScoreCheckboxes() {
  document.querySelectorAll("#rank-legacy-score-checkbox, .rank-legacy-score-checkbox").forEach((checkbox) => {
    checkbox.checked = showLegacyScore;
  });
}

function toggleLegacyScore(checked) {
  showLegacyScore = typeof checked === "boolean" ? checked : !showLegacyScore;
  saveShowLegacyScore();
  syncLegacyScoreCheckboxes();
  if (currentGameRankCache.game) renderGameRank();
}

// Jogos cujo score bruto é 9999 - tempoEmSegundos (menor tempo = maior score).
const TIME_BASED_SCORE_GAMES = new Set(["sudoku", "minesweeper", "spider"]);

function formatGameScore(game, score) {
  if (game === "luizjack") return `${score} LC`;
  if (!TIME_BASED_SCORE_GAMES.has(game) || showLegacyScore) return score;
  const seconds = Math.max(0, 9999 - score);
  return `${seconds}s`;
}

async function loadProfiles() {
  try {
    const data = await cachedFetchJSON("profiles", `${API}/profiles`, CACHE_TTL_MS);
    if (data) userProfiles = data;
  } catch {}
}

function renderPlayerName(name, includeAchievement) {
  const profile = userProfiles[name] || {};
  let inlineStyle = "";
  let colorClass = "";
  if (showDecorations && profile.nameColor) {
    colorClass = getColorClass(profile.nameColor.id);
    if (!colorClass) {
      inlineStyle += `color:${profile.nameColor.color};${getColorEffect(profile.nameColor.id)}`;
    }
  }
  if (showDecorations && profile.font) {
    inlineStyle += `font-family:${getFontFamily(profile.font)};`;
    const sizeAdjust = getFontSizeAdjust(profile.font);
    if (sizeAdjust) inlineStyle += `font-size:${sizeAdjust};`;
  }
  const style = inlineStyle ? `style="${inlineStyle}"` : "";
  const achievementBadge =
    showDecorations && includeAchievement && profile.achievement
      ? `<span class="achievement-badge" title="${escHtml(profile.achievement.title)}">${profile.achievement.icon}</span>`
      : "";
  const emojiPrefix = showDecorations && profile.emoji ? `<span class="profile-emoji-badge">${profile.emoji}</span> ` : "";
  return `${emojiPrefix}<span class="${colorClass}" ${style}>${escHtml(name)}</span>${achievementBadge}`;
}

function getFontFamily(fontId) {
  const map = {
    font_comic_sans:     "'Comic Sans MS', cursive",
    font_impact:         "Impact, fantasy",
    font_courier:        "'Courier New', monospace",
    font_georgia:        "Georgia, serif",
    font_lobster:        "'Lobster', cursive",
    font_press_start:    "'Press Start 2P', monospace",
    font_pacifico:       "'Pacifico', cursive",
    font_dancing_script: "'Dancing Script', cursive",
    font_minecraft:      "'Pixelify Sans', monospace",
  };
  return map[fontId] || "inherit";
}

function getFontSizeAdjust(fontId) {
  const map = {
    font_press_start:    "0.68em",
    font_impact:         "0.9em",
    font_lobster:        "0.95em",
    font_pacifico:       "0.95em",
    font_minecraft:      "0.85em",
  };
  return map[fontId] || null;
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
  document.body.classList.add("cursor-wait");
}
function hideLoading() {
  const el = document.getElementById("global-loading");
  if (el) el.style.display = "none";
  document.body.classList.remove("cursor-wait");
}

// ─── Sound effects (sintetizados, sem assets externos) ────────────────────────
// "Clack" mecânico: um transiente de ruído filtrado (o "click" agudo) somado
// a um thud grave curto (o "corpo" do clique) — soa como um mouse/teclado
// antigo, em vez de um bipe eletrônico. `variant` ajusta o timbre conforme
// a ação: "open" (mais agudo/brilhante), "close" (mais grave/surdo) ou
// "menu" (intermediário).
let audioCtx = null;
function playClick(variant) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;

    const tone = { open: 2600, menu: 2000, close: 1100 }[variant] || 1800;
    const thudFreq = { open: 150, menu: 130, close: 100 }[variant] || 120;

    // Transiente de ruído filtrado — o "click"
    const duration = 0.045;
    const bufferSize = Math.floor(audioCtx.sampleRate * duration);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 2.5);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(tone, now);
    filter.frequency.exponentialRampToValueAtTime(tone * 0.5, now + duration);
    filter.Q.value = 1.1;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.4, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    noise.start(now);
    noise.stop(now + duration);

    // Thud grave — dá corpo/peso ao clique
    const thud = audioCtx.createOscillator();
    const thudGain = audioCtx.createGain();
    thud.type = "sine";
    thud.frequency.value = thudFreq;
    thudGain.gain.setValueAtTime(0.22, now);
    thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    thud.connect(thudGain);
    thudGain.connect(audioCtx.destination);
    thud.start(now);
    thud.stop(now + 0.03);
  } catch { /* AudioContext indisponível — falha silenciosa */ }
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
  const wasHidden = w.style.display !== "block";
  w.style.display = "block";
  if (wasHidden) {
    w.classList.remove("win-closing");
    w.classList.add("win-opening");
    const clearOpening = () => w.classList.remove("win-opening");
    w.addEventListener("animationend", clearOpening, { once: true });
    setTimeout(clearOpening, 150);
    playClick("open");
  }
  if (id === "win-guess") {
    centerWindow(w);
    refreshTodayStatus();
  }
  if (id === "win-sudoku") centerWindow(w);
  if (id === "win-store") { loadStore(); loadProfileEmoji(); loadProfileFont(); }
  if (id === "win-achievements") loadAchievements();
  if (id === "win-scoring-rules") renderScoringRules();
  delete minimizedWindows[id];
  bringToFront(w);
  updateTaskbar();
  if (isMobile()) centerWindow(w);
  clampWindowToViewport(w);
}

function centerWindow(w) {
  const taskbarHeight = 34;
  const availableHeight = window.innerHeight - taskbarHeight;
  w.style.left = `${Math.max(0, Math.round((window.innerWidth - w.offsetWidth) / 2))}px`;
  w.style.top = `${Math.max(0, Math.round((availableHeight - w.offsetHeight) / 2))}px`;
}

// Garante que a janela caiba na área visível (acima da taskbar), mesmo em
// monitores pequenos onde o left/top fixo no HTML deixaria a janela cortada.
function clampWindowToViewport(w) {
  const taskbarHeight = 34;
  const availableHeight = window.innerHeight - taskbarHeight;
  const maxLeft = Math.max(0, window.innerWidth - w.offsetWidth);
  const maxTop = Math.max(0, availableHeight - w.offsetHeight);
  const left = parseInt(w.style.left, 10) || 0;
  const top = parseInt(w.style.top, 10) || 0;
  w.style.left = `${Math.min(Math.max(left, 0), maxLeft)}px`;
  w.style.top = `${Math.min(Math.max(top, 0), maxTop)}px`;
}

// ─── Maximize / zoom de jogos ─────────────────────────────────────────────────
// Botão de maximizar é injetado em toda .win95-window (genérico, sem precisar
// editar cada bloco de janela no HTML). Para janelas de jogo (que têm um
// elemento .game-zoom-target), maximizar também escala o conteúdo do jogo via
// CSS transform, em vez de só dar mais espaço vazio em volta.
const windowRestoreState = {};

function injectMaximizeButtons() {
  document.querySelectorAll(".win95-window").forEach((win) => {
    const controls = win.querySelector(".win95-controls");
    if (!controls || controls.querySelector(".win95-btn-maximize")) return;
    const closeBtn = controls.querySelector(".win95-btn-ctrl:last-child");
    const btn = document.createElement("button");
    btn.className = "win95-btn-ctrl win95-btn-maximize";
    btn.title = "Maximizar";
    btn.textContent = "🗖";
    btn.onclick = (e) => {
      e.stopPropagation();
      toggleMaximizeWindow(win.id);
    };
    if (closeBtn) controls.insertBefore(btn, closeBtn);
    else controls.appendChild(btn);
  });
}

function toggleMaximizeWindow(id) {
  const win = document.getElementById(id);
  if (!win) return;
  const body = win.querySelector(".win95-body");
  const titlebar = win.querySelector(".win95-titlebar");
  const taskbarHeight = 34;

  if (win.dataset.maximized === "true") {
    const restore = windowRestoreState[id];
    if (restore) {
      win.style.left = restore.left;
      win.style.top = restore.top;
      win.style.width = restore.width;
    }
    win.style.height = "";
    if (body) {
      body.style.height = "";
      body.style.maxHeight = "";
    }
    win.classList.remove("maximized");
    win.dataset.maximized = "false";
    setGameZoom(win, 1);
    return;
  }

  windowRestoreState[id] = {
    left: win.style.left,
    top: win.style.top,
    width: win.style.width,
  };

  win.style.left = "0px";
  win.style.top = "0px";
  const fullWidth = window.innerWidth;
  const fullHeight = window.innerHeight - taskbarHeight;
  win.style.width = `${fullWidth}px`;
  win.style.height = `${fullHeight}px`;
  win.classList.add("maximized");
  win.dataset.maximized = "true";

  if (body && titlebar) {
    const bodyHeight = fullHeight - titlebar.offsetHeight;
    body.style.height = `${bodyHeight}px`;
    body.style.maxHeight = `${bodyHeight}px`;
  }

  bringToFront(win);
  applyGameZoom(win);
}

// Chamado pelos jogos depois de reconstruir o tabuleiro (ex: troca de
// dificuldade), para reajustar o zoom se a janela estiver maximizada.
function refreshGameZoom(id) {
  const win = document.getElementById(id);
  if (win && win.dataset.maximized === "true") applyGameZoom(win);
}

// `transform: scale()` amplia visualmente o elemento mas não altera o
// espaço que ele ocupa no fluxo do layout — sem reservar esse espaço extra,
// o conteúdo abaixo (info-box, dicas) fica sobreposto pelo jogo ampliado.
// `extraHeight` é a diferença entre a altura visual ampliada e a altura
// natural, aplicada como margin-bottom (o transform-origin é "top center",
// então o crescimento visual é só para baixo, nunca para cima).
function setGameZoom(win, scale, extraHeight) {
  const target = win.querySelector(".game-zoom-target");
  if (!target) return;
  target.style.transform = scale === 1 ? "" : `scale(${scale})`;
  target.style.marginBottom = scale === 1 ? "" : `${extraHeight || 0}px`;
}

// Escala o conteúdo do jogo (.game-zoom-target) para aproveitar o espaço
// extra de uma janela maximizada, sem nunca encolher abaixo do tamanho base.
function applyGameZoom(win) {
  const target = win.querySelector(".game-zoom-target");
  const body = win.querySelector(".win95-body");
  if (!target || !body) return;

  target.style.transform = "";
  // .game-zoom-target tem align-self:center no CSS, então seu tamanho já
  // reflete o conteúdo real (não esticado pelo flex column do .win95-body).
  const naturalWidth = target.scrollWidth;
  const naturalHeight = target.scrollHeight;

  const availWidth = body.clientWidth - 16;
  const availHeight = body.clientHeight - 16;
  if (!naturalWidth || !naturalHeight || availWidth <= 0 || availHeight <= 0) return;

  const GAME_ZOOM_MAX = 2.2;
  const scale = Math.max(1, Math.min(availWidth / naturalWidth, availHeight / naturalHeight, GAME_ZOOM_MAX));
  // +6px de folga para absorver arredondamento de subpixel do transform,
  // que senão deixava o conteúdo ampliado sobrepor levemente o que vem
  // depois dele (ex: o texto de ajuda).
  const extraHeight = Math.ceil(naturalHeight * (scale - 1)) + 6;
  setGameZoom(win, scale, extraHeight);
}

window.addEventListener("resize", () => {
  document.querySelectorAll('.win95-window[data-maximized="true"]').forEach((win) => {
    const taskbarHeight = 34;
    const body = win.querySelector(".win95-body");
    const titlebar = win.querySelector(".win95-titlebar");
    win.style.width = `${window.innerWidth}px`;
    win.style.height = `${window.innerHeight - taskbarHeight}px`;
    if (body && titlebar) {
      const bodyHeight = window.innerHeight - taskbarHeight - titlebar.offsetHeight;
      body.style.height = `${bodyHeight}px`;
      body.style.maxHeight = `${bodyHeight}px`;
    }
    applyGameZoom(win);
  });
});

// Toca a animação de fechar e só então executa `then` — com fallback por
// timeout, já que animationend pode não disparar (aba em background, etc).
function playCloseAnimation(w, then) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    w.classList.remove("win-closing");
    then();
  };
  w.classList.remove("win-opening");
  w.classList.add("win-closing");
  w.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, 150);
}

function closeWindow(id) {
  const w = document.getElementById(id);
  if (!w || w.style.display === "none") return;
  playClick("close");
  playCloseAnimation(w, () => {
    w.style.display = "none";
    delete minimizedWindows[id];
    updateTaskbar();
  });
}

function minimizeWindow(id) {
  const w = document.getElementById(id);
  if (!w || w.style.display === "none") return;
  playClick("close");
  playCloseAnimation(w, () => {
    minimizedWindows[id] = true;
    w.style.display = "none";
    updateTaskbar();
  });
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
    "win-top1-rank": "🏅 Top 1 Jogos",
    "win-achievements-rank": "🎖️ Rank Conquistas",
    "win-achievements": "🏅 Conquistas",
    "win-profile": "🧑‍🎨 Perfil",
    "win-release-notes": "📰 Novidades",
    "win-scoring-rules": "📐 Regras",
    "win-folder-apostas": "📁 Apostas",
    "win-folder-jogos": "📁 Jogos",
    "win-folder-rankings": "📁 Rankings",
    "win-folder-perfil": "📁 Perfil & Loja",
    "win-folder-acessorios": "📁 Acessórios",
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
          if (id === "win-store") { loadStore(); loadProfileEmoji(); loadProfileFont(); }
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

// v3: a v2 ainda calculava a posição padrão a partir do layout flex nativo
// (dependia da altura da tela e podia embaralhar o agrupamento); agora é
// determinístico. Bump de novo pra descartar posições "v2" já salvas com
// o bug.
const ICON_POSITIONS_KEY = "luizos_icon_positions_v3";
let defaultIconPositions = {};

// Mesma grade (tamanho de célula/origem) usada por resolveIconOverlaps —
// extraído pra constante compartilhada pra não duplicar os números.
const ICON_CELL_W = 80;
const ICON_CELL_H = 78;
const ICON_GRID_ORIGIN = 12; // mesmo valor do padding de .desktop

// Calcula a posição padrão de cada ícone em uma grade determinística
// (coluna por coluna, de cima pra baixo, na ordem do HTML), em vez de ler
// offsetLeft/offsetTop do layout flex nativo do navegador — que depende da
// altura da janela (quantos ícones cabem antes de quebrar pra próxima
// coluna) e podia embaralhar o agrupamento por categoria em telas menores.
function captureDefaultIconPositions() {
  defaultIconPositions = {};

  const desktop = document.querySelector(".desktop");
  const maxRow = desktop
    ? Math.max(Math.floor((desktop.clientHeight - ICON_GRID_ORIGIN - ICON_CELL_H) / ICON_CELL_H), 0)
    : Infinity;

  let col = 0;
  let row = 0;
  document.querySelectorAll(".desktop-icon").forEach((icon) => {
    const id = icon.dataset.iconId;
    if (!id) return;
    defaultIconPositions[id] = {
      left: `${ICON_GRID_ORIGIN + col * ICON_CELL_W}px`,
      top: `${ICON_GRID_ORIGIN + row * ICON_CELL_H}px`,
    };
    row++;
    if (row > maxRow) {
      row = 0;
      col++;
    }
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
    let saved = JSON.parse(localStorage.getItem(ICON_POSITIONS_KEY) || "{}");
    // Se algum ícone atual nunca foi salvo (ex.: novo app adicionado depois),
    // a posição salva dos ícones vizinhos fica desatualizada e pode colidir
    // com o layout padrão do ícone novo. Nesse caso, descarta o cache salvo
    // e recomeça do layout padrão para evitar sobreposição.
    const currentIds = Array.from(document.querySelectorAll(".desktop-icon"))
      .map((icon) => icon.dataset.iconId)
      .filter(Boolean);
    const hasUnseenIcon = currentIds.some((id) => !(id in saved));
    if (hasUnseenIcon) saved = {};

    let updated = hasUnseenIcon;
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
  resolveIconOverlaps();
}

// Garante que nenhum ícone fique posicionado sobre outro, independente do
// que esteja salvo no localStorage. Para cada ícone, na ordem do DOM, se a
// posição atual colidir com algum ícone já posicionado, empurra para a
// próxima célula livre de uma grade (varrendo colunas de cima para baixo).
function resolveIconOverlaps() {
  const ORIGIN = ICON_GRID_ORIGIN;
  const icons = Array.from(document.querySelectorAll(".desktop-icon")).filter(
    (icon) => icon.dataset.iconId
  );
  if (!icons.length) return;

  const desktop = document.querySelector(".desktop");
  const maxRow = desktop
    ? Math.max(Math.floor((desktop.clientHeight - ORIGIN - ICON_CELL_H) / ICON_CELL_H), 0)
    : Infinity;

  const taken = new Set();
  let changed = false;

  icons.forEach((icon) => {
    let left = parseInt(icon.style.left, 10) || 0;
    let top = parseInt(icon.style.top, 10) || 0;
    // Encaixa na grade fixa (alinhada à origem do padding), em vez de manter
    // o pixel exato capturado do layout flex original — isso evita ícones
    // "tortos" quando vizinhos são deslocados para resolver colisões.
    let col = Math.round((left - ORIGIN) / ICON_CELL_W);
    let row = Math.round((top - ORIGIN) / ICON_CELL_H);
    if (col < 0) col = 0;
    if (row < 0) row = 0;

    while (taken.has(`${col},${row}`) || row > maxRow) {
      row += 1;
      if (row > maxRow) {
        row = 0;
        col += 1;
      }
    }
    taken.add(`${col},${row}`);

    const newLeft = ORIGIN + col * ICON_CELL_W;
    const newTop = ORIGIN + row * ICON_CELL_H;
    if (newLeft !== left || newTop !== top) {
      icon.style.position = "absolute";
      icon.style.left = `${newLeft}px`;
      icon.style.top = `${newTop}px`;
      changed = true;
    }
  });

  if (changed) saveIconPositions();
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
  padrao:      { label: "Padrão",       type: "color", value: "#008080" },
  windows:     { label: "Windows",      type: "image", value: "/wallpapers/windows.png" },
  michaelsoft: { label: "Michaelsoft",  type: "image", value: "/wallpapers/michaelsoft.png" },
  luiz:        { label: "Luiz",         type: "image", value: "/wallpapers/luiz.png" },
  luizbeatle:  { label: "LuizBeatle",   type: "image", value: "/assets/wallpapers/luizBeatle.jpg" },
  luizbliss:   { label: "LuizBliss",    type: "image", value: "/assets/wallpapers/luizBliss.jpg" },
  custom:      { label: "Personalizado", type: "color", value: "#008080" },
};

function applyWallpaper(key) {
  const wp = WALLPAPERS[key];
  if (!wp) return;
  const desktop = document.querySelector(".desktop");
  const appsGrid = document.getElementById("apps-grid");
  if (wp.type === "color") {
    document.body.style.background = wp.value;
    desktop.style.backgroundImage = "none";
    appsGrid.style.backgroundImage = "none";
  } else {
    document.body.style.background = "#000";
    [desktop, appsGrid].forEach((el) => {
      el.style.backgroundImage = `url('${wp.value}')`;
      el.style.backgroundSize = "cover";
      el.style.backgroundPosition = "center";
    });
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

// Atualiza os botões de wallpapers comprados no menu de contexto e na aba de perfil
function updatePurchasedWallpapers(purchases, wpItems) {
  const owned = wpItems.filter((i) => purchases.includes(i.id));

  const ctxContainer = document.getElementById("ctx-wallpapers-purchased");
  if (ctxContainer) {
    ctxContainer.innerHTML = owned
      .map((i) => `<button class="ctx-wallpaper-item" data-wp="${i.wpKey}" onclick="applyWallpaper('${i.wpKey}')">${escHtml(i.title)}</button>`)
      .join("");
  }

  const profileContainer = document.getElementById("profile-wallpapers-purchased");
  if (profileContainer) {
    profileContainer.innerHTML = owned
      .map((i) => `<button class="win95-action-btn" data-wp="${i.wpKey}" onclick="applyWallpaper('${i.wpKey}')">${escHtml(i.title)}</button>`)
      .join("");
  }
}

async function loadProfileWallpaper() {
  if (!currentUser) return;
  try {
    const res = await fetch(`${API}/store`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) return;
    const wpItems = data.items.filter((i) => i.type === "wallpaper");
    updatePurchasedWallpapers(data.purchases, wpItems);
  } catch { /* silent */ }
}

// ─── Start Menu ───────────────────────────────────────────────────────────────
function toggleStartMenu() {
  const m = document.getElementById("start-menu");
  if (m.style.display === "none") {
    m.style.display = isMobile() ? "flex" : "block";
    playClick("menu");
  } else {
    m.style.display = "none";
  }
}
function closeStartMenu() {
  document.getElementById("start-menu").style.display = "none";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".start-menu") && !e.target.closest(".start-btn")) closeStartMenu();
});

// ─── Apps Grid (visão "Todos os Aplicativos") ──────────────────────────────────
function setDesktopView(view) {
  const desktop = document.querySelector(".desktop");
  const grid = document.getElementById("apps-grid");
  const btn = document.getElementById("apps-view-btn");
  const showGrid = view === "apps";
  desktop.style.display = showGrid ? "none" : "flex";
  grid.style.display = showGrid ? "flex" : "none";
  btn.classList.toggle("active", showGrid);
  btn.textContent = showGrid ? "🖥️" : "▦";
  btn.title = showGrid ? "Ver Área de Trabalho" : "Todos os Aplicativos";
}

function toggleAppsView() {
  const isGrid = document.getElementById("apps-grid").style.display !== "none";
  setDesktopView(isGrid ? "desktop" : "apps");
}

function initAppsView() {
  setDesktopView(isMobile() ? "apps" : "desktop");
}

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
      showMsg(msg, "", "ok");
      document.getElementById("login-password").value = "";
      if (data.mustChangePassword) {
        closeWindow("win-login");
        openWindow("win-change-password");
      } else {
        closeWindow("win-login");
      }
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Esqueci minha senha ──────────────────────────────────────────────────────
async function forgotPassword() {
  const name = document.getElementById("login-name-select").value;
  const msg = document.getElementById("login-msg");

  if (!name) {
    showMsg(msg, "Selecione seu nome na lista primeiro.", "err");
    return;
  }
  if (!await w95confirm(`Resetar a senha de "${name}"? Você vai precisar entrar em contato com o admin para receber a senha temporária.`)) {
    return;
  }

  showLoading("Solicitando reset...");
  try {
    const res = await fetch(`${API}/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(
        msg,
        "✅ Senha resetada. Entre em contato com o Ronaldo para receber sua senha temporária — no primeiro login com ela, você vai escolher uma nova senha.",
        "ok",
      );
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

// ─── Trocar senha (obrigatório após reset) ───────────────────────────────────
async function submitChangePassword() {
  const newPassword = document.getElementById("change-password-new").value;
  const confirmPassword = document.getElementById("change-password-confirm").value;
  const msg = document.getElementById("change-password-msg");

  if (!newPassword || newPassword.length < 4) {
    showMsg(msg, "A senha deve ter ao menos 4 caracteres.", "err");
    return;
  }
  if (newPassword !== confirmPassword) {
    showMsg(msg, "As senhas não coincidem.", "err");
    return;
  }

  showLoading("Salvando nova senha...");
  try {
    const res = await fetch(`${API}/change-password`, {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ newPassword }),
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById("change-password-new").value = "";
      document.getElementById("change-password-confirm").value = "";
      closeWindow("win-change-password");
    } else {
      showMsg(msg, `❌ ${data.error}`, "err");
    }
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
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
  if (currentUser) setPlacaLoading(); else hidePlaca();
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
      hidePlaca();
    } else if (data.viewerHasGuessed && bettingOpen) {
      const msg = document.getElementById("guess-msg");
      const dayLabel = isNextDay ? "para o próximo dia" : "hoje";
      showMsg(msg, `✅ Você já apostou ${dayLabel}: ${data.viewerGuess.time}. Só 1 palpite por dia!`, "ok");
      setGuessFormOpen(false);
      hidePlaca();
    } else {
      setGuessFormOpen(bettingOpen);
      if (bettingOpen) {
        renderPlacaCheckbox(getClientWeekKey(data.activeBetDate));
      } else {
        hidePlaca();
      }
    }
  } catch {
    if (banner) {
      banner.textContent = `⚠️ Erro ao verificar status. Horário: ${getBrasiliaTime()}.`;
      banner.className = "win95-status-bar show closed";
    }
    setGuessFormOpen(false);
    hidePlaca();
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

// ─── Luiz de Placa (boost de pontos em dobro, 1x por semana) ──────────────────
// Não faz requisição nenhuma ao marcar o checkbox — só envia `placa: true`
// junto com a aposta em si. A disponibilidade exibida no front é um "cache"
// otimista no localStorage (chaveado por usuário + semana ISO); o backend
// sempre revalida na hora de gravar a aposta e cancela tudo se já tiver sido
// usado (ver POST /api/guess).
let currentPlacaWeekKey = null;

// Replica o cálculo de semana ISO do backend (ver lib/datetime.js) a partir
// da data já retornada por /api/today — evita uma requisição extra só pra
// descobrir em que semana estamos.
function getClientWeekKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (4 - isoDay));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

function placaStorageKey() {
  if (!currentUser) return null;
  return `placaUsedWeek_${String(currentUser.name || "").trim().toLowerCase()}`;
}

function isPlacaUsedThisWeek(weekKey) {
  const key = placaStorageKey();
  return key ? localStorage.getItem(key) === weekKey : false;
}

function markPlacaUsed(weekKey) {
  const key = placaStorageKey();
  if (key && weekKey) localStorage.setItem(key, weekKey);
}

function setPlacaLoading() {
  const group = document.getElementById("placa-group");
  const checkbox = document.getElementById("placa-checkbox");
  const hint = document.getElementById("placa-hint");
  if (!group || !checkbox || !hint) return;
  group.style.display = "flex";
  checkbox.checked = false;
  checkbox.disabled = true;
  hint.textContent = "(verificando disponibilidade...)";
}

function hidePlaca() {
  const group = document.getElementById("placa-group");
  const checkbox = document.getElementById("placa-checkbox");
  if (group) group.style.display = "none";
  if (checkbox) checkbox.checked = false;
  currentPlacaWeekKey = null;
}

function renderPlacaCheckbox(weekKey) {
  const group = document.getElementById("placa-group");
  const checkbox = document.getElementById("placa-checkbox");
  const hint = document.getElementById("placa-hint");
  if (!group || !checkbox || !hint) return;

  currentPlacaWeekKey = weekKey;
  const used = isPlacaUsedThisWeek(weekKey);

  group.style.display = "flex";
  checkbox.disabled = used;
  if (used) checkbox.checked = false;
  hint.textContent = used
    ? "(já usado nesta semana)"
    : checkbox.checked
      ? "(ativado: pontos em dobro nesta aposta!)"
      : "(dobra os pontos desta aposta — 1x por semana)";
}

function togglePlaca() {
  const checkbox = document.getElementById("placa-checkbox");
  const hint = document.getElementById("placa-hint");
  if (!checkbox || !hint) return;
  hint.textContent = checkbox.checked
    ? "(ativado: pontos em dobro nesta aposta!)"
    : "(dobra os pontos desta aposta — 1x por semana)";
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

  const placaCheckbox = document.getElementById("placa-checkbox");
  const usePlaca = !!(placaCheckbox && placaCheckbox.checked && !placaCheckbox.disabled);

  showLoading("Registrando aposta...");
  try {
    // Envia time + placa — o servidor identifica o usuário pelo token e
    // revalida o uso semanal do Luiz de Placa antes de gravar (o front só
    // confiou no localStorage pra decidir se mostrava o checkbox habilitado).
    const res = await fetch(`${API}/guess`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ time, placa: usePlaca }),
    });
    const data = await res.json();
    if (res.ok) {
      if (data.placa) markPlacaUsed(data.placaWeekKey);
      const placaNote = data.placa ? " 🏆 Luiz de Placa ativado — pontos em dobro!" : "";
      showMsg(msg, `✅ Aposta registrada! Você apostou ${time}.${placaNote}`, "ok");
      setGuessFormOpen(false);
      hidePlaca();
      todayStatusCache = null;
    } else {
      if (data.placaAlreadyUsed) markPlacaUsed(data.placaWeekKey || currentPlacaWeekKey);
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
  if (currentGameRankCache.game) renderGameRank();
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
  let inlineStyle = "";
  let nameColorClass = "";
  if (showDecorations && profile.nameColor) {
    nameColorClass = getColorClass(profile.nameColor.id);
    if (!nameColorClass) {
      inlineStyle += `color:${profile.nameColor.color};${getColorEffect(profile.nameColor.id)}`;
    }
  }
  if (showDecorations && profile.font) {
    inlineStyle += `font-family:${getFontFamily(profile.font)};`;
    const sizeAdjust = getFontSizeAdjust(profile.font);
    if (sizeAdjust) inlineStyle += `font-size:${sizeAdjust};`;
  }
  const nameStyle = inlineStyle ? `style="${inlineStyle}"` : "";
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
    case "color_safira":   return "text-shadow: 0 0 6px #64b5f6, 0 0 12px #1e88e5; font-weight:bold;";
    case "color_rubi":     return "text-shadow: 0 0 6px #ff5252, 0 0 12px #e53935; font-weight:bold;";
    case "color_ametista": return "text-shadow: 0 0 6px #ce93d8, 0 0 12px #ab47bc; font-weight:bold;";
    // topázio, dourado, diamante, platina, coração e elementais usam classes CSS
    default: return "";
  }
}

// Dourado, diamante e coração precisam de classes CSS (brilho/animação que
// inline style simples não cobre — gradiente com background-clip:text no
// diamante, corações flutuantes no coração).
function getColorClass(colorId) {
  switch (colorId) {
    case "color_topazio":  return "name-topaz-ember";
    case "color_dourado":  return "name-gold-blink";
    case "color_diamante": return "name-diamond-shine";
    case "color_platina":  return "name-platinum-sweep";
    case "color_coracao":  return "name-heart-particles";
    case "color_fogo":     return "name-fire-flicker";
    case "color_agua":     return "name-water-wave";
    case "color_terra":    return "name-earth-pulse";
    case "color_ar":       return "name-air-shimmer";
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
        `✅ Usuário "${name}" criado! Faça login para entrar.`,
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
  document.getElementById("admin-tab-invalidar").style.display = tab === "invalidar" ? "block" : "none";
  document.getElementById("admin-tab-rankcheat").style.display = tab === "rankcheat" ? "block" : "none";
  document.getElementById("admin-tab-tags").style.display = tab === "tags" ? "block" : "none";
  document.getElementById("admin-tab-coins").style.display = tab === "coins" ? "block" : "none";
  document.getElementById("admin-tab-passwords").style.display = tab === "passwords" ? "block" : "none";
  document.getElementById("admin-tab-requests").style.display = tab === "requests" ? "block" : "none";
  if (tab === "coins") loadAdminCoinsPlayers();
  if (tab === "passwords") loadAdminPasswordResets();
  if (tab === "requests") loadAdminRequests();
}

async function invalidateBets() {
  const date = document.getElementById("admin-invalidar-date").value || undefined;
  const msg = document.getElementById("admin-invalidar-msg");
  showLoading("Recalculando invalidações...");
  try {
    const body = {};
    if (date) body.date = date;
    const res = await fetch(`${API}/admin/invalidate-bets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Invalidações recalculadas para ${date || "hoje"} (chegada: ${data.arrival})`, "ok");
      const result = document.getElementById("admin-invalidar-result");
      if (data.rankings && data.rankings.length > 0) {
        result.innerHTML = `<div class="section-label">🏆 Resultado</div>` + renderRankingsTable(data.rankings, data.arrival);
      } else {
        result.innerHTML = '<div class="no-data">Nenhuma aposta registrada neste dia.</div>';
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

async function loadAdminPasswordResets() {
  const msg = document.getElementById("admin-passwords-msg");
  const result = document.getElementById("admin-passwords-result");
  showLoading("Carregando senhas temporárias...");
  try {
    const res = await fetch(`${API}/admin/password-resets`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    const resets = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${resets.error || "Erro ao carregar."}`, "err");
      handleAdminAuthError(res.status);
      return;
    }
    renderAdminPasswordResets(resets);
  } catch {
    showMsg(msg, "Erro de conexão.", "err");
  } finally {
    hideLoading();
  }
}

function renderAdminPasswordResets(resets) {
  const result = document.getElementById("admin-passwords-result");
  if (!resets || resets.length === 0) {
    result.innerHTML = '<div class="no-data">Nenhuma senha temporária pendente.</div>';
    return;
  }
  let html = `<table class="win95-table"><thead><tr>
    <th>Jogador</th><th>Senha temporária</th><th>Gerada em</th><th></th>
  </tr></thead><tbody>`;
  resets.forEach((r) => {
    const date = new Date(r.createdAt).toLocaleString("pt-BR");
    const safeName = escHtml(r.name).replace(/'/g, "\\'");
    html += `<tr>
      <td>${escHtml(r.name)}</td>
      <td><code>${escHtml(r.password)}</code></td>
      <td>${date}</td>
      <td style="white-space:nowrap">
        <button class="win95-action-btn" style="font-size:10px;padding:2px 6px" data-text="${escHtml(r.password)}" onclick="copyToClipboard(this.dataset.text, this)">📋 Copiar</button>
        <button class="win95-action-btn" style="font-size:10px;padding:2px 6px" onclick="dismissAdminPasswordReset('${safeName}')">✖ Remover</button>
      </td>
    </tr>`;
  });
  html += "</tbody></table>";
  result.innerHTML = html;
}

async function dismissAdminPasswordReset(name) {
  const msg = document.getElementById("admin-passwords-msg");
  showLoading("Removendo...");
  try {
    const res = await fetch(`${API}/admin/password-resets/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (res.ok) {
      renderAdminPasswordResets(data.resets);
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

async function loadAdminCoinsAll() {
  const result = document.getElementById("admin-coins-all-result");
  const msg = document.getElementById("admin-coins-msg");
  showLoading("Consultando saldo de todos...");
  try {
    const res = await fetch(`${API}/admin/coins/all`, {
      headers: { "Authorization": `Bearer ${adminToken}` },
    });
    const balances = await res.json();
    if (!res.ok) {
      showMsg(msg, `❌ ${balances.error || "Erro ao carregar."}`, "err");
      handleAdminAuthError(res.status);
      return;
    }
    let html = `<table class="win95-table"><thead><tr>
      <th>Jogador</th><th>Saldo</th><th>Ganho</th><th>Gasto</th><th>Minigames</th>
    </tr></thead><tbody>`;
    balances.forEach((b) => {
      html += `<tr>
        <td>${escHtml(b.name)}</td>
        <td><strong>${b.balance}</strong></td>
        <td>${b.earnedCoins}</td>
        <td>${b.spentCoins}</td>
        <td>${b.gameCoins}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    result.innerHTML = html;
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

const ADMIN_RANK_DIFFICULTY_OPTIONS = {
  minesweeper: [
    { value: "beginner", label: "Iniciante" },
    { value: "intermediate", label: "Intermediário" },
    { value: "expert", label: "Especialista" },
  ],
  sudoku: [
    { value: "easy", label: "Fácil" },
    { value: "medium", label: "Médio" },
    { value: "hard", label: "Difícil" },
  ],
  aimtrainer: [
    { value: "easy", label: "Fácil" },
    { value: "normal", label: "Normal" },
    { value: "hard", label: "Difícil" },
  ],
  spider: [
    { value: "easy", label: "Fácil" },
    { value: "medium", label: "Médio" },
    { value: "hard", label: "Difícil" },
  ],
};

function onAdminRankGameChange() {
  const game = document.getElementById("admin-rank-game").value;
  const options = ADMIN_RANK_DIFFICULTY_OPTIONS[game];
  document.getElementById("admin-rank-difficulty-group").style.display = options ? "block" : "none";
  if (options) {
    const select = document.getElementById("admin-rank-difficulty");
    select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
  }
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
  const difficulty = ADMIN_RANK_DIFFICULTY_OPTIONS[game] ? document.getElementById("admin-rank-difficulty").value : null;
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
  if (!await w95confirm(`Remover o recorde de "${name}"?`)) return;
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

async function adminMigrateAimtrainerPlatform() {
  const msg = document.getElementById("admin-migrate-aimtrainer-msg");
  if (!await w95confirm("Migrar scores legados do Aim Trainer para mobile? Scores existentes na chave mobile serão preservados.")) return;
  showLoading("Migrando...");
  try {
    const res = await fetch(`${API}/admin/migrate-aimtrainer-platform`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` },
    });
    const data = await res.json();
    if (res.ok) {
      const summary = data.report.map((r) => `${r.diff}: ${r.status}${r.count ? ` (${r.count} scores)` : ""}`).join(", ");
      showMsg(msg, `✅ Concluído — ${summary}`, "ok");
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

const GAME_RANK_DIFFICULTIES = {
  minesweeper: ["beginner", "intermediate", "expert"],
  sudoku:      ["easy", "medium", "hard"],
  aimtrainer:  ["easy", "normal", "hard"],
  spider:      ["easy", "medium", "hard"],
};

function buildGameRankTable(game, scores) {
  if (scores.length === 0) {
    return '<div class="no-data">Nenhum recorde ainda. Seja o primeiro!</div>';
  }
  let html = `<table class="win95-table"><thead><tr>
    <th>#</th><th>Jogador</th><th>Pontuação</th><th>Data</th>
  </tr></thead><tbody>`;
  scores.forEach((s, i) => {
    const date = new Date(s.date).toLocaleDateString("pt-BR");
    const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
    html += `<tr class="${medalClass}"><td>${i + 1}º</td><td>${renderPlayerName(s.name, true)}</td><td><strong>${formatGameScore(game, s.score)}</strong></td><td>${date}</td></tr>`;
  });
  return html + `</tbody></table>`;
}

function renderGameRank() {
  const container = document.getElementById("gamerank-content");
  if (!container || !currentGameRankCache.game) return;
  const { game, data } = currentGameRankCache;
  if (game === "luizjack") {
    container.innerHTML = buildBjRankTable(data["default"] || []);
    return;
  }
  const gameLabel = getGameLabel(game);
  const diffs = GAME_RANK_DIFFICULTIES[game];
  let html = "";
  if (game === "aimtrainer" && diffs) {
    const platforms = [
      { key: "mobile", label: "📱 Mobile" },
      { key: "desktop", label: "🖥️ Desktop" },
    ];
    platforms.forEach(({ key, label }) => {
      html += `<div class="section-label" style="margin-top:8px;font-size:13px">${label}</div>`;
      diffs.forEach((diff) => {
        html += `<div class="section-label" style="margin-top:4px">${gameLabel} — ${getDifficultyLabel(diff)} — Top 50</div>`;
        html += buildGameRankTable(game, data[`${diff}:${key}`] || []);
      });
    });
  } else if (!diffs) {
    html += `<div class="section-label">${gameLabel} — Top 50</div>`;
    html += buildGameRankTable(game, data["default"] || []);
  } else {
    diffs.forEach((diff) => {
      html += `<div class="section-label" style="margin-top:8px">${gameLabel} — ${getDifficultyLabel(diff)} — Top 50</div>`;
      html += buildGameRankTable(game, data[diff] || []);
    });
  }
  container.innerHTML = html;
}

async function openGameRank(game) {
  setGameRankTabActive(game);
  openWindow("win-gamerank");
  await loadGameRank(game);
}

async function loadGameRank(game) {
  const container = document.getElementById("gamerank-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">⏳ Carregando ranking...</div>';
  setGameRankTabActive(game);
  try {
    if (game === "luizjack") {
      const data = await cachedFetchJSON("bj_rank", `${API}/blackjack/rank`, 30 * 1000);
      currentGameRankCache = { game, data: { default: data || [] } };
      renderGameRank();
      return;
    }
    const diffs = GAME_RANK_DIFFICULTIES[game];
    if (game === "aimtrainer" && diffs) {
      // Aimtrainer tem ranking separado por plataforma: busca mobile + desktop
      const platforms = ["mobile", "desktop"];
      const results = await Promise.all(
        diffs.flatMap((diff) =>
          platforms.map((platform) => {
            const cacheKey = `game_rank_aimtrainer_${diff}_${platform}`;
            return cachedFetchJSON(cacheKey, `${API}/game-rank?game=aimtrainer&difficulty=${diff}&platform=${platform}`, 20 * 1000);
          }),
        ),
      );
      const data = {};
      diffs.forEach((diff, di) => {
        platforms.forEach((platform, pi) => {
          data[`${diff}:${platform}`] = results[di * platforms.length + pi];
        });
      });
      currentGameRankCache = { game, data };
    } else if (!diffs) {
      const cacheKey = `game_rank_${game}_default`;
      const scores = await cachedFetchJSON(cacheKey, `${API}/game-rank?game=${game}`, 20 * 1000);
      currentGameRankCache = { game, data: { default: scores } };
    } else {
      const results = await Promise.all(
        diffs.map((diff) => {
          const cacheKey = `game_rank_${game}_${diff}`;
          return cachedFetchJSON(cacheKey, `${API}/game-rank?game=${game}&difficulty=${diff}`, 20 * 1000);
        }),
      );
      const data = {};
      diffs.forEach((diff, i) => { data[diff] = results[i]; });
      currentGameRankCache = { game, data };
    }
    renderGameRank();
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar ranking.</div>';
  }
}

// Avisa o servidor que uma partida começou de verdade, pra ele guardar o
// horário real de início (anti-trapaça: ver POST /api/game-rank/start no
// backend). Retorna uma Promise com o roundToken — disparada no início da
// partida mas só precisa ser aguardada na hora de enviar o score final, então
// não adiciona latência perceptível ao clique que inicia o jogo.
async function startGameRound(game, difficulty) {
  try {
    const body = difficulty ? { game, difficulty } : { game };
    const res = await fetch(`${API}/game-rank/start`, {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.roundToken || null;
  } catch (e) {
    console.error("startGameRound", e);
    return null;
  }
}

async function submitGameScore(game, difficulty, score, callback, token, extra) {
  const authToken = token || sessionToken;
  if (!currentUser || !authToken) return;
  try {
    const platform = extra?.platform;
    const platformSuffix = (game === "aimtrainer" && platform) ? `_${platform}` : "";
    const personalKey = difficulty
      ? `luizos_pb_${game}_${difficulty}${platformSuffix}`
      : `luizos_pb_${game}${platformSuffix}`;
    const personalBest = parseInt(localStorage.getItem(personalKey) || "0", 10);
    const scoreValue = Number(score);
    const isNewBest = scoreValue > personalBest;

    // Não envia playerName — o servidor usa o token de sessão
    const body = { game, score: scoreValue, ...extra };
    if (difficulty) body.difficulty = difficulty;

    const res = await fetch(`${API}/game-rank`, {
      method: "POST",
      headers: authHeaders(authToken),
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok) {
      // Atualiza PB local se for novo recorde
      if (isNewBest) localStorage.setItem(personalKey, String(scoreValue));
      // Invalida cache local do ranking (inclui plataforma para aimtrainer)
      const rankCacheKey = `${CACHE_PREFIX}game_rank_${game}_${difficulty || "default"}${platformSuffix}`;
      try { localStorage.removeItem(rankCacheKey); } catch {}
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

function getPersonalBest(game, difficulty, platform) {
  const platformSuffix = (game === "aimtrainer" && platform) ? `_${platform}` : "";
  const key = difficulty
    ? `luizos_pb_${game}_${difficulty}${platformSuffix}`
    : `luizos_pb_${game}${platformSuffix}`;
  return parseInt(localStorage.getItem(key) || "0", 10);
}

function getDifficultyLabel(diff) {
  return ({
    beginner: "Iniciante", intermediate: "Intermediário", expert: "Especialista",
    easy: "Fácil", medium: "Médio", hard: "Difícil", normal: "Normal",
  }[diff] || diff);
}

function getGameLabel(game) {
  return ({ snake: "🐍 Snake 95", minesweeper: "💣 Campo Minado", sudoku: "🔢 Sudoku", aimtrainer: "🎯 Aim Trainer", spider: "🕷️ Paciência Spider", luizjack: "🃏 Luiz21" }[game] || game);
}

function buildBjRankTable(entries) {
  if (entries.length === 0) return '<div class="no-data">Nenhuma mão jogada ainda. Seja o primeiro!</div>';
  let html = `<div class="section-label">🃏 Luiz21 — Maiores Ganhadores</div>
    <table class="win95-table"><thead><tr>
      <th>#</th><th>Jogador</th><th>LC Ganhos</th><th>Mãos</th>
    </tr></thead><tbody>`;
  entries.forEach((e, i) => {
    const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
    html += `<tr class="${medalClass}"><td>${i + 1}º</td><td>${renderPlayerName(e.name, true)}</td><td><strong>${e.coinsWon} LC</strong></td><td>${e.handsPlayed}</td></tr>`;
  });
  return html + "</tbody></table>";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Copia `text` para a área de transferência e dá feedback visual trocando o
// texto do botão clicado por um instante (sem precisar de toast/alerta).
async function copyToClipboard(text, btn) {
  const original = btn ? btn.textContent : null;
  try {
    let ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch { /* cai para o fallback abaixo (ex: documento sem foco) */ }
    }
    if (!ok) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      ok = document.execCommand("copy");
      ta.remove();
    }
    if (!ok) throw new Error("copy failed");
    if (btn) {
      btn.textContent = "✅ Copiado!";
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  } catch {
    if (btn) {
      btn.textContent = "❌ Falhou";
      setTimeout(() => { btn.textContent = original; }, 1500);
    }
  }
}

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
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
    const placaBadge = r.placa
      ? ' <span class="placa-badge" title="Luiz de Placa: pontos em dobro nesta aposta">🏆 placa</span>'
      : "";
    html += `<tr>
      <td>${medal}</td>
      <td>${renderPlayerName(r.name, false)}${invalidatedBadge}${placaBadge}</td>
      <td><strong>${r.time}</strong></td>
      ${arrival ? `<td>${diffStr}</td>` : ""}
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
injectMaximizeButtons();
captureDefaultIconPositions();
loadShowDecorations();
syncDecorationsCheckboxes();
loadShowLegacyScore();
syncLegacyScoreCheckboxes();
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
initAppsView();

// ─── Loja do Luiz ─────────────────────────────────────────────────────────────
async function openStore() {
  if (!currentUser) {
    await w95alert("Você precisa fazer login para acessar a loja e ver suas moedas.");
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
    const wpItems    = data.items.filter((i) => i.type === "wallpaper");
    const seedItems  = data.items.filter((i) => i.type === "farmseed");

    let html = "";

    if (wpItems.length > 0) {
      html += `<div class="section-label" style="margin-bottom:8px">🖼️ Planos de fundo</div>`;
      html += `<div class="store-grid">`;
      wpItems.forEach((item) => {
        const isUnlocked = data.purchases.includes(item.id);
        html += `
          <div class="${isUnlocked ? "store-item unlocked" : "store-item locked"}">
            <div class="store-item-title">${escHtml(item.title)}</div>
            <img src="${item.src}" class="store-item-preview" draggable="false" style="object-fit:cover" />
            ${!isUnlocked
              ? `<div class="store-item-price"><img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}</div>
                 <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${safeBalance})">Comprar</button>`
              : `<div class="store-item-price" style="color:#006400">✅ Seu</div>
                 <button class="win95-action-btn" onclick="applyWallpaper('${item.wpKey}')">Usar</button>`
            }
          </div>`;
      });
      html += `</div>`;
      updatePurchasedWallpapers(data.purchases, wpItems);
    }

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
                 <div class="store-item-current-price">custa <img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price} hoje</div>
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
            <div class="store-color-preview" style="${effect}">${(() => {
              const cls = getColorClass(item.id);
              return cls
                ? `<span class="${cls}">Seu nome</span>`
                : `<span style="color:${item.color};${getColorEffect(item.id)}">Seu nome</span>`;
            })()}</div>
            <div class="store-item-title">${escHtml(item.title)}</div>
            ${!isUnlocked
              ? `<div class="store-item-price"><img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}</div>
                 <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${safeBalance})">Comprar</button>`
              : `<div class="store-item-price" style="color:#006400">✅ Desbloqueado</div>
                 <div class="store-item-current-price">custa <img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price} hoje</div>`
            }
          </div>`;
      });
      html += `</div>`;
    }

    if (seedItems.length > 0) {
      html += `<div class="section-label" style="margin:16px 0 8px">🌾 Sementes para LuizFarm</div>`;
      html += `<div class="store-grid">`;
      seedItems.forEach((item) => {
        const isUnlocked = data.purchases.includes(item.id);
        html += `
          <div class="${isUnlocked ? "store-item unlocked" : "store-item locked"}">
            <div class="store-item-title">${escHtml(item.title)}</div>
            <div style="font-size:40px;text-align:center;padding:6px 0">${item.icon || "🌱"}</div>
            <div style="font-size:10px;color:#555;text-align:center;margin-bottom:4px">${escHtml(item.desc || "")}</div>
            ${!isUnlocked
              ? `<div class="store-item-price"><img src="/photos/luizCoinIcon.png" class="coin-icon"> ${item.price}</div>
                 <button class="win95-action-btn" onclick="buyStoreItem('${item.id}', ${item.price}, ${safeBalance})">Comprar</button>`
              : `<div class="store-item-price" style="color:#006400">✅ Desbloqueado</div>
                 <div style="font-size:9px;color:#444;text-align:center">Disponível na fazenda</div>`
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
    case "color_safira":    return `background: linear-gradient(135deg, #0d1a2e, #05101f); border: 1px solid ${color}; box-shadow: 0 0 12px #1e88e544; border-radius:4px; padding:12px; text-align:center;`;
    case "color_rubi":      return `background: linear-gradient(135deg, #2e0d0d, #1a0505); border: 1px solid ${color}; box-shadow: 0 0 12px #e5393544; border-radius:4px; padding:12px; text-align:center;`;
    case "color_ametista":  return `background: linear-gradient(135deg, #1a0d2e, #0d051f); border: 1px solid ${color}; box-shadow: 0 0 12px #ab47bc44; border-radius:4px; padding:12px; text-align:center;`;
    case "color_dourado":   return `background: linear-gradient(135deg, #2a2000, #1a1400); border: 1px solid ${color}; box-shadow: 0 0 12px #ffd60044; border-radius:4px; padding:12px; text-align:center;`;
    case "color_topazio":   return `background: linear-gradient(135deg, #2e1505, #1a0c02); border: 1px solid ${color}; box-shadow: 0 0 12px #e64a1944; border-radius:4px; padding:12px; text-align:center;`;
    case "color_diamante":  return `background: linear-gradient(135deg, #0d1a2e, #050d1a); border: 1px solid ${color}; box-shadow: 0 0 16px #81d4fa66; border-radius:4px; padding:12px; text-align:center;`;
    case "color_platina":   return `background: linear-gradient(135deg, #1a1a1a, #2a2a2a); border: 1px solid ${color}; box-shadow: 0 0 16px #e0e0e055; border-radius:4px; padding:12px; text-align:center;`;
    case "color_fogo":      return `background: linear-gradient(135deg, #1a0800, #2d1000); border: 1px solid ${color}; box-shadow: 0 0 16px #ff450055; border-radius:4px; padding:12px; text-align:center;`;
    case "color_agua":      return `background: linear-gradient(135deg, #001f3f, #002d5c); border: 1px solid ${color}; box-shadow: 0 0 16px #0288d155; border-radius:4px; padding:12px; text-align:center;`;
    case "color_terra":     return `background: linear-gradient(135deg, #1a1008, #2a1a0d); border: 1px solid ${color}; box-shadow: 0 0 16px #6d4c4155; border-radius:4px; padding:12px; text-align:center;`;
    case "color_ar":        return `background: linear-gradient(135deg, #001f26, #00303d); border: 1px solid ${color}; box-shadow: 0 0 16px #80deea55; border-radius:4px; padding:12px; text-align:center;`;
    default: return `padding:12px; text-align:center;`;
  }
}

async function buyStoreItem(itemId, price, currentBalance) {
  if (currentBalance < price) {
    await w95alert("Você não tem LuizCoins™ suficientes para comprar este item!");
    return;
  }
  if (!await w95confirm(`Tem certeza que deseja gastar ${price} LuizCoins™ para comprar esse item?`)) return;

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
      await w95alert(`❌ Erro: ${data.error}`);
    }
  } catch (e) {
    await w95alert("Erro de conexão.");
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
// ─── Top 1 de cada jogo ─────────────────────────────────────────────────────
async function openTop1Rank() {
  openWindow("win-top1-rank");
  await loadTop1Rank();
}

async function loadTop1Rank() {
  const container = document.getElementById("top1-rank-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const data = await cachedFetchJSON("top1_all_games", `${API}/leaderboards/top1`, 60 * 1000);
    let html = "";
    for (const [game, byDiff] of Object.entries(data)) {
      const rows = Object.entries(byDiff);
      const hasDiffColumn = !(rows.length === 1 && rows[0][0] === "default");

      html += `<div class="section-label">${getGameLabel(game)}</div>`;
      html += `<table class="win95-table"><thead><tr>
        ${hasDiffColumn ? "<th>Dificuldade</th>" : ""}
        <th>Jogador</th><th>Pontuação</th><th>Data</th>
      </tr></thead><tbody>`;
      rows.forEach(([diff, entry]) => {
        const diffCell = hasDiffColumn ? `<td>${getDifficultyLabel(diff)}</td>` : "";
        if (!entry) {
          html += `<tr>${diffCell}<td class="no-data" colspan="3">Nenhum recorde ainda</td></tr>`;
        } else {
          const date = entry.date ? new Date(entry.date).toLocaleDateString("pt-BR") : "—";
          html += `<tr class="rank-gold">${diffCell}<td>${renderPlayerName(entry.name, true)}</td><td><strong>${formatGameScore(game, entry.score)}</strong></td><td>${date}</td></tr>`;
        }
      });
      html += `</tbody></table>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar ranking.</div>';
  }
}

// ─── Ranking de conquistas (top 10) ─────────────────────────────────────────
async function openAchievementsRank() {
  openWindow("win-achievements-rank");
  await loadAchievementsRank();
}

async function loadAchievementsRank() {
  const container = document.getElementById("achievements-rank-content");
  if (!container) return;
  container.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const data = await cachedFetchJSON("achievements_leaderboard", `${API}/leaderboards/achievements`, 60 * 1000);
    const { definitions, top } = data;
    const defById = Object.fromEntries(definitions.map((d) => [d.id, d]));

    let html = `<div class="section-label">🎖️ Top 10 — Mais Conquistas</div>`;
    if (top.length === 0) {
      html += '<div class="no-data">Nenhuma conquista desbloqueada ainda.</div>';
    } else {
      html += `<table class="win95-table"><thead><tr>
        <th>#</th><th>Jogador</th><th>Qtd</th><th>Conquistas</th>
      </tr></thead><tbody>`;
      top.forEach((entry, i) => {
        const medalClass = i === 0 ? "rank-gold" : i === 1 ? "rank-silver" : i === 2 ? "rank-bronze" : "";
        const badgeSpans = entry.achievements
          .map((id) => defById[id])
          .filter(Boolean)
          .map((def) => `<span title="${escHtml(def.title)}">${def.icon}</span>`)
          .join("");
        const badges = `<div class="achv-badges-wrap">${badgeSpans}</div>`;
        html += `<tr class="${medalClass}"><td>${i + 1}º</td><td>${renderPlayerName(entry.name, true)}</td><td><strong>${entry.count}</strong></td><td class="achv-rank-badges">${badges}</td></tr>`;
      });
      html += `</tbody></table>`;
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div class="loading">Erro ao carregar ranking.</div>';
  }
}

async function openAchievements() {
  if (!currentUser) {
    await w95alert("Você precisa fazer login para ver suas conquistas.");
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
      await w95alert(`❌ ${data.error}`);
    }
  } catch {
    await w95alert("Erro de conexão.");
  }
}

// ─── Perfil (cor, conquista, emoji, papel de parede) ─────────────────────────
let currentProfileTab = "color";
let profileColorData = null;
let profileAchievementData = null;
let profileEmojiData = null;
let profileFontData = null;

async function openProfileWindow() {
  if (!currentUser) {
    await w95alert("Você precisa fazer login para personalizar seu perfil.");
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
  ["color", "achievement", "emoji", "font", "wallpaper"].forEach((t) => {
    document.getElementById(`profile-tab-${t}`).style.display = t === tab ? "block" : "none";
  });
  loadProfileTabData(tab);
}

function loadProfileTabData(tab) {
  if (tab === "color") loadProfileColor();
  else if (tab === "achievement") loadProfileAchievement();
  else if (tab === "emoji") loadProfileEmoji();
  else if (tab === "font") loadProfileFont();
  else if (tab === "wallpaper") loadProfileWallpaper();
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
  const ownedColors = [
    ...profileColorData.items.filter(
      (i) => i.type === "namecolor" && profileColorData.purchases.includes(i.id),
    ),
    ...(profileColorData.exclusiveColors || []),
  ];
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
    case "color_safira":    return "text-shadow:0 0 4px #64b5f6; font-weight:bold;";
    case "color_rubi":      return "text-shadow:0 0 4px #ff5252; font-weight:bold;";
    case "color_ametista":  return "text-shadow:0 0 4px #ce93d8; font-weight:bold;";
    case "color_dourado":   return "font-weight:bold;";
    case "color_topazio":   return "text-shadow:0 0 4px #ff5722; font-weight:bold;";
    case "color_diamante":  return "font-weight:bold;";
    case "color_platina":   return "font-weight:bold;";
    case "color_coracao":   return "text-shadow:0 0 4px #ff1744; font-weight:bold;";
    case "color_fogo":      return "text-shadow:0 0 4px #ff6d00; font-weight:bold;";
    case "color_agua":      return "text-shadow:0 0 4px #0288d1; font-weight:bold;";
    case "color_terra":     return "text-shadow:0 0 4px #6d4c41; font-weight:bold;";
    case "color_ar":        return "text-shadow:0 0 4px #80deea; font-weight:bold;";
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

// ─── Fontes de ranking ────────────────────────────────────────────────────────
async function loadProfileFont() {
  const result = document.getElementById("profile-font-result");
  const msg = document.getElementById("profile-font-msg");
  result.innerHTML = '<div class="loading">⏳ Carregando...</div>';
  try {
    const res = await fetch(`${API}/profile/font`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    profileFontData = data;
    renderProfileFont();
  } catch (e) {
    showMsg(msg, `Erro: ${e.message}`, "err");
  }
}

function renderProfileFont() {
  if (!profileFontData) return;
  const { owned, active, nextPrice, catalog } = profileFontData;

  let html = "";
  if (owned.length > 0) {
    html += `<div class="info-box" style="margin-bottom:8px">Fontes compradas: ${owned.length} — próxima custa <strong>${nextPrice} LuizCoins</strong></div>`;
  }

  html += `<div style="display:flex;flex-direction:column;gap:6px">`;

  const padrao = !active;
  html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid #c0c0c0;background:${padrao ? "#d4e8d4" : "#fff"}">
    <span style="font-size:13px">Padrão</span>
    <button class="win95-action-btn" style="font-size:11px" onclick="selectProfileFont(null)">${padrao ? "✓ Ativa" : "Usar"}</button>
  </div>`;

  catalog.forEach((f) => {
    const isOwned = owned.includes(f.id);
    const isActive = active === f.id;
    const family = getFontFamily(f.id);
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid #c0c0c0;background:${isActive ? "#d4e8d4" : "#fff"}">
      <span style="font-family:${family};font-size:15px;font-weight:bold">${escHtml(f.label)}</span>
      ${isOwned
        ? `<button class="win95-action-btn" style="font-size:11px" onclick="selectProfileFont('${f.id}')">${isActive ? "✓ Ativa" : "Usar"}</button>`
        : `<button class="win95-action-btn" style="font-size:11px" onclick="buyProfileFont('${f.id}')">🛒 ${nextPrice} LC</button>`
      }
    </div>`;
  });

  html += `</div>`;

  ["profile", "store"].forEach((ctx) => {
    const el = document.getElementById(`${ctx}-font-result`);
    if (el) el.innerHTML = html;
  });
}

async function selectProfileFont(fontId) {
  const msg = document.getElementById("profile-font-msg");
  showLoading("Atualizando fonte...");
  try {
    const res = await fetch(`${API}/profile/font/set-active`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ fontId: fontId || null }),
    });
    const data = await res.json();
    if (res.ok) {
      profileFontData.active = fontId || null;
      renderProfileFont();
      showMsg(msg, "✅ Fonte atualizada.", "ok");
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

async function buyProfileFont(fontId) {
  const msg = document.getElementById("profile-font-msg");
  showLoading("Comprando fonte...");
  try {
    const res = await fetch(`${API}/profile/font/buy`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ fontId }),
    });
    const data = await res.json();
    if (res.ok) {
      profileFontData.owned = data.owned;
      profileFontData.nextPrice = data.nextPrice;
      profileFontData.active = profileFontData.active || fontId;
      renderProfileFont();
      showMsg(msg, `✅ Fonte comprada por ${data.pricePaid} LuizCoins!`, "ok");
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
  "😀 Carinhas": [
    "😀","😁","😂","🤣","😊","😍","😘","😜","🤔","😎","🥳","😭","😡","🥺","😴","🤯","🤩","😇","🙄","😬","🤗","🥶","🤤","🫡",
    "😆","😅","🤨","😐","😑","😏","😒","😔","😪","🥱","😤","😠","🤬","😈","👿","💩","👹","👺","👻","👽","🤖","🥸","🤥","🤫",
    "🤭","🫢","🫣","🫠","🥹","😶","😮","😲","😳","🥵","😱","😨","😰","😓","🤧","🤒","🤕","🥴","😵","🫶","🤙","✌️","🤞","🖖",
  ],
  "🐶 Animais": [
    "🐶","🐱","🦊","🐻","🐼","🐨","🦁","🐯","🐸","🐵","🐔","🐧","🦄","🐢","🐍","🦈","🐙","🦋","🐝","🦂","🐲","🦖","🐳","🦔",
    "🐺","🐗","🦝","🦡","🦦","🦥","🦘","🐴","🦌","🐮","🐷","🐑","🦙","🦒","🦓","🦏","🦛","🐘","🐭","🐹","🐰","🦔","🐓","🦃",
    "🦤","🦚","🦜","🦢","🦩","🕊️","🦅","🦆","🐊","🦎","🐉","🦕","🦗","🦟","🐛","🐌","🐜","🐞","🦠","🐠","🐡","🐬","🦭","🦑",
  ],
  "🍕 Comida": [
    "🍕","🍔","🌮","🍣","🍩","🍪","🍰","🍫","🍿","🍉","🍎","🍌","🥑","🌶️","🍺","☕","🧃","🍷","🥩","🍦","🍇","🍓","🥨","🍙",
    "🌯","🥪","🥗","🍜","🍝","🍲","🥘","🥣","🍛","🍱","🍤","🍗","🍖","🥓","🧆","🥚","🍳","🧇","🥞","🧈","🍞","🥐","🥖","🧁",
    "🎂","🍮","🍭","🍬","🍡","🧋","🍵","🫖","🍶","🥂","🍸","🍹","🥃","🍾","🧊","🫙","🍯","🧂","🫒","🥜","🌰","🥝","🍑","🍒",
  ],
  "⚽ Esportes": [
    "⚽","🏀","🏈","🎮","🎲","🎸","🎯","🏆","🥇","🎳","🏓","🥊","🛹","🎤","🎨","🏁","🎰","♟️","🎢","🪂","🏄","⛳","🎾","🏸",
    "🥋","⛷️","🏂","🏋️","🤺","🤾","🏇","🧘","🧗","🚵","🏊","🤽","🚣","🛷","🥌","🎿","⛸️","🪃","🎣","🤿","🥅","🎱","🏒","🏑",
    "🏏","🥍","🎽","🥈","🥉","🎖️","🏅","🎗️","🎫","🎟️","🎪","🎻","🥁","🪘","🎷","🎺","🪗","🎬","🎥","📽️","🎦","🕹️","👾","🃏",
  ],
  "🚗 Viagens": [
    "🚗","✈️","🚲","🏖️","🗽","🌋","🏔️","🛸","⛵","🚂","🏰","🗿","🌍","🚁","🛺","🏕️","🎡","🛶","🚤","🚓","🛵","🚆","🌉","🚕",
    "🚙","🛻","🚌","🏎️","🚑","🚒","🚚","🚜","🛴","🏍️","⚓","🗺️","🧭","🏜️","🏝️","🌄","🌅","🌃","🌆","🌇","🌌","🏙️","🌁","⛩️",
    "🕌","⛪","🏛️","🏗️","🏘️","🏠","🏡","🏢","🏣","🏤","🏥","🏦","🏧","🏨","🏩","🏪","🏫","🏬","🌐","🗼","🗻","🏟️","🛤️","🛣️",
  ],
  "🌿 Natureza": [
    "🌸","🌺","🌻","🌹","🌷","💐","🌿","🍃","🍀","🌱","🌲","🌳","🌴","🎋","🎍","🍁","🍂","🍄","🌾","🪸","🌊","🌬️","🌪️","🌈",
    "⭐","🌟","💫","✨","☄️","🌙","🌛","🌜","🌚","🌝","🌞","🪐","🌍","🌌","🌠","🌤️","⛅","🌥️","☁️","🌦️","🌧️","⛈️","🌩️","🌨️",
    "❄️","☃️","⛄","💨","🌫️","🌀","☔","⛱️","⚡","💧","🔥","🌊","🍃","🪨","🌵","🎄","🪴","🪵","🌏","🌎","🌑","🌒","🌓","🌔",
  ],
  "💎 Objetos": [
    "💎","👑","💰","🎁","🔮","🗝️","💣","🧨","🪄","⚔️","🛡️","🎩","💀","🧿","🪙","📿","🧰","🔱","🎭","🪬","🧲","💡","🔦","🕯️",
    "🪔","🔭","🔬","⚗️","🧪","💊","💉","🩺","🩹","🧬","⚙️","🔧","🔨","⛏️","🪛","🔩","🗜️","🪚","🔑","🔐","🔒","🔓","🚪","🪞",
    "🛋️","🪑","🧹","🧺","🧻","🧼","🪣","🧽","🪤","🛒","🎀","📦","✉️","📱","💻","🖥️","⌨️","🖱️","📷","📸","📹","🎙️","📡","🔋",
  ],
  "❤️ Símbolos": [
    "❤️","💜","💙","💚","🧡","💛","🖤","🤍","💯","✅","❌","⚡","✨","☀️","🌙","🌈","♻️","☢️","☣️","♾️","🔱","🆗","🔰","🎵",
    "💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","☮️","🕉️","☯️","✝️","☦️","🛐","⛎","♈","♉","♊","♋","♌","♍","♎",
    "♏","♐","♑","♒","♓","🆔","📛","🔞","🔃","🔄","🔙","🔚","🔛","🔜","🔝","⏫","⏬","⏩","⏪","⏭️","⏮️","🔔","🔕","🎵",
  ],
  "🏳️ Bandeiras": [
    "🏳️","🏴","🏁","🚩","🏳️‍🌈","🇧🇷","🇺🇸","🇯🇵","🇩🇪","🇫🇷","🇬🇧","🇪🇸","🇮🇹","🇵🇹","🇦🇷","🇨🇦","🇲🇽","🇰🇷","🇨🇳","🇷🇺",
    "🇦🇺","🇳🇱","🇸🇪","🇨🇭","🇳🇴","🇩🇰","🇫🇮","🇮🇳","🇿🇦","🇳🇬","🇪🇬","🇸🇦","🇹🇷","🇵🇱","🇺🇦","🇨🇴","🇵🇪","🇻🇪","🇨🇱","🇨🇺",
  ],
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
        sudoku_easy: { title: "Aprendiz dos Números", icon: "🔢" },
        sudoku_medium: { title: "Mestre dos Números", icon: "🧮" },
        sudoku_hard: { title: "Gênio dos Números", icon: "🧠" },
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
    version: "2.9.0",
    date: "18/07/2026",
    isNew: true,
    title: "Sugestões & Bugs virou Tickets 📬",
    items: [
      "📬 \"Sugestões & Bugs\" foi renomeado para \"Tickets\" (ícone, menu, título da janela e aba do painel Admin).",
      "📋 Botão para copiar o texto de cada ticket com um clique.",
      "📋 Painel Admin: botão para copiar a senha temporária de cada jogador, sem precisar selecionar o texto manualmente.",
    ],
  },
  {
    version: "2.8.1",
    date: "18/07/2026",
    isNew: false,
    title: "Polish visual: janelas, som e cursor 🪟🔊",
    items: [
      "🪟 Janelas agora abrem e fecham com uma transição suave (fade + zoom), em vez de aparecer/sumir seco.",
      "🔊 Clique mecânico (clack) estilo computador antigo ao abrir/fechar janelas, pastas e o Menu Iniciar.",
      "⏳ O cursor do mouse vira ampulheta durante carregamentos, além do ícone de loading na tela.",
    ],
  },
  {
    version: "2.8.0",
    date: "18/07/2026",
    isNew: false,
    title: "Visão \"Todos os Aplicativos\" 🗂️",
    items: [
      "▦ Novo botão na barra de tarefas alterna entre o Desktop clássico (pastas) e uma grade com todos os aplicativos lado a lado — mais fácil de descobrir apps escondidos nas pastas.",
      "📱 No celular, a grade de aplicativos agora abre por padrão em vez das pastas, como um menu de apps de celular. O botão continua disponível para quem preferir o Desktop clássico.",
      "🐛 Corrigido: o plano de fundo sumia ao abrir a grade de aplicativos.",
    ],
  },
  {
    version: "2.7.0",
    date: "14/07/2026",
    isNew: false,
    title: "Aim Trainer com ranking separado por plataforma 🎯📱🖥️",
    items: [
      "📱🖥️ Ranking do Aim Trainer agora é separado: jogadores no celular (toque) competem entre si, e jogadores no desktop (mouse) competem entre si.",
      "🖥️ No desktop, o canvas do Aim Trainer tem tamanho fixo (560×400px) — sem vantagem por ter tela menor.",
      "🏆 Novas conquistas exclusivas para o Aim Trainer Desktop: 'Mira afiada (Desktop)' e 'Lenda da mira (Desktop)'.",
      "🏅 Conquistas do Aim Trainer Mobile renomeadas para deixar claro a plataforma.",
      "📜 Scores antigos migrados automaticamente para o ranking Mobile (não havia como saber a plataforma original).",
      "🐛 Menu Iniciar no mobile não tinha mais scroll infinito após o último item.",
      "🐛 Wallpaper não ficava mais cortado na parte de baixo no mobile.",
      "🐛 Botões de aba no Ranking não sumiam mais no mobile.",
    ],
  },
  {
    version: "2.6.0",
    date: "13/07/2026",
    isNew: false,
    title: "LuizFarm melhorado e Luiz21 revisado 🌾🃏",
    items: [
      "🌾 Murcha graduada no LuizFarm: agora as plantas passam por 3 fases — pronta (100%), murchando (75% do valor) e murchou (0%). Você tem o triplo do tempo de crescimento antes de perder tudo!",
      "⚡ Plantar em Todos e Colher em Todos agora usam uma única requisição ao servidor — muito mais rápidos.",
      "✨ UI otimista no plantio: a parcela aparece imediatamente ao plantar, sem esperar o servidor confirmar.",
      "📱 LuizFarm corrigido no mobile: parcelas menores e layout empilhado em telas pequenas.",
      "🍓 Sementes premium na loja: Morango (1h), Laranja (12h) e Abacaxi (3 dias) desbloqueáveis por LuizCoins™.",
      "🃏 Luiz21: aposta agora precisa ser escolhida antes de cada mão. Fichas ficam bloqueadas durante o jogo.",
    ],
  },
  {
    version: "2.5.0",
    date: "12/07/2026",
    isNew: false,
    title: "Site compatível com celular 📱",
    items: [
      "📱 O LuizOS 95 agora funciona no celular! Todas as janelas se adaptam à tela pequena, o menu Iniciar vira scrollável, os ícones do desktop e das pastas respondem ao toque e as janelas abrem centradas automaticamente.",
      "📋 Taskbar comprimida no mobile: a lista de apps abertos some para dar espaço, botões ficam maiores para toque.",
      "🔒 Painel Admin adaptado: as 7 abas agora quebram em duas linhas no celular para ficarem todas acessíveis.",
      "🏪 Loja reorganizada em 2 colunas no celular (era 3).",
      "🖱️ Janelas podem ser arrastadas pelo título usando o dedo — drag por touch.",
    ],
  },
  {
    version: "2.4.0",
    date: "10/07/2026",
    isNew: false,
    title: "Nova conquista, emojis únicos e picker completo",
    items: [
      "🤡 Nova conquista: Antividente — desbloqueada para quem faz a pior aposta do dia (maior erro) quando há 2 ou mais apostas válidas.",
      "🎯 Todas as conquistas agora têm emojis únicos — Detonador especialista virou 💥, Lenda do Spider 🕸️, A casa perdeu 🎰, Estrategista do Spider 🧩 e Pura estratégia ♟️.",
      "🙂 Seletor de emojis completamente expandido: de ~190 para ~550 emojis disponíveis, com nova categoria 🌿 Natureza (plantas, clima, céu) e categorias existentes triplicadas.",
      "✏️ Conquista 'Sortuda de iniciante' renomeada para 'Sorte de principiante'.",
    ],
  },
  {
    version: "2.3.0",
    date: "10/07/2026",
    isNew: true,
    title: "LuizFarm melhorado, fonte Minecraft e polimentos visuais",
    items: [
      "🌾 LuizFarm: botões 'Plantar em Todos' e 'Colher em Todos' — selecione uma semente e plante todas as parcelas vazias com um clique, ou colha tudo de uma vez!",
      "⛏️ Nova fonte comprável: Minecraft — disponível na Loja por 25 LC (ou preço escalonado, se já tiver outras fontes).",
      "💗 Título Coração ganhou gradiente rosa deslizante e pulso de brilho, mantendo os corações animados ao lado do nome.",
      "📐 Fontes de nome agora ocupam o mesmo espaço no ranking — Press Start 2P, Impact e outras não aumentam mais a altura das linhas.",
      "🔧 Fix: fonte de nome agora aparece corretamente no ranking principal (antes só aparecia no ranking de jogos).",
      "🎖️ Ranking de Conquistas com badges maiores e melhor organização visual.",
      "🏹 Conquista 'Lenda da mira' ganhou emoji exclusivo (arco e flecha).",
    ],
  },
  {
    version: "2.2.0",
    date: "09/07/2026",
    isNew: true,
    title: "Sugestões, fontes de nome e novos títulos elementais",
    items: [
      "📬 Novo app: Sugestões & Bugs! Reporte problemas ou sugira funcionalidades — tudo vai parar num board público visível a todos. O admin pode responder e marcar cada pedido como aprovado, rejeitado ou implementado.",
      "🔤 Compre fontes para o seu nome nos rankings! Comic Sans, Impact, Courier New, Georgia, Lobster, Press Start 2P, Pacifico e Dancing Script — primeira por 25 LC, cada nova custa 25 LC a mais. Ative na aba Fonte do Perfil.",
      "🔥💧🌍🌬️ 4 novos títulos elementais por 500 LC cada: Fogo (gradiente chama com cintilação), Água (onda profunda), Terra (pulso terroso) e Ar (shimmer ultrarrápido).",
      "✨ Topázio ganhou animação de brasa pulsante e ficou mais avermelhado.",
      "⚪ Platina agora também pulsa além do sweep metálico.",
      "🛒 Preview na Loja agora mostra a animação real de cada título — nada de \"Seu nome\" estático.",
      "🃏 LuizJack 21 agora se chama Luiz21.",
    ],
  },
  {
    version: "2.1.0",
    date: "08/07/2026",
    isNew: false,
    title: "Luiz21 — Blackjack no cassino",
    items: [
      "🃏 Novo jogo: LuizJack 21! Jogue blackjack contra a mesa com visual cassino (feltro verde, fichas, cartas) dentro do shell Windows 95.",
      "💰 Três níveis de aposta: Baixa (5 LC), Média (15 LC) e Alta (30 LC). Blackjack natural paga 1,5×.",
      "🏆 Limite de 100 LuizCoins™ por dia — quando atingido, o jogo é bloqueado até meia-noite.",
      "🎖️ 5 novas conquistas exclusivas do LuizJack: Sortuda de iniciante, Natural!, High Roller, Em chamas e A casa perdeu.",
      "📊 Ranking dos Jogos: nova aba 🃏 LuizJack mostrando os maiores ganhadores de todos os tempos.",
      "⚖️ Prêmios da LuizFarm reduzidos em ~30% para equilibrar a economia de LuizCoins™.",
    ],
  },
  {
    version: "2.0.0",
    date: "04/07/2026",
    isNew: false,
    title: "LuizFarm 95 e diálogos Win95",
    items: [
      "🌾 Novo jogo: LuizFarm 95! Compre sementes com LuizCoins™, plante na sua fazenda e volte mais tarde para colher — Milho (2h), Tomate (6h), Abóbora (24h) ou Uva (48h). Cada parcela desbloqueia com o tempo; comece com 3 grátis.",
      "⚠️ Plante com estratégia: planta que não for colhida em 2× o tempo de crescimento murcha e você perde a colheita.",
      "🔒 Parcelas extras (6 no total) podem ser desbloqueadas por LuizCoins™.",
      "🖼️ Diálogos de confirmação e erro agora são estilizados no visual Windows 95 — chega de pop-up feio do navegador.",
    ],
  },
  {
    version: "1.9.3",
    date: "03/07/2026",
    isNew: false,
    title: "Novos wallpapers e ranking renovado",
    items: [
      "🖼️ Wallpapers do Windows e Michaelsoft atualizados com imagens novas — veja no Perfil > Plano de fundo ou clique com o botão direito na área de trabalho.",
      "🎮 Ranking dos Jogos reformulado: agora tem 5 tabs (um por jogo) e mostra todas as dificuldades na mesma tela, sem precisar trocar de aba.",
    ],
  },
  {
    version: "1.9.2",
    date: "03/07/2026",
    isNew: false,
    title: "Aim Trainer: hitmarkers, dificuldade ajustada e correções",
    items: [
      "💥 Hitmarker animado ao clicar: X branco para acertos e X vermelho para erros, igual a jogos FPS — agora dá pra ver exatamente o que aconteceu em cada clique.",
      "🎯 Dificuldade Difícil levemente suavizada (alvo maior e um pouco mais de tempo) — ainda desafiadora, mas jogável.",
      "🐛 Corrida (race condition): cliques que chegavam no exato momento em que o alvo expirava eram contados como erro indevidamente. Corrigido.",
      "🖱️ Duplo clique não penaliza mais a pontuação — o segundo evento disparado pelo sistema era tratado como clique extra, gerando erro fantasma.",
      "🕷️ Paciência Spider: a última distribuição do monte às vezes não distribuía as cartas quando havia colunas vazias. Corrigido.",
    ],
  },
  {
    version: "1.9.1",
    date: "01/07/2026",
    isNew: false,
    title: "Aim Trainer: sensibilidade de mira e cliques mais justos",
    items: [
      "🎯 Novo ajuste de sensibilidade no Aim Trainer: ao iniciar, o mouse trava (igual num FPS) e um slider na janela controla o quanto o cursor movimenta a mira. Esc solta o mouse e encerra a rodada.",
      "🤏 Cliques bem na borda do alvo agora têm uma pequena margem de tolerância, evitando aquela sensação de injustiça quando o clique 'quase' acertava.",
    ],
  },
  {
    version: "1.9.0",
    date: "28/06/2026",
    isNew: false,
    title: "Novo minigame: Aim Trainer 🔫",
    items: [
      "🔫 Novo minigame Aim Trainer: clique nos alvos antes que encolham e desapareçam. Acertos rápidos e em sequência (combo) valem mais pontos.",
      "🎯 3 dificuldades (Fácil/Normal/Difícil) com ranking, moedas e conquistas próprios, igual aos outros jogos.",
      "⌨️ Dá pra iniciar a partida com a barra de espaço, além do botão.",
    ],
  },
  {
    version: "1.8.0",
    date: "28/06/2026",
    isNew: false,
    title: "Spider: dicas sem limite, desfazer e zoom mais preciso",
    items: [
      "💡 Removido o limite máximo de dicas no Spider em todos os modos — use quantas precisar (mas vencer sem usar nenhuma ainda desbloqueia uma conquista diferente).",
      "↩️ Novo botão \"Desfazer\" no Spider: volta a última jogada (só 1 nível, não dá pra voltar mais de uma).",
      "💎 Nova conquista \"Vitória impecável\": vença uma partida sem usar dica nem desfazer.",
      "🔍 Pequeno ajuste de folga no zoom das janelas maximizadas, evitando sobreposição residual do conteúdo ampliado.",
    ],
  },
  {
    version: "1.7.0",
    date: "27/06/2026",
    isNew: false,
    title: "Recuperação de senha e cadastro mais claro",
    items: [
      "🔄 Novo \"Esqueci minha senha\" na tela de login: reseta a senha para uma temporária (gerenciada pelo admin) e exige a troca por uma nova no primeiro login.",
      "🔑 Painel admin ganhou a aba \"Senhas temporárias\", onde o admin vê e repassa particularmente as senhas geradas pelos resets.",
      "👤 Tela de login agora tem um link direto para criar uma conta nova, no lugar da opção de visitante.",
      "🔒 Tela de cadastro avisa que a senha é armazenada de forma criptografada, mas recomenda uma senha exclusiva para este site.",
    ],
  },
  {
    version: "1.6.0",
    date: "27/06/2026",
    isNew: false,
    title: "Janelas maximizáveis e zoom nos jogos",
    items: [
      "🗖 Todas as janelas agora têm um botão de maximizar na barra de título, ocupando toda a área útil da tela.",
      "🔍 Nos jogos (Snake, Campo Minado, Sudoku e Paciência Spider), maximizar também amplia o tabuleiro/cartas (zoom), em vez de só deixar espaço vazio em volta — ótimo para quem joga em telas grandes ou quer aliviar a vista.",
    ],
  },
  {
    version: "1.5.0",
    date: "27/06/2026",
    isNew: false,
    title: "Novo minigame: Paciência Spider",
    items: [
      "🕷️ Novo minigame Paciência Spider, com 3 dificuldades (1, 2 ou 4 naipes), ranking próprio e LuizCoins por vitória.",
      "💡 Sistema de dicas no Spider: até 10 dicas no fácil, 5 no médio e 3 no difícil — cada uma sugere a melhor jogada disponível no momento.",
      "🏅 6 novas conquistas do Spider: uma por dificuldade completada, mais \"Pura estratégia\" (vencer sem usar dica) e \"Com uma ajudinha\" (vencer usando ao menos uma).",
      "😵 O Spider agora detecta quando não há mais jogadas possíveis e encerra a partida automaticamente, em vez de deixar o jogador travado sem aviso.",
      "🔢 Sudoku: ranking dos jogos agora tem abas próprias por dificuldade ao lado do Spider.",
    ],
  },
  {
    version: "1.4.0",
    date: "27/06/2026",
    isNew: false,
    title: "Luiz de Placa: dobre seus pontos uma vez por semana",
    items: [
      "🏆 Novo boost \"Luiz de Placa\": ative o checkbox antes de apostar e ganhe o dobro de LuizCoins pela aposta do dia. Disponível 1 vez por semana para cada jogador.",
      "📋 Apostas com o boost ativado aparecem com uma marquinha 🏆 nas tabelas de apostas e rankings.",
      "🔢 Correção: janela do Sudoku abria mal posicionada (e cortada em monitores pequenos) e os botões numéricos ficavam cortados pela borda da janela.",
      "🖥️ Correção: ícones da área de trabalho podiam ficar sobrepostos uns aos outros (ou sobre a barra de tarefas) após a adição de novos apps; agora se reorganizam automaticamente numa grade sem sobreposição.",
    ],
  },
  {
    version: "1.3.0",
    date: "27/06/2026",
    isNew: false,
    title: "Economia rebalanceada: loja mais acessível e mais justa",
    items: [
      "🛒 Preços da loja recalibrados — gifs, Esmeralda e Rubi ficam acessíveis em poucos dias; Dourada em menos de 1 mês; Diamante (2,5x o preço da Dourada) em menos de 2 meses, em vez de praticamente inalcançável.",
      "🙂 Primeiro emoji de ranking caiu de 500 para 125 LuizCoins (cada novo continua subindo 125).",
      "🔒 Correção importante: o preço pago agora é \"congelado\" na hora da compra (loja e emoji) — mudar o preço de um item no futuro não altera mais retroativamente o saldo de quem já comprou.",
      "🎮 Novo teto diário de 20 LuizCoins ganhos em minigames (Snake/Campo Minado), já que não há cooldown entre partidas.",
      "🐍 Curva de pontos do Snake achatada nos scores fáceis (200-300 pontos): recompensa cheia agora exige chegar nos 500 pontos da conquista.",
      "🚫 Removido o bônus automático de 125 LuizCoins que todo cadastro novo recebia (saldo de quem já tinha não foi alterado).",
      "📊 Painel admin: botão para consultar o saldo de todos os jogadores de uma vez.",
      "🏷️ Loja: itens já comprados agora mostram quanto custam hoje, mesmo depois de desbloqueados.",
      "📐 Regras de Pontuação agora abre com uma explicação simples por padrão, com os detalhes técnicos escondidos atrás de um botão.",
    ],
  },
  {
    version: "1.2.0",
    date: "27/06/2026",
    isNew: false,
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

// ─── Mobile / Touch Support ───────────────────────────────────────────────────

function isMobile() {
  return window.matchMedia("(max-width: 600px)").matches;
}

// Touch drag for window titlebars
(function initTouchDrag() {
  document.querySelectorAll(".win95-titlebar").forEach((tb) => {
    tb.addEventListener("touchstart", (e) => {
      if (e.target.closest(".win95-btn-ctrl")) return;
      const win = tb.closest(".win95-window");
      if (!win) return;
      bringToFront(win);
      const t = e.touches[0];
      drag = {
        el: win,
        startX: t.clientX - win.offsetLeft,
        startY: t.clientY - win.offsetTop,
        isWindow: true,
      };
      e.preventDefault();
    }, { passive: false });
  });
})();

document.addEventListener("touchmove", (e) => {
  if (!drag || !drag.isWindow) return;
  const t = e.touches[0];
  const x = Math.max(0, Math.min(t.clientX - drag.startX, window.innerWidth - drag.el.offsetWidth));
  const y = Math.max(0, Math.min(t.clientY - drag.startY, window.innerHeight - drag.el.offsetHeight - 34));
  drag.el.style.left = x + "px";
  drag.el.style.top = y + "px";
  e.preventDefault();
}, { passive: false });

document.addEventListener("touchend", () => { drag = null; });

// Desktop icons: single tap to open on mobile
document.querySelector(".desktop").addEventListener("click", (e) => {
  if (!isMobile()) return;
  const icon = e.target.closest(".desktop-icon");
  if (!icon) return;
  const action = icon.dataset.action;
  if (action) eval(action);
});

// Folder icons inside windows: single tap on mobile (ondblclick not fired by touch)
document.querySelectorAll(".folder-icon").forEach((fi) => {
  fi.addEventListener("click", () => {
    if (!isMobile()) return;
    const handler = fi.getAttribute("ondblclick");
    if (handler) eval(handler);
  });
});