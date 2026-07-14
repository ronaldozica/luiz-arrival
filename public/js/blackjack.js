// ==========================================
// LUIZJACK 21 — Blackjack com visual cassino
// ==========================================

(function () {
  const style = document.createElement("style");
  style.textContent = `
    #luizjack-root {
      background: radial-gradient(ellipse at center, #1e6b2e 0%, #0d3d18 100%);
      border: 4px solid #c9a227;
      min-height: 420px;
      font-family: 'Times New Roman', serif;
      display: flex;
      flex-direction: column;
      user-select: none;
    }
    .bj-topbar {
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
    .bj-topbar strong { color: #ffe066; font-size: 13px; }
    .bj-daily-bar {
      height: 5px;
      background: #1a3a10;
      border-radius: 3px;
      margin: 0 14px;
      overflow: hidden;
    }
    .bj-daily-fill {
      height: 100%;
      background: linear-gradient(to right, #f5c518, #e07b00);
      border-radius: 3px;
      transition: width 0.4s;
    }
    .bj-table {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      padding: 12px 16px 8px;
      gap: 8px;
    }
    .bj-zone-label {
      font-size: 10px;
      color: #a8d8a8;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .bj-hand {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      flex-wrap: wrap;
      min-height: 86px;
    }
    .bj-hand-value {
      font-size: 13px;
      color: #ffe066;
      font-weight: bold;
      align-self: center;
      margin-left: 4px;
      min-width: 28px;
    }
    .bj-separator {
      border: none;
      border-top: 1px dashed rgba(201,162,39,0.35);
      margin: 0 8px;
    }
    .bj-card {
      width: 52px;
      height: 76px;
      background: #fff;
      border-radius: 6px;
      border: 1px solid #ccc;
      box-shadow: 2px 3px 8px rgba(0,0,0,0.55);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      padding: 4px 5px;
      font-size: 14px;
      font-weight: bold;
      font-family: 'Times New Roman', serif;
      position: relative;
      overflow: hidden;
    }
    .bj-card-new { animation: bj-deal 0.28s ease-out; }
    @keyframes bj-deal {
      from { transform: translateY(-14px) scale(0.85); opacity: 0; }
      to   { transform: translateY(0)      scale(1);    opacity: 1; }
    }
    .bj-loading-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      color: #a8d8a8;
      font-size: 11px;
      min-height: 20px;
    }
    .bj-spinner {
      width: 12px;
      height: 12px;
      border: 2px solid rgba(168,216,168,0.2);
      border-top-color: #a8d8a8;
      border-radius: 50%;
      animation: bj-spin 0.65s linear infinite;
    }
    @keyframes bj-spin { to { transform: rotate(360deg); } }
    .bj-card-back {
      background: repeating-linear-gradient(
        45deg, #1a3eaa, #1a3eaa 4px, #2255cc 4px, #2255cc 8px
      );
      border: 2px solid #c9a227;
      color: transparent;
      font-size: 0;
    }
    .bj-card-back::after {
      content: '🂠';
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%,-50%);
      font-size: 32px;
      color: rgba(255,255,255,0.15);
    }
    .bj-red  { color: #cc1111; }
    .bj-black { color: #111; }
    .bj-card-top { font-size: 13px; line-height: 1; }
    .bj-card-suit { font-size: 22px; text-align: center; line-height: 1; }
    .bj-card-bot { font-size: 13px; line-height: 1; text-align: right; transform: rotate(180deg); }
    .bj-controls {
      background: rgba(0,0,0,0.4);
      border-top: 2px solid #c9a227;
      padding: 10px 14px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .bj-bet-row {
      display: flex;
      justify-content: center;
      gap: 14px;
    }
    .bj-chip {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      border: 3px dashed rgba(255,255,255,0.5);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: 'Times New Roman', serif;
      font-weight: bold;
      transition: transform 0.1s, box-shadow 0.1s;
      box-shadow: 0 3px 8px rgba(0,0,0,0.5);
      outline: none;
    }
    .bj-chip:hover  { transform: scale(1.08); }
    .bj-chip.active { transform: scale(1.14); box-shadow: 0 0 0 3px #ffe066, 0 3px 10px rgba(0,0,0,0.6); }
    .bj-chip-low    { background: radial-gradient(circle, #4488ff, #1144cc); color: #fff; }
    .bj-chip-medium { background: radial-gradient(circle, #ffcc44, #cc8800); color: #2a1800; }
    .bj-chip-high   { background: radial-gradient(circle, #ff5555, #aa1111); color: #fff; }
    .bj-chip-val    { font-size: 15px; line-height: 1; }
    .bj-chip-label  { font-size: 9px; letter-spacing: 0.5px; opacity: 0.85; }
    .bj-action-row {
      display: flex;
      justify-content: center;
      gap: 10px;
    }
    .bj-btn {
      padding: 6px 22px;
      font-family: 'Times New Roman', serif;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 0.5px;
      border: 2px solid #c9a227;
      border-radius: 4px;
      cursor: pointer;
      transition: filter 0.1s, transform 0.08s;
      min-width: 80px;
    }
    .bj-btn:active { transform: scale(0.96); }
    .bj-btn:disabled { opacity: 0.38; cursor: not-allowed; transform: none; }
    .bj-btn-deal  { background: #c9a227; color: #1a0f00; }
    .bj-btn-hit   { background: #22aa44; color: #fff; }
    .bj-btn-stand { background: #cc3322; color: #fff; }
    .bj-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .bj-result {
      text-align: center;
      font-size: 15px;
      font-weight: bold;
      letter-spacing: 0.5px;
      padding: 6px 0 2px;
      min-height: 26px;
    }
    .bj-result-win        { color: #66ff88; }
    .bj-result-blackjack  { color: #ffe066; text-shadow: 0 0 8px #c9a227; }
    .bj-result-lose       { color: #ff6655; }
    .bj-result-push       { color: #aaddff; }
    .bj-status-msg {
      text-align: center;
      font-size: 11px;
      color: #a8d8a8;
      min-height: 16px;
    }
    .bj-blocked-msg {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #ffe066;
      font-size: 14px;
      text-align: center;
      gap: 8px;
      padding: 24px;
    }
    .bj-blocked-msg span { font-size: 36px; }
    .bj-login-msg {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #a8d8a8;
      text-align: center;
      font-size: 13px;
      gap: 10px;
      padding: 24px;
    }
    .bj-login-msg span { font-size: 32px; }
  `;
  document.head.appendChild(style);
})();

