// ==========================================
// ROLETA — Cassino com roda animada
// ==========================================

(function () {
  const style = document.createElement("style");
  style.textContent = `
    #roulette-root {
      background: radial-gradient(ellipse at center, #1e6b2e 0%, #0d3d18 100%);
      border: 4px solid #c9a227;
      min-height: 460px;
      font-family: 'Times New Roman', serif;
      display: flex;
      flex-direction: column;
      user-select: none;
    }
    .rl-topbar {
      background: rgba(0,0,0,0.45);
      border-bottom: 2px solid #c9a227;
      padding: 6px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      color: #f5e07a;
      letter-spacing: 0.5px;
    }
    .rl-topbar strong { color: #ffe066; font-size: 13px; }
    .rl-daily-bar { height: 5px; background: #1a3a10; border-radius: 3px; margin: 0 14px; overflow: hidden; }
    .rl-daily-fill { height: 100%; background: linear-gradient(to right, #f5c518, #e07b00); border-radius: 3px; transition: width 0.4s; }

    .rl-wheel-area { display: flex; flex-direction: column; align-items: center; padding: 14px 10px 6px; gap: 8px; }
    .rl-wheel-wrap { position: relative; width: 220px; height: 220px; }
    .rl-wheel {
      position: absolute; inset: 0; border-radius: 50%;
      border: 4px solid #c9a227;
      box-shadow: 0 4px 18px rgba(0,0,0,0.6), inset 0 0 20px rgba(0,0,0,0.4);
    }
    .rl-wheel-num {
      position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; margin: -10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.8);
      pointer-events: none;
    }
    .rl-pointer {
      position: absolute; top: -8px; left: 50%; transform: translateX(-50%);
      font-size: 20px; color: #ffe066; text-shadow: 0 2px 4px rgba(0,0,0,0.6); z-index: 5;
    }
    .rl-wheel-hub {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      width: 44px; height: 44px; border-radius: 50%;
      background: radial-gradient(circle, #e6c869, #a8841f);
      border: 2px solid #c9a227; display: flex; align-items: center; justify-content: center;
      font-size: 18px; box-shadow: 0 2px 8px rgba(0,0,0,0.5); z-index: 4;
    }

    .rl-history { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; max-width: 260px; }
    .rl-history-dot {
      width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 9px; font-weight: bold; color: #fff; border: 1px solid rgba(255,255,255,0.3);
    }
    .rl-dot-red   { background: #b5182b; }
    .rl-dot-black { background: #1a1a1a; }
    .rl-dot-green { background: #1a7a3c; }

    .rl-panel { background: rgba(0,0,0,0.4); border-top: 2px solid #c9a227; padding: 8px 14px 12px; display: flex; flex-direction: column; gap: 8px; }

    .rl-result { text-align: center; font-size: 14px; font-weight: bold; letter-spacing: 0.3px; padding: 4px 0 2px; min-height: 22px; }
    .rl-result-win  { color: #66ff88; }
    .rl-result-lose { color: #ff6655; }

    .rl-chip-row { display: flex; justify-content: center; gap: 14px; }
    .rl-chip {
      width: 50px; height: 50px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.5);
      cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: 'Times New Roman', serif; font-weight: bold; transition: transform 0.1s, box-shadow 0.1s;
      box-shadow: 0 3px 8px rgba(0,0,0,0.5); outline: none;
    }
    .rl-chip:hover  { transform: scale(1.08); }
    .rl-chip.active { transform: scale(1.14); box-shadow: 0 0 0 3px #ffe066, 0 3px 10px rgba(0,0,0,0.6); }
    .rl-chip-low    { background: radial-gradient(circle, #4488ff, #1144cc); color: #fff; }
    .rl-chip-medium { background: radial-gradient(circle, #ffcc44, #cc8800); color: #2a1800; }
    .rl-chip-high   { background: radial-gradient(circle, #ff5555, #aa1111); color: #fff; }
    .rl-chip-val    { font-size: 13px; line-height: 1; }
    .rl-chip-label  { font-size: 7px; letter-spacing: 0.5px; opacity: 0.85; }

    .rl-bet-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
    .rl-bet-btn {
      padding: 5px 2px; font-family: 'Times New Roman', serif; font-size: 10px; font-weight: bold;
      border: 1px solid #c9a227; border-radius: 3px; cursor: pointer; background: #0d3d18; color: #f5e07a;
      transition: filter 0.1s, transform 0.08s;
    }
    .rl-bet-btn:hover { filter: brightness(1.2); }
    .rl-bet-btn.active { background: #c9a227; color: #1a0f00; }

    .rl-number-grid { display: grid; grid-template-columns: repeat(9, 1fr); gap: 3px; max-height: 110px; overflow-y: auto; padding: 2px; }
    .rl-num-btn {
      aspect-ratio: 1; min-width: 20px; border: 1px solid rgba(255,255,255,0.25); border-radius: 3px;
      font-size: 9px; font-weight: bold; color: #fff; cursor: pointer;
    }
    .rl-num-red   { background: #b5182b; }
    .rl-num-black { background: #1a1a1a; }
    .rl-num-green { background: #1a7a3c; }
    .rl-num-btn.active { outline: 2px solid #ffe066; outline-offset: 1px; }

    .rl-action-row { display: flex; justify-content: center; }
    .rl-btn {
      padding: 7px 30px; font-family: 'Times New Roman', serif; font-size: 13px; font-weight: bold; letter-spacing: 0.5px;
      border: 2px solid #c9a227; border-radius: 4px; cursor: pointer; transition: filter 0.1s, transform 0.08s; min-width: 120px;
      background: #c9a227; color: #1a0f00;
    }
    .rl-btn:active { transform: scale(0.96); }
    .rl-btn:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }
    .rl-btn:hover:not(:disabled) { filter: brightness(1.15); }

    .rl-status-msg { text-align: center; font-size: 11px; color: #a8d8a8; min-height: 16px; }
    .rl-loading-row { display: flex; align-items: center; justify-content: center; gap: 7px; color: #a8d8a8; font-size: 11px; }
    .rl-spinner { width: 12px; height: 12px; border: 2px solid rgba(168,216,168,0.2); border-top-color: #a8d8a8; border-radius: 50%; animation: rl-spin 0.65s linear infinite; }
    @keyframes rl-spin { to { transform: rotate(360deg); } }

    .rl-blocked-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ffe066; font-size: 14px; text-align: center; gap: 8px; padding: 24px; }
    .rl-blocked-msg span { font-size: 36px; }
    .rl-login-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #a8d8a8; text-align: center; font-size: 13px; gap: 10px; padding: 24px; }
    .rl-login-msg span { font-size: 32px; }
  `;
  document.head.appendChild(style);
})();

