// ==========================================
// LUIZ SLOT — Caça-níquel de cassino, 3 rolos
// ==========================================

(function () {
  const style = document.createElement("style");
  style.textContent = `
    #slot-root {
      background: radial-gradient(ellipse at top, #3a0d1f 0%, #1a0510 65%, #0a0208 100%);
      border: 4px solid #d4af37;
      min-height: 520px;
      font-family: 'Georgia', 'Times New Roman', serif;
      display: flex;
      flex-direction: column;
      user-select: none;
      position: relative;
      overflow: hidden;
    }

    /* ─── Marquee ─────────────────────────────────────────────────────── */
    .sl-marquee-wrap {
      background: linear-gradient(180deg, #2a0a14, #1a0510);
      border-bottom: 2px solid #d4af37;
      padding: 10px 10px 8px;
      text-align: center;
      position: relative;
    }
    .sl-marquee {
      font-size: 22px;
      font-weight: bold;
      letter-spacing: 2px;
      color: #ffd75e;
      text-shadow:
        0 0 6px rgba(255, 215, 94, 0.9),
        0 0 16px rgba(255, 140, 0, 0.6),
        0 2px 2px rgba(0,0,0,0.8);
      animation: sl-marquee-glow 1.8s ease-in-out infinite alternate;
    }
    @keyframes sl-marquee-glow {
      from { text-shadow: 0 0 6px rgba(255,215,94,0.7), 0 0 14px rgba(255,140,0,0.45), 0 2px 2px rgba(0,0,0,0.8); }
      to   { text-shadow: 0 0 10px rgba(255,215,94,1), 0 0 26px rgba(255,140,0,0.85), 0 2px 2px rgba(0,0,0,0.8); }
    }
    .sl-bulbs { display: flex; justify-content: center; gap: 6px; margin-top: 4px; }
    .sl-bulb {
      width: 6px; height: 6px; border-radius: 50%;
      background: #ffd75e; box-shadow: 0 0 4px 1px rgba(255,215,94,0.8);
      animation: sl-bulb-blink 1.1s ease-in-out infinite;
    }
    .sl-bulb:nth-child(odd) { animation-delay: 0.35s; }
    .sl-bulb:nth-child(3n)  { animation-delay: 0.7s; }
    @keyframes sl-bulb-blink { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }

    .sl-topbar {
      background: rgba(0,0,0,0.35);
      padding: 5px 14px;
      display: flex; justify-content: space-between; align-items: center;
      font-size: 12px; color: #f5e07a; letter-spacing: 0.4px;
    }
    .sl-topbar strong { color: #ffe066; font-size: 13px; }

    /* ─── Gabinete / rolos ────────────────────────────────────────────── */
    .sl-cabinet {
      margin: 10px 16px 4px;
      background: linear-gradient(180deg, #6b1027, #4a0a1a);
      border: 3px solid #d4af37;
      border-radius: 10px;
      padding: 12px;
      box-shadow: inset 0 0 24px rgba(0,0,0,0.55), 0 4px 14px rgba(0,0,0,0.5);
      position: relative;
    }
    .sl-reels-window {
      display: flex;
      gap: 8px;
      background: #0c0c10;
      border: 3px solid #8a6d1a;
      border-radius: 6px;
      padding: 6px;
      box-shadow: inset 0 4px 12px rgba(0,0,0,0.8);
      position: relative;
    }
    .sl-payline {
      position: absolute; left: 4px; right: 4px; top: 50%; transform: translateY(-50%);
      height: 2px; background: rgba(255, 90, 90, 0.55);
      box-shadow: 0 0 6px 1px rgba(255,90,90,0.5);
      pointer-events: none; z-index: 3;
    }
    .sl-payline::before, .sl-payline::after {
      content: "▶"; position: absolute; top: 50%; transform: translateY(-50%);
      color: #ff5a5a; font-size: 10px; text-shadow: 0 0 4px rgba(255,90,90,0.8);
    }
    .sl-payline::before { left: -10px; }
    .sl-payline::after { right: -10px; content: "◀"; }

    .sl-reel {
      flex: 1; height: 90px; overflow: hidden; position: relative;
      background: linear-gradient(180deg, #fdf6e3 0%, #fff9ec 50%, #fdf6e3 100%);
      border-radius: 4px;
      box-shadow: inset 0 6px 10px -6px rgba(0,0,0,0.6), inset 0 -6px 10px -6px rgba(0,0,0,0.6);
    }
    .sl-reel-track {
      display: flex; flex-direction: column; align-items: center;
      will-change: transform;
    }
    .sl-symbol {
      height: 90px; width: 100%; display: flex; align-items: center; justify-content: center;
      font-size: 46px; line-height: 1;
      filter: drop-shadow(0 2px 3px rgba(0,0,0,0.25));
    }
    .sl-reel.sl-win .sl-symbol { animation: sl-symbol-pulse 0.6s ease-in-out infinite; }
    @keyframes sl-symbol-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }

    .sl-cabinet.sl-jackpot { animation: sl-cabinet-flash 0.5s ease-in-out infinite; }
    @keyframes sl-cabinet-flash {
      0%, 100% { box-shadow: inset 0 0 24px rgba(0,0,0,0.55), 0 4px 14px rgba(0,0,0,0.5); }
      50% { box-shadow: inset 0 0 30px rgba(255,215,94,0.5), 0 0 30px 6px rgba(255,215,94,0.55); }
    }

    /* ─── Confete simples em vitória grande ──────────────────────────── */
    .sl-confetti { position: absolute; inset: 0; pointer-events: none; overflow: hidden; z-index: 6; }
    .sl-confetti-piece {
      position: absolute; top: -12px; width: 7px; height: 7px; opacity: 0.9;
      animation: sl-confetti-fall linear forwards;
    }
    @keyframes sl-confetti-fall {
      to { transform: translateY(560px) rotate(600deg); opacity: 0; }
    }

    .sl-panel { background: rgba(0,0,0,0.35); border-top: 2px solid #d4af37; padding: 8px 14px 12px; display: flex; flex-direction: column; gap: 8px; margin-top: auto; }

    .sl-result { text-align: center; font-size: 14px; font-weight: bold; letter-spacing: 0.3px; padding: 4px 0 2px; min-height: 22px; }
    .sl-result-win     { color: #66ff88; }
    .sl-result-jackpot { color: #ffd75e; text-shadow: 0 0 8px rgba(255,215,94,0.8); font-size: 15px; }
    .sl-result-partial { color: #f5c518; }
    .sl-result-lose    { color: #ff6655; }

    .sl-chip-row { display: flex; justify-content: center; gap: 14px; }
    .sl-chip {
      width: 50px; height: 50px; border-radius: 50%; border: 3px dashed rgba(255,255,255,0.5);
      cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center;
      font-family: 'Times New Roman', serif; font-weight: bold; transition: transform 0.1s, box-shadow 0.1s;
      box-shadow: 0 3px 8px rgba(0,0,0,0.5); outline: none;
    }
    .sl-chip:hover  { transform: scale(1.08); }
    .sl-chip.active { transform: scale(1.14); box-shadow: 0 0 0 3px #ffe066, 0 3px 10px rgba(0,0,0,0.6); }
    .sl-chip-low    { background: radial-gradient(circle, #4488ff, #1144cc); color: #fff; }
    .sl-chip-medium { background: radial-gradient(circle, #ffcc44, #cc8800); color: #2a1800; }
    .sl-chip-high   { background: radial-gradient(circle, #ff5555, #aa1111); color: #fff; }
    .sl-chip-val    { font-size: 13px; line-height: 1; }
    .sl-chip-label  { font-size: 7px; letter-spacing: 0.5px; opacity: 0.85; }

    .sl-action-row { display: flex; justify-content: center; }
    .sl-btn {
      padding: 9px 34px; font-family: 'Georgia', 'Times New Roman', serif; font-size: 14px; font-weight: bold; letter-spacing: 0.5px;
      border: 2px solid #d4af37; border-radius: 999px; cursor: pointer; transition: filter 0.1s, transform 0.08s; min-width: 140px;
      background: linear-gradient(180deg, #ffe27a, #d4af37); color: #2a1500;
    }
    .sl-btn:active { transform: scale(0.96); }
    .sl-btn:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }
    .sl-btn:hover:not(:disabled) { filter: brightness(1.12); }

    .sl-status-msg { text-align: center; font-size: 11px; color: #d9a8b8; min-height: 16px; }

    .sl-paytable { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px 12px; font-size: 10px; color: #e0b8c4; padding: 2px 4px; }
    .sl-paytable span { white-space: nowrap; }
    .sl-paytable strong { color: #ffe066; }

    .sl-history { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; padding: 2px 10px; min-height: 20px; }
    .sl-history-item { font-size: 13px; background: rgba(0,0,0,0.35); border: 1px solid rgba(212,175,55,0.4); border-radius: 4px; padding: 1px 4px; }

    .sl-login-msg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #d9a8b8; text-align: center; font-size: 13px; gap: 10px; padding: 24px; }
    .sl-login-msg span { font-size: 32px; }
  `;
  document.head.appendChild(style);
})();