// ─── State ────────────────────────────────────────────────────────────────────
let bjState = "idle"; // idle | playing | result | blocked | loading | unauth
let bjBalance = 0;
let bjDailyEarned = 0;
const BJ_DAILY_CAP = 100;
let bjSelectedBet = null;
let bjGame = null;   // { playerHand, dealerHand?, dealerVisible, playerValue, dealerValue?, outcome?, ... }
let bjBusy = false;
let bjLastPlayerCount = 0;  // cartas do jogador na última renderização (para animar só a nova)
let bjJustResolved = false; // sinaliza que a mão acabou de ser resolvida (animar cartas do dealer)

const BET_LABELS = { low: "5", medium: "15", high: "30" };
const BET_NAMES  = { low: "Baixa", medium: "Média", high: "Alta" };

function openBlackjackWindow() {
  openWindow("win-luizjack");
  initBlackjack();
}

async function initBlackjack() {
  bjBusy = false;
  bjGame = null;
  bjState = "loading";
  renderBlackjack();

  if (!sessionToken) {
    bjState = "unauth";
    renderBlackjack();
    return;
  }

  try {
    const res = await fetch("/api/blackjack/status", { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar.");

    bjBalance = data.balance;
    bjDailyEarned = data.dailyEarned;

    if (data.blocked) {
      bjState = "blocked";
    } else if (data.activeGame) {
      bjGame = data.activeGame;
      bjState = "playing";
      bjSelectedBet = data.activeGame.betLevel || bjSelectedBet;
    } else {
      bjState = "idle";
    }
  } catch {
    bjState = "idle";
  }
  renderBlackjack();
}

function selectBjBet(level) {
  if (bjState !== "idle" && bjState !== "result") return;
  bjSelectedBet = level;
  renderBlackjack();
}

async function dealBlackjack() {
  if (bjBusy || bjState === "playing" || bjState === "blocked" || !bjSelectedBet) return;
  bjBusy = true;
  bjState = "loading";
  renderBlackjack();

  try {
    const res = await fetch("/api/blackjack/start", {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ betLevel: bjSelectedBet }),
    });
    const data = await res.json();
    if (!res.ok) {
      bjState = "idle";
      renderBlackjack();
      bjBusy = false;
      showBjAlert(data.error || "Erro ao iniciar.");
      return;
    }

    bjBalance = data.balance ?? bjBalance;
    bjDailyEarned = data.dailyEarned ?? bjDailyEarned;

    if (data.status === "done") {
      // Natural blackjack resolved immediately
      bjGame = data;
      bjState = "result";
      if (data.coinsWon > 0) showGameCoinsToast(data.coinsWon);
      if (data.newAchievements && data.newAchievements.length > 0)
        setTimeout(() => showAchievementToast(data.newAchievements), 2000);
    } else {
      bjGame = data;
      bjState = "playing";
    }
  } catch {
    bjState = "idle";
  }
  bjBusy = false;
  renderBlackjack();
}

