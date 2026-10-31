// ==========================================
// LUIZ BICHO — Jogo do Bicho Diário + Ranking
// ==========================================

(function () {
  const style = document.createElement("style");
  style.textContent = `
    #bicho-root {
      background: #14331b;
      background-image: radial-gradient(ellipse at top, #1f4d29 0%, #122b17 75%, #0b1c0e 100%);
      border: 3px solid #d4af37;
      min-height: 490px;
      font-family: Tahoma, 'MS Sans Serif', sans-serif;
      color: #f7f3e3;
      display: flex;
      flex-direction: column;
      user-select: none;
      position: relative;
      overflow: hidden;
    }

    .jb-header {
      background: linear-gradient(180deg, #0e2413, #17381e);
      border-bottom: 2px solid #d4af37;
      padding: 8px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
    }
    .jb-title {
      font-family: 'Georgia', serif;
      font-size: 16px;
      font-weight: bold;
      color: #ffd75e;
      letter-spacing: 0.8px;
      text-shadow: 0 1px 2px rgba(0,0,0,0.8);
    }
    .jb-topbar-info {
      font-size: 12px;
      color: #e9dfba;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .jb-topbar-info strong {
      color: #ffe066;
    }

    .jb-tabs {
      display: flex;
      gap: 6px;
      justify-content: center;
      padding: 6px 10px;
      background: rgba(0, 0, 0, 0.25);
      border-bottom: 1px solid rgba(212, 175, 55, 0.35);
    }
    .jb-tab-btn {
      padding: 4px 12px;
      font-size: 11px;
      font-weight: bold;
      cursor: pointer;
      border: 1px solid #d4af37;
      border-radius: 3px;
      background: #1a3c22;
      color: #f5e6b3;
    }
    .jb-tab-btn.active {
      background: linear-gradient(180deg, #ffe27a, #d4af37);
      color: #231600;
    }

    .jb-body {
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;
    }

    /* ─── Seletor de Modalidade ─────────────────────────────────────── */
    .jb-modes {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5px;
    }
    .jb-mode-card {
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(212, 175, 55, 0.45);
      border-radius: 4px;
      padding: 5px 6px;
      text-align: center;
      cursor: pointer;
      transition: transform 0.08s, border-color 0.1s, background 0.1s;
    }
    .jb-mode-card:hover {
      border-color: #ffe066;
    }
    .jb-mode-card.active {
      background: rgba(212, 175, 55, 0.22);
      border: 2px solid #ffd75e;
      box-shadow: 0 0 8px rgba(255, 215, 94, 0.3);
    }
    .jb-mode-name {
      font-size: 11px;
      font-weight: bold;
      color: #fff;
    }
    .jb-mode-payout {
      font-size: 10px;
      color: #ffd75e;
      margin-top: 1px;
    }

    /* ─── Grade dos 25 Bichos ───────────────────────────────────────── */
    .jb-animals-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
    }
    .jb-animal-card {
      background: #fdf6e3;
      color: #1f1a10;
      border: 2px solid #8c7335;
      border-radius: 4px;
      padding: 3px 2px;
      text-align: center;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      transition: transform 0.06s, box-shadow 0.08s, border-color 0.08s;
      position: relative;
    }
    .jb-animal-card:hover {
      transform: translateY(-1px);
      border-color: #d4af37;
    }
    .jb-animal-card.selected {
      background: #fff3b0;
      border-color: #d32f2f;
      box-shadow: 0 0 0 2px #ffd75e, 0 2px 6px rgba(0,0,0,0.45);
      transform: scale(1.03);
      z-index: 2;
    }
    .jb-animal-group {
      position: absolute;
      top: 1px;
      left: 3px;
      font-size: 9px;
      font-weight: bold;
      color: #6b5318;
      font-family: 'Courier New', monospace;
    }
    .jb-animal-emoji {
      font-size: 18px;
      line-height: 1.1;
      margin-top: 2px;
    }
    .jb-animal-name {
      font-size: 9px;
      font-weight: bold;
      line-height: 1.1;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
    .jb-animal-dezenas {
      font-size: 8px;
      color: #555;
      font-family: 'Courier New', monospace;
      letter-spacing: -0.3px;
    }

    /* ─── Seletor de Dezena (quando modalidade = dezena_cabeca) ─────── */
    .jb-dezena-bar {
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid #d4af37;
      border-radius: 4px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11px;
    }
    .jb-dezena-btns {
      display: flex;
      gap: 4px;
    }
    .jb-dez-btn {
      padding: 3px 8px;
      font-family: 'Courier New', monospace;
      font-size: 12px;
      font-weight: bold;
      border: 1px solid #d4af37;
      border-radius: 3px;
      background: #23492c;
      color: #fff;
      cursor: pointer;
    }
    .jb-dez-btn.active {
      background: #ffd75e;
      color: #1a1000;
      border-color: #fff;
    }
    .jb-dez-input {
      width: 44px;
      text-align: center;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      font-weight: bold;
      padding: 2px 4px;
      border: 1px solid #d4af37;
      background: #fff9e6;
      color: #111;
    }

    /* ─── Painel de Fichas + Botão de Fézinha ───────────────────────── */
    .jb-controls {
      background: rgba(0, 0, 0, 0.35);
      border-top: 1px solid rgba(212, 175, 55, 0.45);
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: auto;
    }
    .jb-chips {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .jb-chip {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: 2px dashed rgba(255,255,255,0.65);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      transition: transform 0.08s, box-shadow 0.08s;
    }
    .jb-chip.active {
      transform: scale(1.13);
      box-shadow: 0 0 0 3px #ffe066, 0 3px 8px rgba(0,0,0,0.6);
    }
    .jb-chip-low    { background: radial-gradient(circle, #4488ff, #1144cc); color: #fff; }
    .jb-chip-medium { background: radial-gradient(circle, #ffcc44, #cc8800); color: #2a1800; }
    .jb-chip-high   { background: radial-gradient(circle, #ff5555, #aa1111); color: #fff; }
    .jb-chip-val    { font-size: 12px; line-height: 1; }
    .jb-chip-lbl    { font-size: 7px; opacity: 0.9; }

    .jb-submit-btn {
      padding: 8px 18px;
      font-size: 13px;
      font-weight: bold;
      border: 2px solid #d4af37;
      border-radius: 6px;
      cursor: pointer;
      background: linear-gradient(180deg, #ffe27a, #d4af37);
      color: #231200;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    }
    .jb-submit-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ─── Comprovante "Deu no Poste" (Extrato Amarelo de Banca) ─────── */
    .jb-poste-wrap {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .jb-ticket {
      background: #fff6cf;
      color: #221c0e;
      border: 2px dashed #8a6d1a;
      border-radius: 4px;
      padding: 10px 12px;
      font-family: 'Courier New', monospace;
      box-shadow: 0 3px 10px rgba(0,0,0,0.45);
    }
    .jb-ticket-header {
      text-align: center;
      border-bottom: 1px dashed #8a6d1a;
      padding-bottom: 6px;
      margin-bottom: 6px;
      font-weight: bold;
      font-size: 13px;
    }
    .jb-prize-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 6px;
      border-bottom: 1px dotted rgba(0,0,0,0.18);
      font-size: 13px;
    }
    .jb-prize-row:last-child {
      border-bottom: none;
    }
    .jb-prize-row.jb-hit {
      background: #c8f7c5;
      border: 1px solid #2e7d32;
      border-radius: 3px;
      font-weight: bold;
    }
    .jb-prize-milhar {
      font-size: 14px;
      letter-spacing: 1px;
      background: #1c1c1c;
      border: 1px solid #444;
      padding: 2px 5px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
    }
    .jb-milhar-prefix {
      color: #8c8c8c;
      font-weight: normal;
      padding-left: 2px;
    }
    .jb-milhar-dezena {
      background: linear-gradient(180deg, #ffe27a, #d4af37);
      color: #1f1200;
      font-weight: bold;
      padding: 0 5px;
      border-radius: 3px;
      box-shadow: 0 0 6px rgba(255, 215, 94, 0.75);
    }

    .jb-result-banner {
      padding: 8px 10px;
      border-radius: 4px;
      text-align: center;
      font-size: 13px;
      font-weight: bold;
    }
    .jb-result-win {
      background: rgba(46, 125, 50, 0.35);
      border: 2px solid #66ff88;
      color: #b9f6ca;
    }
    .jb-result-lose {
      background: rgba(183, 28, 28, 0.35);
      border: 2px solid #ff6655;
      color: #ffcdd2;
    }

    @media (max-width: 520px) {
      .jb-animals-grid {
        grid-template-columns: repeat(5, 1fr);
        gap: 3px;
      }
      .jb-animal-emoji { font-size: 15px; }
      .jb-animal-name  { font-size: 8px; }
      .jb-animal-dezenas { font-size: 7px; }
    }
  `;
  document.head.appendChild(style);
})();