// ─── Config (espelha api/routes/slot.js — mudar lá exige mudar aqui) ────────
const SL_SYMBOLS = [
  { id: "cherry",  emoji: "🍒", weight: 30, payout: 3 },
  { id: "lemon",   emoji: "🍋", weight: 25, payout: 4 },
  { id: "grape",   emoji: "🍇", weight: 20, payout: 6 },
  { id: "bell",    emoji: "🔔", weight: 12, payout: 10 },
  { id: "diamond", emoji: "💎", weight: 8,  payout: 20 },
  { id: "clock",   emoji: "🕐", weight: 5,  payout: 75 },
];
const SL_SYMBOL_MAP = Object.fromEntries(SL_SYMBOLS.map((s) => [s.id, s]));
const SL_STAKE_LABELS = { low: "5", medium: "15", high: "30" };
const SL_STAKE_VALUES = { low: 5, medium: 15, high: 30 };
const SL_SYMBOL_HEIGHT = 90;
const SL_REEL_DURATIONS = [1300, 1650, 2000];
const SL_REEL_DELAYS = [0, 150, 320];

function slRandomSymbolId() {
  return SL_SYMBOLS[Math.floor(Math.random() * SL_SYMBOLS.length)].id;
}

// ─── State ──────────────────────────────────────────────────────────────────
let slState = "idle"; // idle | spinning | result | loading | unauth
let slBalance = 0;
let slSelectedStake = null;
let slBusy = false;
let slHistory = [];
let slLastResult = null;
let slReelBuilt = false;
let slSpinAudio = null;