async function bjAction(action) {
  if (bjBusy || bjState !== "playing") return;
  bjLastPlayerCount = bjGame?.playerHand?.length || 0;
  bjBusy = true;
  renderBlackjack(); // re-render with disabled buttons + spinner

  try {
    const res = await fetch("/api/blackjack/action", {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      bjBusy = false;
      renderBlackjack();
      showBjAlert(data.error || "Erro.");
      return;
    }

    bjBalance = data.balance ?? data.newBalance ?? bjBalance;
    bjDailyEarned = data.dailyEarned ?? bjDailyEarned;
    bjGame = data;

    if (data.status === "done") {
      bjJustResolved = true;
      bjState = data.blocked ? "blocked" : "result";
      if (data.coinsWon > 0) showGameCoinsToast(data.coinsWon);
      if (data.newAchievements && data.newAchievements.length > 0)
        setTimeout(() => showAchievementToast(data.newAchievements), 2000);
    } else {
      bjState = "playing";
    }
  } catch {
    bjState = "playing";
  }
  bjBusy = false;
  renderBlackjack();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function cardHTML(card, faceDown, isNew = false) {
  const newCls = isNew ? " bj-card-new" : "";
  if (faceDown) return `<div class="bj-card bj-card-back${newCls}"></div>`;
  const red = card.suit === "♥" || card.suit === "♦";
  const cls = red ? "bj-red" : "bj-black";
  return `<div class="bj-card ${cls}${newCls}">
    <div class="bj-card-top">${card.value}</div>
    <div class="bj-card-suit">${card.suit}</div>
    <div class="bj-card-bot">${card.value}</div>
  </div>`;
}

function handHTML(cards, hideSecond, prevCount = Infinity) {
  return cards.map((c, i) => cardHTML(c, hideSecond && i === 1, i >= prevCount)).join("");
}

function resultHTML(outcome, coinsWon, coinsLost) {
  if (!outcome) return "";
  const map = {
    blackjack: [`bj-result-blackjack`, `🃏 BLACKJACK! +${coinsWon} LuizCoins™`],
    win:       [`bj-result-win`,        `✅ Vitória! +${coinsWon} LuizCoins™`],
    bust:      [`bj-result-lose`,       `💥 Estourou! -${coinsLost} LuizCoins™`],
    lose:      [`bj-result-lose`,       `❌ Derrota. -${coinsLost} LuizCoins™`],
    push:      [`bj-result-push`,       `🤝 Empate. Aposta devolvida.`],
  };
  if (coinsWon === 0 && (outcome === "win" || outcome === "blackjack")) {
    return `<div class="bj-result bj-result-push">⚠️ Limite diário atingido — ganhos desta mão não contam.</div>`;
  }
  const [cls, msg] = map[outcome] || ["", ""];
  return `<div class="bj-result ${cls}">${msg}</div>`;
}

function renderBlackjack() {
  const root = document.getElementById("luizjack-root");
  if (!root) return;

  if (bjState === "loading") {
    root.innerHTML = `
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:#a8d8a8;font-size:13px">
        Carregando...
      </div>`;
    return;
  }

  if (bjState === "unauth") {
    root.innerHTML = `
      <div class="bj-login-msg">
        <span>🔒</span>
        Faça login para jogar Luiz21.<br>
        <button onclick="openWindow('win-login')" class="bj-btn bj-btn-deal" style="margin-top:8px">Fazer Login</button>
      </div>`;
    return;
  }

  if (bjState === "blocked") {
    root.innerHTML = `
      <div class="bj-topbar">
        <span>💰 Saldo: <strong>${bjBalance}</strong> LC</span>
        <span>Limite: ${bjDailyEarned}/${BJ_DAILY_CAP} LC</span>
      </div>
      <div class="bj-daily-bar"><div class="bj-daily-fill" style="width:100%"></div></div>
      <div class="bj-blocked-msg">
        <span>🎰</span>
        <strong>Limite diário atingido!</strong>
        Você já ganhou ${BJ_DAILY_CAP} LuizCoins™ hoje.<br>
        <span style="font-size:11px;color:#a8d8a8;margin-top:4px">Volte amanhã para mais fichas!</span>
      </div>`;
    return;
  }

  const isPlaying = bjState === "playing";
  const isDone    = bjState === "result";
  const isIdle    = bjState === "idle" || (!isPlaying && !isDone);

  // Dealer cards
  let dealerCards = [];
  let dealerValue = "";
  if (bjGame) {
    if (isDone && bjGame.dealerHand) {
      dealerCards = bjGame.dealerHand;
      dealerValue = bjGame.dealerValue;
    } else if (bjGame.dealerVisible) {
      dealerCards = bjGame.dealerVisible;
      if (dealerCards.length === 1) dealerCards = [...dealerCards, null]; // placeholder for hole card
    }
  }

  // Player cards
  const playerCards = bjGame?.playerHand || [];
  const playerValue = bjGame?.playerValue ?? "";

  const pct = Math.min(100, Math.round((bjDailyEarned / BJ_DAILY_CAP) * 100));

  root.innerHTML = `
    <div class="bj-topbar">
      <span>💰 Saldo: <strong>${bjBalance}</strong> LC</span>
      <span style="font-size:11px">Hoje: ${bjDailyEarned}/${BJ_DAILY_CAP} LC</span>
    </div>
    <div class="bj-daily-bar"><div class="bj-daily-fill" style="width:${pct}%"></div></div>

    <div class="bj-table">
      <div>
        <div class="bj-zone-label">🎩 Dealer ${isDone && dealerValue !== "" ? `— ${dealerValue}` : ""}</div>
        <div class="bj-hand">
          ${dealerCards.map((c, i) => {
            const isNew = bjJustResolved && i > 0;
            return c ? cardHTML(c, isPlaying && i === 1, isNew) : `<div class="bj-card bj-card-back${isNew ? " bj-card-new" : ""}"></div>`;
          }).join("")}
          ${!bjGame ? `<div style="color:rgba(255,255,255,0.2);font-size:12px;align-self:center">Aguardando...</div>` : ""}
        </div>
      </div>

      <hr class="bj-separator">

      <div>
        <div class="bj-zone-label">🎴 Você ${playerValue !== "" ? `— ${playerValue}` : ""}</div>
        <div class="bj-hand">
          ${handHTML(playerCards, false, bjLastPlayerCount)}
          ${!bjGame ? `<div style="color:rgba(255,255,255,0.2);font-size:12px;align-self:center">Aguardando...</div>` : ""}
        </div>
      </div>
    </div>

    <div class="bj-controls">
      ${isDone ? resultHTML(bjGame?.outcome, bjGame?.coinsWon, bjGame?.coinsLost) : `<div class="bj-result"></div>`}

      <div class="bj-bet-row" style="${isPlaying ? 'opacity:0.38;pointer-events:none' : ''}">
        <button class="bj-chip bj-chip-low    ${bjSelectedBet === 'low'    ? 'active' : ''}" onclick="selectBjBet('low')"    title="Aposta baixa">
          <span class="bj-chip-val">5</span>
          <span class="bj-chip-label">BAIXA</span>
        </button>
        <button class="bj-chip bj-chip-medium ${bjSelectedBet === 'medium' ? 'active' : ''}" onclick="selectBjBet('medium')" title="Aposta média">
          <span class="bj-chip-val">15</span>
          <span class="bj-chip-label">MÉDIA</span>
        </button>
        <button class="bj-chip bj-chip-high   ${bjSelectedBet === 'high'   ? 'active' : ''}" onclick="selectBjBet('high')"   title="Aposta alta">
          <span class="bj-chip-val">30</span>
          <span class="bj-chip-label">ALTA</span>
        </button>
      </div>

      <div class="bj-action-row">
        <button class="bj-btn bj-btn-deal"
          onclick="dealBlackjack()"
          ${(isPlaying || bjBusy || !bjSelectedBet) ? "disabled" : ""}>
          ${isDone ? "Nova mão" : "Distribuir"}
        </button>
        <button class="bj-btn bj-btn-hit"
          onclick="bjAction('hit')"
          ${(!isPlaying || bjBusy) ? "disabled" : ""}>
          Pedir (hit)
        </button>
        <button class="bj-btn bj-btn-stand"
          onclick="bjAction('stand')"
          ${(!isPlaying || bjBusy) ? "disabled" : ""}>
          Parar (stand)
        </button>
      </div>

      <div class="bj-status-msg">
        ${bjBusy && isPlaying
          ? `<div class="bj-loading-row"><div class="bj-spinner"></div> Calculando...</div>`
          : isPlaying ? `Aposta: <strong style="color:#ffe066">${BET_LABELS[bjSelectedBet]} LC</strong> — pedir carta ou parar?` : ""}
        ${isIdle && !bjSelectedBet ? `<span style="color:#f5c518">⬆ Selecione uma aposta para começar</span>` : ""}
        ${isIdle && bjSelectedBet  ? `Aposta: <strong style="color:#ffe066">${BET_LABELS[bjSelectedBet]} LC</strong> · Blackjack paga 1,5×` : ""}
        ${isDone && !bjSelectedBet ? `<span style="color:#f5c518">⬆ Selecione uma aposta para nova mão</span>` : ""}
        ${isDone && bjSelectedBet  ? `Aposta: <strong style="color:#ffe066">${BET_LABELS[bjSelectedBet]} LC</strong> · Pode trocar antes de distribuir` : ""}
      </div>
    </div>
  `;

  // Resetar flags de animação após a renderização que os usou
  bjJustResolved = false;
  if (!bjBusy) bjLastPlayerCount = playerCards.length;
}

function showBjAlert(msg) {
  const root = document.getElementById("luizjack-root");
  if (!root) return;
  const el = document.createElement("div");
  el.style.cssText = "position:absolute;top:8px;left:50%;transform:translateX(-50%);background:#800;color:#fff;padding:5px 14px;border-radius:4px;font-size:12px;z-index:9999;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.6)";
  el.textContent = msg;
  root.style.position = "relative";
  root.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}