// ─── Config (espelha api/routes/roulette.js — mudar lá exige mudar aqui) ──────
const EU_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const RL_DAILY_CAP = 250;
const RL_STAKE_LABELS = { low: "5", medium: "15", high: "30" };
const RL_PAYOUTS = { straight: 35, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1, dozen1: 2, dozen2: 2, dozen3: 2 };
const RL_BET_LABELS = {
  red: "🔴 Vermelho", black: "⚫ Preto", odd: "Ímpar", even: "Par",
  low: "1–18", high: "19–36", dozen1: "1ª Dúzia", dozen2: "2ª Dúzia", dozen3: "3ª Dúzia",
  straight: "🎯 Número",
};
const RL_SPIN_DURATION_MS = 3200;
const RL_WHEEL_LABEL_RADIUS = 86; // px do centro até o texto do número

function numberColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

// ─── State ──────────────────────────────────────────────────────────────────
let rlState = "idle"; // idle | spinning | result | blocked | loading | unauth
let rlBalance = 0;
let rlDailyEarned = 0;
let rlSelectedStake = null;
let rlSelectedBetType = null;
let rlSelectedNumber = null;
let rlBusy = false;
let rlHistory = [];
let rlLastResult = null;
let rlCurrentRotation = 0;

function openRouletteWindow() {
  openWindow("win-roulette");
  initRoulette();
}