function openSlotWindow() {
  openWindow("win-slot");
  initSlot();
}

async function initSlot() {
  slBusy = false;
  slLastResult = null;
  slState = "loading";
  slReelBuilt = false;
  renderSlot();

  if (!sessionToken) {
    slState = "unauth";
    renderSlot();
    return;
  }

  try {
    const res = await fetch("/api/slot/status", { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar.");

    slBalance = data.balance;
    slHistory = data.history || [];
    slState = "idle";
  } catch {
    slState = "idle";
  }
  renderSlot();
}

function selectSlStake(level) {
  if (slState !== "idle" && slState !== "result") return;
  slSelectedStake = level;
  renderSlot();
}

async function spinSlot() {
  if (slBusy || slState === "spinning") return;
  if (!slSelectedStake) return;

  slBusy = true;
  slState = "spinning";
  document.querySelectorAll(".sl-reel").forEach((r) => r.classList.remove("sl-win"));
  document.getElementById("sl-cabinet")?.classList.remove("sl-jackpot");
  renderSlot();
  slSpinAudio = playAudioSfx("/assets/sounds/slotmachine.mp3", { volume: 0.5 });

  try {
    const res = await fetch("/api/slot/spin", {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ betAmount: slSelectedStake }),
    });
    const data = await res.json();
    if (!res.ok) {
      fadeOutAndStop(slSpinAudio);
      slBusy = false;
      slState = "idle";
      renderSlot();
      showSlAlert(data.error || "Erro ao girar.");
      return;
    }

    spinReelsTo(data.reels);
    const totalDuration = Math.max(...SL_REEL_DURATIONS.map((d, i) => d + SL_REEL_DELAYS[i]));

    setTimeout(() => {
      fadeOutAndStop(slSpinAudio);
      slBalance = data.balance ?? slBalance;
      slHistory = data.history || slHistory;
      slLastResult = {
        outcome: data.outcome, coinsWon: data.coinsWon, coinsLost: data.coinsLost, reels: data.reels,
      };
      slState = "result";
      slBusy = false;

      if (data.outcome === "win") {
        document.querySelectorAll(".sl-reel").forEach((r) => r.classList.add("sl-win"));
        const isJackpot = data.reels[0] === "clock";
        if (isJackpot) {
          document.getElementById("sl-cabinet")?.classList.add("sl-jackpot");
          launchSlConfetti();
        }
      }

      if (data.coinsWon > 0) showGameCoinsToast(data.coinsWon);
      else if (data.coinsLost > 0) showGameCoinsToast(-data.coinsLost);
      if (data.newAchievements && data.newAchievements.length > 0)
        setTimeout(() => showAchievementToast(data.newAchievements), 1500);

      renderSlot();
    }, totalDuration + 150);
  } catch (e) {
    fadeOutAndStop(slSpinAudio);
    slBusy = false;
    slState = "idle";
    renderSlot();
    showSlAlert("Erro de conexão.");
  }
}