const JB_ANIMALS = [
  { group: 1,  name: "Avestruz",  emoji: "🦩", dezenas: ["01", "02", "03", "04"] },
  { group: 2,  name: "Águia",     emoji: "🦅", dezenas: ["05", "06", "07", "08"] },
  { group: 3,  name: "Burro",     emoji: "🫏", dezenas: ["09", "10", "11", "12"] },
  { group: 4,  name: "Borboleta", emoji: "🦋", dezenas: ["13", "14", "15", "16"] },
  { group: 5,  name: "Cachorro",  emoji: "🐕", dezenas: ["17", "18", "19", "20"] },
  { group: 6,  name: "Cabra",     emoji: "🐐", dezenas: ["21", "22", "23", "24"] },
  { group: 7,  name: "Carneiro",  emoji: "🐏", dezenas: ["25", "26", "27", "28"] },
  { group: 8,  name: "Camelo",    emoji: "🐪", dezenas: ["29", "30", "31", "32"] },
  { group: 9,  name: "Cobra",     emoji: "🐍", dezenas: ["33", "34", "35", "36"] },
  { group: 10, name: "Coelho",    emoji: "🐇", dezenas: ["37", "38", "39", "40"] },
  { group: 11, name: "Cavalo",    emoji: "🐎", dezenas: ["41", "42", "43", "44"] },
  { group: 12, name: "Elefante",  emoji: "🐘", dezenas: ["45", "46", "47", "48"] },
  { group: 13, name: "Galo",      emoji: "🐓", dezenas: ["49", "50", "51", "52"] },
  { group: 14, name: "Gato",      emoji: "🐈", dezenas: ["53", "54", "55", "56"] },
  { group: 15, name: "Jacaré",    emoji: "🐊", dezenas: ["57", "58", "59", "60"] },
  { group: 16, name: "Leão",      emoji: "🦁", dezenas: ["61", "62", "63", "64"] },
  { group: 17, name: "Macaco",    emoji: "🐒", dezenas: ["65", "66", "67", "68"] },
  { group: 18, name: "Porco",     emoji: "🐖", dezenas: ["69", "70", "71", "72"] },
  { group: 19, name: "Pavão",     emoji: "🦚", dezenas: ["73", "74", "75", "76"] },
  { group: 20, name: "Peru",      emoji: "🦃", dezenas: ["77", "78", "79", "80"] },
  { group: 21, name: "Touro",     emoji: "🐂", dezenas: ["81", "82", "83", "84"] },
  { group: 22, name: "Tigre",     emoji: "🐅", dezenas: ["85", "86", "87", "88"] },
  { group: 23, name: "Urso",      emoji: "🐻", dezenas: ["89", "90", "91", "92"] },
  { group: 24, name: "Veado",     emoji: "🦌", dezenas: ["93", "94", "95", "96"] },
  { group: 25, name: "Vaca",      emoji: "🐄", dezenas: ["97", "98", "99", "00"] },
];