async function initRoulette() {
  rlBusy = false;
  rlLastResult = null;
  rlState = "loading";
  renderRoulette();

  if (!sessionToken) {
    rlState = "unauth";
    renderRoulette();
    return;
  }

  try {
    const res = await fetch("/api/roulette/status", { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar.");

    rlBalance = data.balance;
    rlDailyEarned = data.dailyEarned;
    rlHistory = data.history || [];
    rlState = data.blocked ? "blocked" : "idle";
  } catch {
    rlState = "idle";
  }
  renderRoulette();
}

function selectRlStake(level) {
  if (rlState !== "idle" && rlState !== "result") return;
  rlSelectedStake = level;
  renderRoulette();
}

function selectRlBetType(type) {
  if (rlState !== "idle" && rlState !== "result") return;
  rlSelectedBetType = type;
  if (type !== "straight") rlSelectedNumber = null;
  renderRoulette();
}

function selectRlNumber(n) {
  if (rlState !== "idle" && rlState !== "result") return;
  rlSelectedBetType = "straight";
  rlSelectedNumber = n;
  renderRoulette();
}

async function spinRoulette() {
  if (rlBusy || rlState === "spinning" || rlState === "blocked") return;
  if (!rlSelectedStake || !rlSelectedBetType) return;
  if (rlSelectedBetType === "straight" && rlSelectedNumber === null) return;

  rlBusy = true;
  rlState = "spinning";
  renderRoulette();

  try {
    const res = await fetch("/api/roulette/spin", {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({
        betType: rlSelectedBetType,
        betAmount: rlSelectedStake,
        number: rlSelectedBetType === "straight" ? rlSelectedNumber : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      rlBusy = false;
      rlState = "idle";
      renderRoulette();
      showRlAlert(data.error || "Erro ao girar.");
      return;
    }

    spinWheelTo(data.winningNumber, RL_SPIN_DURATION_MS);

    setTimeout(() => {
      rlBalance = data.balance ?? rlBalance;
      rlDailyEarned = data.dailyEarned ?? rlDailyEarned;
      rlHistory = data.history || rlHistory;
      rlLastResult = {
        outcome: data.outcome, coinsWon: data.coinsWon, coinsLost: data.coinsLost,
        winningNumber: data.winningNumber, color: data.color,
      };
      rlState = data.blocked ? "blocked" : "result";
      rlBusy = false;

      if (data.coinsWon > 0) showGameCoinsToast(data.coinsWon);
      else if (data.coinsLost > 0) showGameCoinsToast(-data.coinsLost);
      if (data.newAchievements && data.newAchievements.length > 0)
        setTimeout(() => showAchievementToast(data.newAchievements), 1500);

      renderRoulette();
    }, RL_SPIN_DURATION_MS + 150);
  } catch (e) {
    rlBusy = false;
    rlState = "idle";
    renderRoulette();
    showRlAlert("Erro de conexão.");
  }
}

// ─── Roda (construída uma vez; girada via transform, nunca recriada) ────────
function buildWheelGradient() {
  const seg = 360 / 37;
  const colorMap = { red: "#b5182b", black: "#1a1a1a", green: "#1a7a3c" };
  const stops = EU_WHEEL_ORDER.map((num, i) => {
    const start = (i * seg).toFixed(3);
    const end = ((i + 1) * seg).toFixed(3);
    return `${colorMap[numberColor(num)]} ${start}deg ${end}deg`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function buildWheelLabels() {
  const seg = 360 / 37;
  return EU_WHEEL_ORDER.map((num, i) => {
    const center = i * seg + seg / 2;
    return `<span class="rl-wheel-num" style="transform: rotate(${center.toFixed(3)}deg) translateY(-${RL_WHEEL_LABEL_RADIUS}px)">${num}</span>`;
  }).join("");
}

function ensureRouletteSkeleton() {
  const root = document.getElementById("roulette-root");
  if (!root || root.querySelector(".rl-wheel")) return;
  root.innerHTML = `
    <div class="rl-topbar" id="rl-topbar"></div>
    <div class="rl-daily-bar"><div class="rl-daily-fill" id="rl-daily-fill"></div></div>
    <div class="rl-wheel-area">
      <div class="rl-wheel-wrap">
        <div class="rl-pointer">▼</div>
        <div class="rl-wheel" id="rl-wheel">${buildWheelLabels()}</div>
        <div class="rl-wheel-hub">🎡</div>
      </div>
      <div class="rl-history" id="rl-history"></div>
    </div>
    <div class="rl-panel" id="rl-panel"></div>
  `;
  document.getElementById("rl-wheel").style.background = buildWheelGradient();
}

// Gira o disco (fundo + números, que são filhos do mesmo elemento) até o
// número sorteado ficar embaixo do ponteiro fixo no topo (0deg).
function spinWheelTo(winningNumber, durationMs) {
  const wheelEl = document.getElementById("rl-wheel");
  if (!wheelEl) return;
  const seg = 360 / 37;
  const idx = EU_WHEEL_ORDER.indexOf(winningNumber);
  const targetCenter = idx * seg + seg / 2;
  const spins = 6;
  const base = Math.ceil(rlCurrentRotation / 360) * 360; // sempre gira pra frente
  const finalRotation = base + spins * 360 + (360 - targetCenter);
  rlCurrentRotation = finalRotation;
  wheelEl.style.transition = `transform ${durationMs}ms cubic-bezier(0.17, 0.67, 0.09, 1)`;
  wheelEl.style.transform = `rotate(${finalRotation}deg)`;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function buildNumberGrid() {
  let html = "";
  for (let n = 0; n <= 36; n++) {
    const color = numberColor(n);
    const active = rlSelectedBetType === "straight" && rlSelectedNumber === n ? " active" : "";
    html += `<button class="rl-num-btn rl-num-${color}${active}" onclick="selectRlNumber(${n})">${n}</button>`;
  }
  return html;
}

function renderRlPanel() {
  const isSpinning = rlState === "spinning";
  const isResult = rlState === "result";
  const canBet = !isSpinning;
  const betReady = !!(rlSelectedStake && rlSelectedBetType && (rlSelectedBetType !== "straight" || rlSelectedNumber !== null));

  let resultHtml = `<div class="rl-result"></div>`;
  if (isResult && rlLastResult) {
    const { outcome, coinsWon, coinsLost, winningNumber, color } = rlLastResult;
    const colorLabel = color === "red" ? "Vermelho" : color === "black" ? "Preto" : "Verde";
    resultHtml = outcome === "win"
      ? `<div class="rl-result rl-result-win">🎉 Caiu ${winningNumber} (${colorLabel})! +${coinsWon} LuizCoins™</div>`
      : `<div class="rl-result rl-result-lose">Caiu ${winningNumber} (${colorLabel}). -${coinsLost} LuizCoins™</div>`;
  }

  const betTypeButtons = ["red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3", "straight"]
    .map((t) => `<button class="rl-bet-btn${rlSelectedBetType === t ? " active" : ""}" onclick="selectRlBetType('${t}')">${RL_BET_LABELS[t]}</button>`)
    .join("");

  let statusMsg;
  if (isSpinning) {
    statusMsg = `<div class="rl-loading-row"><div class="rl-spinner"></div> A bolinha está rodando...</div>`;
  } else if (!betReady) {
    statusMsg = `<span style="color:#f5c518">⬆ Escolha ficha e aposta pra girar</span>`;
  } else {
    const numSuffix = rlSelectedBetType === "straight" && rlSelectedNumber !== null ? ` ${rlSelectedNumber}` : "";
    statusMsg = `Aposta: <strong style="color:#ffe066">${RL_STAKE_LABELS[rlSelectedStake]} LC</strong> em ${RL_BET_LABELS[rlSelectedBetType]}${numSuffix} · paga ${RL_PAYOUTS[rlSelectedBetType]}x`;
  }

  return `
    ${resultHtml}
    <div class="rl-chip-row" style="${!canBet ? "opacity:0.38;pointer-events:none" : ""}">
      <button class="rl-chip rl-chip-low    ${rlSelectedStake === "low"    ? "active" : ""}" onclick="selectRlStake('low')"    title="Aposta baixa">
        <span class="rl-chip-val">5</span><span class="rl-chip-label">BAIXA</span>
      </button>
      <button class="rl-chip rl-chip-medium ${rlSelectedStake === "medium" ? "active" : ""}" onclick="selectRlStake('medium')" title="Aposta média">
        <span class="rl-chip-val">15</span><span class="rl-chip-label">MÉDIA</span>
      </button>
      <button class="rl-chip rl-chip-high   ${rlSelectedStake === "high"   ? "active" : ""}" onclick="selectRlStake('high')"   title="Aposta alta">
        <span class="rl-chip-val">30</span><span class="rl-chip-label">ALTA</span>
      </button>
    </div>

    <div class="rl-bet-grid" style="${!canBet ? "opacity:0.38;pointer-events:none" : ""}">${betTypeButtons}</div>

    ${rlSelectedBetType === "straight" ? `<div class="rl-number-grid" style="${!canBet ? "opacity:0.38;pointer-events:none" : ""}">${buildNumberGrid()}</div>` : ""}

    <div class="rl-action-row">
      <button class="rl-btn rl-btn-spin" onclick="spinRoulette()" ${(!betReady || isSpinning) ? "disabled" : ""}>
        ${isSpinning ? "Girando..." : "🎡 Girar"}
      </button>
    </div>

    <div class="rl-status-msg">${statusMsg}</div>
  `;
}

function renderRoulette() {
  const root = document.getElementById("roulette-root");
  if (!root) return;

  if (rlState === "loading") {
    root.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#a8d8a8;font-size:13px">
        Carregando...
      </div>`;
    return;
  }

  if (rlState === "unauth") {
    root.innerHTML = `
      <div class="rl-login-msg">
        <span>🔒</span>
        Faça login para jogar na Roleta.<br>
        <button onclick="openWindow('win-login')" class="rl-btn" style="margin-top:8px">Fazer Login</button>
      </div>`;
    return;
  }

  if (rlState === "blocked") {
    root.innerHTML = `
      <div class="rl-topbar">
        <span>💰 Saldo: <strong>${rlBalance}</strong> LC</span>
        <span>Limite: ${rlDailyEarned}/${RL_DAILY_CAP} LC</span>
      </div>
      <div class="rl-daily-bar"><div class="rl-daily-fill" style="width:100%"></div></div>
      <div class="rl-blocked-msg">
        <span>🎰</span>
        <strong>Limite diário atingido!</strong>
        Você já ganhou ${RL_DAILY_CAP} LuizCoins™ hoje.<br>
        <span style="font-size:11px;color:#a8d8a8;margin-top:4px">Volte amanhã para mais fichas!</span>
      </div>`;
    return;
  }

  ensureRouletteSkeleton();

  const topbar = document.getElementById("rl-topbar");
  if (topbar) topbar.innerHTML = `<span>💰 Saldo: <strong>${rlBalance}</strong> LC</span><span style="font-size:11px">Hoje: ${rlDailyEarned}/${RL_DAILY_CAP} LC</span>`;

  const fill = document.getElementById("rl-daily-fill");
  if (fill) fill.style.width = `${Math.min(100, Math.round((rlDailyEarned / RL_DAILY_CAP) * 100))}%`;

  const historyEl = document.getElementById("rl-history");
  if (historyEl) {
    historyEl.innerHTML = rlHistory.length
      ? rlHistory.map((h) => `<span class="rl-history-dot rl-dot-${h.color}">${h.number}</span>`).join("")
      : `<span style="color:rgba(255,255,255,0.35);font-size:10px">Sem giros ainda hoje</span>`;
  }

  const panel = document.getElementById("rl-panel");
  if (panel) panel.innerHTML = renderRlPanel();
}

function showRlAlert(msg) {
  const root = document.getElementById("roulette-root");
  if (!root) return;
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#800;color:#fff;padding:5px 14px;border-radius:4px;font-size:12px;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6)";
  el.textContent = msg;
  root.style.position = "relative";
  root.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