// ─── Rolos (construídos uma vez; girados via transform, nunca recriados) ────
function buildReelTrackHTML(finalSymbolId) {
  // Tira de símbolos aleatórios pra dar sensação de movimento, terminando
  // exatamente no símbolo sorteado pelo servidor (última posição da tira).
  const fillerCount = 18;
  const ids = [];
  for (let i = 0; i < fillerCount; i++) ids.push(slRandomSymbolId());
  ids.push(finalSymbolId);
  return ids.map((id) => `<div class="sl-symbol">${SL_SYMBOL_MAP[id].emoji}</div>`).join("");
}

function spinReelsTo(reels) {
  for (let i = 0; i < 3; i++) {
    const track = document.getElementById(`sl-track-${i}`);
    if (!track) continue;
    track.innerHTML = buildReelTrackHTML(reels[i]);
    track.style.transition = "none";
    track.style.transform = "translateY(0px)";
    // força reflow antes de religar a transição, senão o navegador junta os 2 estados
    void track.offsetHeight;
    const stripLength = track.children.length;
    const distance = (stripLength - 1) * SL_SYMBOL_HEIGHT;
    const duration = SL_REEL_DURATIONS[i];
    const delay = SL_REEL_DELAYS[i];
    track.style.transition = `transform ${duration}ms cubic-bezier(0.12, 0.85, 0.22, 1) ${delay}ms`;
    track.style.transform = `translateY(-${distance}px)`;
  }
}