const JB_STAKE_VALUES = { low: 5, medium: 15, high: 30 };

let jbState = "loading"; // loading | unauth | ready | rolling
let jbView = "play"; // play | rank
let jbDate = null;
let jbBalance = 0;
let jbDone = false;
let jbBet = null;
let jbDraw = null;
let jbTodayWinners = [];
let jbRank = [];
let jbSelectedMode = "grupo_cabeca";
let jbSelectedGroup = null;
let jbSelectedDezena = "";
let jbSelectedStake = "low";
let jbErrorMsg = null;

// ─── Bolinha de notificação diária ("ainda não fez a fézinha hoje") ──────────
function jbTodayKeyLocal() {
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  const dd = String(local.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function jbDoneKey(date) {
  return `luizos_bicho_daily_done_${date}`;
}

function jbHasDoneToday() {
  try {
    return localStorage.getItem(jbDoneKey(jbTodayKeyLocal())) === "1";
  } catch {
    return false;
  }
}

function jbMarkDoneToday(date) {
  try {
    localStorage.setItem(jbDoneKey(date || jbTodayKeyLocal()), "1");
  } catch {}
  jbUpdateBadge();
}

function jbUpdateBadge() {
  const show = !jbHasDoneToday();
  document.querySelectorAll(".bicho-badge-dot, .bicho-badge-corner").forEach((el) => {
    el.classList.toggle("show", show);
  });
}

function openBichoWindow() {
  openWindow("win-bicho");
  initBicho();
}

async function initBicho() {
  jbState = "loading";
  jbErrorMsg = null;
  renderBicho();

  if (!sessionToken) {
    jbState = "unauth";
    renderBicho();
    return;
  }

  try {
    const res = await fetch("/api/bicho/status", { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar a banca.");

    jbDate = data.date;
    jbBalance = data.balance ?? 0;
    jbDone = !!data.done;
    jbBet = data.bet || null;
    jbDraw = data.draw || null;
    jbTodayWinners = data.todayWinners || [];
    jbRank = data.rank || [];
    jbState = "ready";

    if (jbDone) jbMarkDoneToday(jbDate);
  } catch (e) {
    jbErrorMsg = e.message || "Erro ao carregar o Luiz Bicho.";
    jbState = "ready";
  }
  renderBicho();
}

function jbSetView(view) {
  jbView = view;
  renderBicho();
}

function jbSelectMode(mode) {
  if (jbDone || jbState === "rolling") return;
  jbSelectedMode = mode;
  if (mode === "dezena_cabeca" && jbSelectedGroup && !jbSelectedDezena) {
    const animal = JB_ANIMALS[jbSelectedGroup - 1];
    if (animal) jbSelectedDezena = animal.dezenas[0];
  }
  renderBicho();
}

function jbSelectAnimal(group) {
  if (jbDone || jbState === "rolling") return;
  jbSelectedGroup = group;
  const animal = JB_ANIMALS[group - 1];
  if (animal && (!jbSelectedDezena || !animal.dezenas.includes(jbSelectedDezena))) {
    jbSelectedDezena = animal.dezenas[0];
  }
  renderBicho();
}

function jbSelectDezena(dez) {
  if (jbDone || jbState === "rolling") return;
  const clean = String(dez).replace(/\D/g, "").slice(0, 2);
  jbSelectedDezena = clean;
  if (clean.length === 2) {
    const n = Number(clean);
    jbSelectedGroup = n === 0 ? 25 : Math.ceil(n / 4);
  }
  renderBicho();
}

function jbSelectStake(level) {
  if (jbDone || jbState === "rolling") return;
  jbSelectedStake = level;
  renderBicho();
}

function jbFormatBetDescription(bet) {
  if (!bet) return "";
  if (bet.mode === "dezena_cabeca") {
    const n = Number(bet.target);
    const g = n === 0 ? 25 : Math.ceil(n / 4);
    const animal = JB_ANIMALS[g - 1];
    return `Dezena ${bet.target} na Cabeça (${animal ? `${animal.emoji} ${animal.name}` : ""})`;
  }
  const animal = JB_ANIMALS[Number(bet.target) - 1];
  const label = animal ? `Grupo ${String(animal.group).padStart(2, "0")} — ${animal.emoji} ${animal.name}` : `Grupo ${bet.target}`;
  return bet.mode === "grupo_cercado" ? `${label} (Cercado 1º ao 5º)` : `${label} (Na Cabeça)`;
}

async function submitBichoBet() {
  if (jbDone || jbState === "rolling") return;

  const target = jbSelectedMode === "dezena_cabeca" ? jbSelectedDezena : jbSelectedGroup;
  if (jbSelectedMode === "dezena_cabeca") {
    if (!/^\d{2}$/.test(String(target))) {
      jbErrorMsg = "Escolha uma dezena de 2 dígitos (00 a 99).";
      renderBicho();
      return;
    }
  } else if (!target || target < 1 || target > 25) {
    jbErrorMsg = "Selecione um dos 25 bichos na tabela acima.";
    renderBicho();
    return;
  }

  jbErrorMsg = null;
  jbState = "rolling";
  renderBicho();

  try {
    const res = await fetch("/api/bicho/bet", {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({
        betAmount: jbSelectedStake,
        mode: jbSelectedMode,
        target,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      jbState = "ready";
      jbErrorMsg = data.error || "Erro ao registrar fézinha.";
      renderBicho();
      return;
    }

    setTimeout(() => {
      jbBalance = data.balance ?? jbBalance;
      jbDone = true;
      jbBet = data.bet;
      jbDraw = data.draw || [];
      jbTodayWinners = data.todayWinners || jbTodayWinners;
      jbRank = data.rank || jbRank;
      jbState = "ready";

      jbMarkDoneToday(data.date || jbDate);
      try {
        localStorage.removeItem(CACHE_PREFIX + "bicho_rank");
      } catch {}

      if (data.coinsWon > 0) showGameCoinsToast(data.coinsWon);
      else if (data.coinsLost > 0) showGameCoinsToast(-data.coinsLost);

      if (data.newAchievements && data.newAchievements.length > 0) {
        setTimeout(() => showAchievementToast(data.newAchievements), 1200);
      }

      renderBicho();
    }, 900);
  } catch {
    jbState = "ready";
    jbErrorMsg = "Erro de conexão com o servidor.";
    renderBicho();
  }
}

function jbBuildRankHTML() {
  let html = `<div class="section-label" style="color:#ffd75e">📅 Ganhadores de Hoje ("Deu no Poste")</div>`;
  if (!jbTodayWinners || jbTodayWinners.length === 0) {
    html += `<div class="no-data" style="color:#d6cba8">Ninguém ganhou no bicho hoje ainda.</div>`;
  } else {
    html += `<table class="win95-table" style="color:#111"><thead><tr><th>#</th><th>Jogador</th><th>Aposta</th><th>Prêmio</th></tr></thead><tbody>`;
    jbTodayWinners.forEach((w, i) => {
      html += `<tr class="${rankMedalClass(i)}">
        <td>${i + 1}º</td>
        <td>${renderPlayerName(w.name, true)}</td>
        <td>${escHtml(jbFormatBetDescription(w))}</td>
        <td><strong>+${w.coinsWon} LC</strong></td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `<div class="section-label" style="color:#ffd75e;margin-top:8px">🏆 Maiores Bicheiros (Geral)</div>`;
  if (!jbRank || jbRank.length === 0) {
    html += `<div class="no-data" style="color:#d6cba8">Nenhuma fézinha registrada ainda. Seja o primeiro!</div>`;
  } else {
    html += `<table class="win95-table" style="color:#111"><thead><tr><th>#</th><th>Jogador</th><th>LC Ganhos</th><th>Acertos</th><th>Fézinhas</th></tr></thead><tbody>`;
    jbRank.forEach((e, i) => {
      html += `<tr class="${rankMedalClass(i)}">
        <td>${i + 1}º</td>
        <td>${renderPlayerName(e.name, true)}</td>
        <td><strong>${e.coinsWon} LC</strong></td>
        <td>${e.wins}</td>
        <td>${e.betsPlayed}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  return html;
}

function jbBuildPosteResultHTML() {
  const matched = new Set((jbBet && jbBet.matchedPrizes) || []);
  const won = jbBet && jbBet.outcome === "win";
  const dateFmt = jbDate ? jbDate.split("-").reverse().join("/") : "";

  const rowsHtml = (jbDraw || [])
    .map((p) => {
      const isHit = matched.has(p.position);
      const prefix = String(p.milhar || "0000").slice(0, 2);
      const dezena = String(p.dezena || String(p.milhar || "0000").slice(-2));
      return `
        <div class="jb-prize-row ${isHit ? "jb-hit" : ""}">
          <span><strong>${p.position}º Prêmio</strong></span>
          <span class="jb-prize-milhar" title="Dezena ${dezena} → Grupo ${String(p.group).padStart(2, "0")} (${p.name})"><span class="jb-milhar-prefix">${prefix}</span><span class="jb-milhar-dezena">${dezena}</span></span>
          <span>Grupo ${String(p.group).padStart(2, "0")} — ${p.emoji} <strong>${p.name}</strong></span>
        </div>`;
    })
    .join("");

  const bannerHtml = won
    ? `<div class="jb-result-banner jb-result-win">
        🎉 <strong>DEU BICHO!</strong> Você acertou no ${jbBet.matchedPrizes.map((n) => `${n}º`).join(", ")} prêmio e ganhou <strong>+${jbBet.coinsWon} LuizCoins™</strong>!
       </div>`
    : `<div class="jb-result-banner jb-result-lose">
        😵 <strong>Não deu bicho hoje.</strong> Sua fézinha (${escHtml(jbFormatBetDescription(jbBet))}) não bateu. (−${jbBet ? jbBet.coinsLost : 0} LuizCoins™)
       </div>`;

  return `
    <div class="jb-poste-wrap">
      ${bannerHtml}
      <div class="jb-ticket">
        <div class="jb-ticket-header">📋 DEU NO POSTE — EXTRAÇÃO DO DIA (${dateFmt})</div>
        ${rowsHtml}
        <div style="margin-top:6px;font-size:11px;text-align:center;color:#5c4b22">
          Sua fézinha: <strong>${escHtml(jbFormatBetDescription(jbBet))}</strong> | Ficha: <strong>${jbBet ? jbBet.stake : 0} LC</strong>
        </div>
        <div style="margin-top:3px;font-size:10px;text-align:center;color:#7a6530">
          💡 Os 2 últimos dígitos em <strong>dourado</strong> formam a Dezena que define o Bicho.
        </div>
      </div>
      <div style="text-align:center;font-size:11px;color:#d6cba8">
        Volte amanhã para a próxima extração diária da Banca do Luiz!
      </div>
    </div>
  `;
}

function renderBicho() {
  const root = document.getElementById("bicho-root");
  if (!root) return;

  if (jbState === "loading") {
    root.innerHTML = `<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;color:#ffe066">⏳ Carregando Banca do Luiz...</div>`;
    return;
  }

  if (jbState === "unauth") {
    root.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center">
        <span style="font-size:32px">🔒</span>
        <div>Faça login para fazer sua fézinha no <strong>Luiz Bicho</strong>.</div>
        <button class="jb-submit-btn" onclick="openWindow('win-login')">Fazer Login</button>
      </div>`;
    return;
  }

  const dateFmt = jbDate ? jbDate.split("-").reverse().join("/") : "";

  const headerHtml = `
    <div class="jb-header">
      <div class="jb-title">🐯 BANCA DO LUIZ — JOGO DO BICHO</div>
      <div class="jb-topbar-info">
        <span>📅 ${dateFmt}</span>
        <span>💰 Saldo: <strong>${jbBalance} LC</strong></span>
      </div>
    </div>
    <div class="jb-tabs">
      <button class="jb-tab-btn ${jbView === "play" ? "active" : ""}" onclick="jbSetView('play')">📝 Fézinha do Dia</button>
      <button class="jb-tab-btn ${jbView === "rank" ? "active" : ""}" onclick="jbSetView('rank')">🏆 Ranking (${jbRank.length})</button>
    </div>
  `;

  if (jbView === "rank") {
    root.innerHTML = `${headerHtml}<div class="jb-body">${jbBuildRankHTML()}</div>`;
    return;
  }

  if (jbState === "rolling") {
    root.innerHTML = `
      ${headerHtml}
      <div class="jb-body" style="align-items:center;justify-content:center;text-align:center;gap:10px">
        <div style="font-size:38px">🎰🐯</div>
        <div style="font-size:14px;font-weight:bold;color:#ffd75e">Sorteando os 5 prêmios de hoje no Poste do Luiz...</div>
      </div>`;
    return;
  }

  if (jbDone && jbDraw) {
    root.innerHTML = `${headerHtml}<div class="jb-body">${jbBuildPosteResultHTML()}</div>`;
    return;
  }

  const selectedAnimal = jbSelectedGroup ? JB_ANIMALS[jbSelectedGroup - 1] : null;
  const stakeVal = JB_STAKE_VALUES[jbSelectedStake] || 5;
  const canSubmit = jbSelectedMode === "dezena_cabeca"
    ? /^\d{2}$/.test(jbSelectedDezena)
    : !!jbSelectedGroup;

  const dezenaBarHtml = jbSelectedMode === "dezena_cabeca"
    ? `<div class="jb-dezena-bar">
        <span>🔢 Escolha a Dezena ${selectedAnimal ? `do <strong>${selectedAnimal.emoji} ${selectedAnimal.name}</strong>` : "(00 a 99)"}:</span>
        <div class="jb-dezena-btns">
          ${selectedAnimal
            ? selectedAnimal.dezenas.map((d) => `<button class="jb-dez-btn ${jbSelectedDezena === d ? "active" : ""}" onclick="jbSelectDezena('${d}')">${d}</button>`).join("")
            : ""}
          <input type="text" maxlength="2" class="jb-dez-input" value="${escHtml(jbSelectedDezena)}" placeholder="00"
            oninput="jbSelectDezena(this.value)" />
        </div>
      </div>`
    : "";

  const animalsHtml = JB_ANIMALS.map((a) => {
    const isSel = jbSelectedGroup === a.group;
    return `
      <div class="jb-animal-card ${isSel ? "selected" : ""}" onclick="jbSelectAnimal(${a.group})">
        <span class="jb-animal-group">${String(a.group).padStart(2, "0")}</span>
        <div class="jb-animal-emoji">${a.emoji}</div>
        <div class="jb-animal-name">${a.name}</div>
        <div class="jb-animal-dezenas">${a.dezenas.join(" ")}</div>
      </div>`;
  }).join("");

  const errorHtml = jbErrorMsg
    ? `<div style="background:#8b0000;color:#fff;padding:5px 8px;border-radius:4px;font-size:11px;text-align:center">⚠️ ${escHtml(jbErrorMsg)}</div>`
    : "";

  root.innerHTML = `
    ${headerHtml}
    <div class="jb-body">
      <div class="jb-modes">
        <div class="jb-mode-card ${jbSelectedMode === "grupo_cabeca" ? "active" : ""}" onclick="jbSelectMode('grupo_cabeca')">
          <div class="jb-mode-name">🎯 Grupo na Cabeça</div>
          <div class="jb-mode-payout">1º Prêmio • Paga <strong>18x</strong></div>
        </div>
        <div class="jb-mode-card ${jbSelectedMode === "grupo_cercado" ? "active" : ""}" onclick="jbSelectMode('grupo_cercado')">
          <div class="jb-mode-name">🔄 Grupo Cercado</div>
          <div class="jb-mode-payout">1º ao 5º • Paga <strong>4x</strong></div>
        </div>
        <div class="jb-mode-card ${jbSelectedMode === "dezena_cabeca" ? "active" : ""}" onclick="jbSelectMode('dezena_cabeca')">
          <div class="jb-mode-name">🔢 Dezena Seca</div>
          <div class="jb-mode-payout">1º Prêmio • Paga <strong>60x</strong></div>
        </div>
      </div>

      ${dezenaBarHtml}

      <div class="jb-animals-grid">${animalsHtml}</div>

      ${errorHtml}

      <div class="jb-controls">
        <div class="jb-chips">
          <span style="font-size:11px;color:#e9dfba">Ficha:</span>
          <button class="jb-chip jb-chip-low ${jbSelectedStake === "low" ? "active" : ""}" onclick="jbSelectStake('low')">
            <span class="jb-chip-val">5</span><span class="jb-chip-lbl">LC</span>
          </button>
          <button class="jb-chip jb-chip-medium ${jbSelectedStake === "medium" ? "active" : ""}" onclick="jbSelectStake('medium')">
            <span class="jb-chip-val">15</span><span class="jb-chip-lbl">LC</span>
          </button>
          <button class="jb-chip jb-chip-high ${jbSelectedStake === "high" ? "active" : ""}" onclick="jbSelectStake('high')">
            <span class="jb-chip-val">30</span><span class="jb-chip-lbl">LC</span>
          </button>
        </div>
        <button class="jb-submit-btn" onclick="submitBichoBet()" ${!canSubmit ? "disabled" : ""}>
          📝 Fazer Fézinha (${stakeVal} LC)
        </button>
      </div>
    </div>
  `;
}

jbUpdateBadge();