function launchSlConfetti() {
  const root = document.getElementById("slot-root");
  if (!root) return;
  const layer = document.createElement("div");
  layer.className = "sl-confetti";
  const colors = ["#ffd75e", "#ff5a5a", "#66ff88", "#4488ff", "#ff9dd8"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "sl-confetti-piece";
    piece.style.left = Math.random() * 100 + "%";
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = 1000 + Math.random() * 900 + "ms";
    piece.style.animationDelay = Math.random() * 300 + "ms";
    layer.appendChild(piece);
  }
  root.appendChild(layer);
  setTimeout(() => layer.remove(), 2400);
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function ensureSlotSkeleton() {
  const root = document.getElementById("slot-root");
  if (!root || root.querySelector(".sl-cabinet")) return;
  root.innerHTML = `
    <div class="sl-marquee-wrap">
      <div class="sl-marquee">🎰 LUIZ SLOT 🎰</div>
      <div class="sl-bulbs">${Array.from({ length: 9 }).map(() => '<span class="sl-bulb"></span>').join("")}</div>
    </div>
    <div class="sl-topbar" id="sl-topbar"></div>
    <div class="sl-cabinet" id="sl-cabinet">
      <div class="sl-reels-window">
        <div class="sl-payline"></div>
        <div class="sl-reel"><div class="sl-reel-track" id="sl-track-0"></div></div>
        <div class="sl-reel"><div class="sl-reel-track" id="sl-track-1"></div></div>
        <div class="sl-reel"><div class="sl-reel-track" id="sl-track-2"></div></div>
      </div>
    </div>
    <div class="sl-paytable">${SL_SYMBOLS.map((s) => `<span>${s.emoji}${s.emoji}${s.emoji} <strong>${s.payout}x</strong></span>`).join("")}</div>
    <div class="sl-history" id="sl-history"></div>
    <div class="sl-panel" id="sl-panel"></div>
  `;
  // Estado inicial dos rolos: 1 símbolo aleatório parado em cada um.
  for (let i = 0; i < 3; i++) {
    const track = document.getElementById(`sl-track-${i}`);
    track.innerHTML = `<div class="sl-symbol">${SL_SYMBOL_MAP[slRandomSymbolId()].emoji}</div>`;
  }
  slReelBuilt = true;
}

function renderSlPanel() {
  const isSpinning = slState === "spinning";
  const isResult = slState === "result";
  const canBet = !isSpinning;
  const betReady = !!slSelectedStake;

  let resultHtml = `<div class="sl-result"></div>`;
  if (isResult && slLastResult) {
    const { outcome, coinsWon, coinsLost, reels } = slLastResult;
    if (outcome === "win") {
      const isJackpot = reels[0] === "clock";
      resultHtml = isJackpot
        ? `<div class="sl-result sl-result-jackpot">🎉 JACKPOT! ${SL_SYMBOL_MAP[reels[0]].emoji}${SL_SYMBOL_MAP[reels[0]].emoji}${SL_SYMBOL_MAP[reels[0]].emoji} — +${coinsWon} LuizCoins™!</div>`
        : `<div class="sl-result sl-result-win">🎉 3 iguais! +${coinsWon} LuizCoins™</div>`;
    } else if (outcome === "partial") {
      resultHtml = `<div class="sl-result sl-result-partial">Quase! 2 símbolos bateram. -${coinsLost} LuizCoins™</div>`;
    } else {
      resultHtml = `<div class="sl-result sl-result-lose">Não foi dessa vez. -${coinsLost} LuizCoins™</div>`;
    }
  }

  let statusMsg;
  if (isSpinning) {
    statusMsg = `<span style="color:#f5c518">🎰 Rodando...</span>`;
  } else if (!betReady) {
    statusMsg = `<span style="color:#f5c518">⬆ Escolha a ficha e puxe a alavanca</span>`;
  } else {
    statusMsg = `Aposta: <strong style="color:#ffe066">${SL_STAKE_LABELS[slSelectedStake]} LC</strong> por giro`;
  }

  return `
    ${resultHtml}
    <div class="sl-chip-row" style="${!canBet ? "opacity:0.38;pointer-events:none" : ""}">
      <button class="sl-chip sl-chip-low    ${slSelectedStake === "low"    ? "active" : ""}" onclick="selectSlStake('low')"    title="Aposta baixa">
        <span class="sl-chip-val">5</span><span class="sl-chip-label">BAIXA</span>
      </button>
      <button class="sl-chip sl-chip-medium ${slSelectedStake === "medium" ? "active" : ""}" onclick="selectSlStake('medium')" title="Aposta média">
        <span class="sl-chip-val">15</span><span class="sl-chip-label">MÉDIA</span>
      </button>
      <button class="sl-chip sl-chip-high   ${slSelectedStake === "high"   ? "active" : ""}" onclick="selectSlStake('high')"   title="Aposta alta">
        <span class="sl-chip-val">30</span><span class="sl-chip-label">ALTA</span>
      </button>
    </div>

    <div class="sl-action-row">
      <button class="sl-btn" onclick="spinSlot()" ${(!betReady || isSpinning) ? "disabled" : ""}>
        ${isSpinning ? "Girando..." : "🎰 Puxar a alavanca"}
      </button>
    </div>

    <div class="sl-status-msg">${statusMsg}</div>
  `;
}

function renderSlot() {
  const root = document.getElementById("slot-root");
  if (!root) return;

  if (slState === "loading") {
    root.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#d9a8b8;font-size:13px">
        Carregando...
      </div>`;
    return;
  }

  if (slState === "unauth") {
    root.innerHTML = `
      <div class="sl-login-msg">
        <span>🔒</span>
        Faça login para jogar no Luiz Slot.<br>
        <button onclick="openWindow('win-login')" class="sl-btn" style="margin-top:8px">Fazer Login</button>
      </div>`;
    return;
  }

  ensureSlotSkeleton();

  const topbar = document.getElementById("sl-topbar");
  if (topbar) topbar.innerHTML = `<span>💰 Saldo: <strong>${slBalance}</strong> LC</span>`;

  const historyEl = document.getElementById("sl-history");
  if (historyEl) {
    historyEl.innerHTML = slHistory.length
      ? slHistory.map((h) => `<span class="sl-history-item">${h.reels.map((id) => SL_SYMBOL_MAP[id].emoji).join("")}</span>`).join("")
      : `<span style="color:rgba(255,255,255,0.35);font-size:10px">Sem giros ainda hoje</span>`;
  }

  const panel = document.getElementById("sl-panel");
  if (panel) panel.innerHTML = renderSlPanel();
}

function showSlAlert(msg) {
  const root = document.getElementById("slot-root");
  if (!root) return;
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#800;color:#fff;padding:5px 14px;border-radius:4px;font-size:12px;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6)";
  el.textContent = msg;
  root.style.position = "relative";
  root.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
