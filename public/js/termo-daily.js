// ==========================================
// TERMO DIÁRIO — Wordle em português, palavra fixa por dia
// ==========================================
// Espelha a arquitetura do Sudoku Diário (sudoku-daily.js): desafio gerado
// pelo servidor a partir da data (api/lib/termo-daily.js), mesmo pra todo
// mundo, 1 tentativa "completa" (até 6 palpites) por dia. A palavra nunca é
// enviada ao cliente antes do jogo acabar — cada palpite é validado no
// servidor (POST /api/termo-daily/guess), que devolve só as cores da linha.

const TDD_WORD_LENGTH = 5;
const TDD_MAX_ATTEMPTS = 6;
const TDD_KEYBOARD_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"],
];
// Prioridade de cor no teclado: uma letra que já foi "correct" numa tentativa
// nunca deve regredir pra "present"/"absent" só porque apareceu errada numa
// tentativa anterior a essa.
const TDD_STATUS_RANK = { absent: 0, present: 1, correct: 2 };

let tddDate = null;
let tddGuesses = [];
let tddWon = false;
let tddDone = false;
let tddWord = null;
let tddCurrentGuess = "";
let tddKeyboardStatus = {};
let tddTodayRank = [];
let tddAllTimeWins = [];
let tddView = "play"; // play | rank
let tddErrorMsg = null;
let tddSubmitting = false;
let tddShake = false;
// Linhas cuja animação de virada já foi disparada — o grid inteiro é
// reconstruído via innerHTML a cada render (inclusive a cada tecla digitada
// na linha atual), então uma linha já submetida ganharia elementos NOVOS do
// DOM em todo re-render e a animação replicaria de novo a cada letra digitada
// depois dela. Uma vez na lista, a linha nunca mais recebe a classe de
// animação — só o resultado final (cor), sem re-tocar o efeito.
let tddAnimatedRows = new Set();

function openTermoDailyWindow() {
  openWindow("win-termo-daily");
  initTermoDaily();
}

// ─── Bolinha de "ainda não fez hoje" ─────────────────────────────────────────
// Mesmo esquema do Sudoku Diário: só lê localStorage, nunca dispara uma
// requisição só pra decidir se mostra a bolinha.
function tddTodayKeyLocal() {
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  const dd = String(local.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function tddDoneKey(date) {
  return `luizos_termo_daily_done_${date}`;
}

function tddHasDoneToday() {
  try {
    return localStorage.getItem(tddDoneKey(tddTodayKeyLocal())) === "1";
  } catch {
    return false;
  }
}

function tddMarkDoneToday(date) {
  try { localStorage.setItem(tddDoneKey(date || tddTodayKeyLocal()), "1"); } catch {}
  tddUpdateBadge();
}

function tddUpdateBadge() {
  const show = !tddHasDoneToday();
  document.querySelectorAll(".tdd-badge-dot, .tdd-badge-corner").forEach((el) => {
    el.classList.toggle("show", show);
  });
}

function tddComputeKeyboardStatus(guesses) {
  const status = {};
  for (const g of guesses) {
    for (let i = 0; i < g.word.length; i++) {
      const letter = g.word[i];
      const s = g.statuses[i];
      if (!status[letter] || TDD_STATUS_RANK[s] > TDD_STATUS_RANK[status[letter]]) {
        status[letter] = s;
      }
    }
  }
  return status;
}

async function initTermoDaily() {
  tddView = "play";
  tddErrorMsg = null;
  tddCurrentGuess = "";
  tddSubmitting = false;
  tddAnimatedRows = new Set();
  renderTermoDaily();

  if (!sessionToken) {
    tddErrorMsg = "unauth";
    renderTermoDaily();
    return;
  }

  try {
    const res = await fetch(`${API}/termo-daily/status`, { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar.");

    tddDate = data.date;
    tddGuesses = data.guesses || [];
    // Palpites que já existiam antes desta carga (ex.: reabriu a janela no
    // meio do jogo) não devem tocar a animação de novo — só os que forem
    // submetidos a partir de agora entram no fluxo normal de tddSubmitGuess.
    tddGuesses.forEach((_, i) => tddAnimatedRows.add(i));
    tddWon = data.won;
    tddDone = data.done;
    tddWord = data.word;
    tddTodayRank = data.todayRank || [];
    tddAllTimeWins = data.allTimeWins || [];
    tddKeyboardStatus = tddComputeKeyboardStatus(tddGuesses);

    if (tddDone) tddMarkDoneToday(tddDate);
  } catch (e) {
    tddErrorMsg = e.message || "Erro ao carregar o desafio de hoje.";
  }
  renderTermoDaily();
}

function tddSetView(view) {
  tddView = view;
  renderTermoDaily();
}

// ─── Input físico do teclado ──────────────────────────────────────────────
function tddPressKey(key) {
  if (tddDone || tddSubmitting || !tddDate) return;
  if (key === "ENTER") {
    tddSubmitGuess();
  } else if (key === "⌫" || key === "BACKSPACE") {
    tddCurrentGuess = tddCurrentGuess.slice(0, -1);
    renderTermoDaily();
  } else if (/^[A-Z]$/.test(key) && tddCurrentGuess.length < TDD_WORD_LENGTH) {
    tddCurrentGuess += key;
    renderTermoDaily();
  }
}

document.addEventListener("keydown", (e) => {
  const win = document.getElementById("win-termo-daily");
  if (!win || win.style.display === "none") return;
  if (e.key === "Enter") tddPressKey("ENTER");
  else if (e.key === "Backspace") tddPressKey("⌫");
  else if (/^[a-zA-Z]$/.test(e.key)) tddPressKey(e.key.toUpperCase());
});

async function tddSubmitGuess() {
  if (tddCurrentGuess.length !== TDD_WORD_LENGTH) {
    tddShake = true;
    renderTermoDaily();
    setTimeout(() => { tddShake = false; renderTermoDaily(); }, 500);
    return;
  }

  tddSubmitting = true;
  try {
    const res = await fetch(`${API}/termo-daily/guess`, {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ word: tddCurrentGuess }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao enviar palpite.");

    tddGuesses.push({ word: tddCurrentGuess, statuses: data.statuses });
    tddKeyboardStatus = tddComputeKeyboardStatus(tddGuesses);
    tddCurrentGuess = "";
    tddWon = data.won;
    tddDone = data.done;
    if (data.word) tddWord = data.word;
    if (data.todayRank) tddTodayRank = data.todayRank;
    if (tddDone) tddMarkDoneToday(tddDate);
  } catch (e) {
    tddErrorMsg = e.message || "Erro ao enviar palpite.";
  }
  tddSubmitting = false;
  renderTermoDaily();
}

// ─── Rendering ────────────────────────────────────────────────────────────
function tddBuildGridHTML() {
  let html = "";
  for (let r = 0; r < TDD_MAX_ATTEMPTS; r++) {
    const submitted = tddGuesses[r];
    const isCurrentRow = !submitted && r === tddGuesses.length;
    const rowLetters = submitted ? submitted.word.split("") : (isCurrentRow ? tddCurrentGuess.split("") : []);
    const rowClasses = ["tdd-row"];
    if (isCurrentRow && tddShake) rowClasses.push("tdd-shake");

    // Uma linha só ganha a classe de animação UMA vez — depois disso fica
    // marcada em tddAnimatedRows e nunca mais recebe "tdd-flip", mesmo sendo
    // reconstruída via innerHTML a cada tecla digitada na linha seguinte.
    const shouldAnimate = submitted && !tddAnimatedRows.has(r);
    if (shouldAnimate) tddAnimatedRows.add(r);

    let cellsHtml = "";
    for (let c = 0; c < TDD_WORD_LENGTH; c++) {
      const letter = rowLetters[c] || "";
      const status = submitted ? submitted.statuses[c] : null;
      const cellClasses = ["tdd-cell"];
      if (status) cellClasses.push(`tdd-${status}`);
      else if (letter) cellClasses.push("tdd-filled");
      if (shouldAnimate) {
        cellClasses.push("tdd-flip");
        cellsHtml += `<div class="${cellClasses.join(" ")}" style="animation-delay:${c * 120}ms">${letter}</div>`;
      } else {
        cellsHtml += `<div class="${cellClasses.join(" ")}">${letter}</div>`;
      }
    }
    html += `<div class="${rowClasses.join(" ")}">${cellsHtml}</div>`;
  }
  return html;
}

function tddBuildKeyboardHTML() {
  return TDD_KEYBOARD_ROWS.map((row) => {
    const keys = row.map((key) => {
      const isSpecial = key === "ENTER" || key === "⌫";
      const status = tddKeyboardStatus[key];
      const classes = ["tdd-key"];
      if (isSpecial) classes.push("tdd-key-wide");
      if (status) classes.push(`tdd-key-${status}`);
      return `<button class="${classes.join(" ")}" onclick="tddPressKey('${key === "⌫" ? "⌫" : key}')">${key === "ENTER" ? "Enter" : key}</button>`;
    }).join("");
    return `<div class="tdd-key-row">${keys}</div>`;
  }).join("");
}

function tddBuildRankTable(rows) {
  if (!rows || rows.length === 0) return '<div class="no-data">Ninguém ainda hoje. Seja o primeiro!</div>';
  let html = `<table class="win95-table"><thead><tr><th>#</th><th>Jogador</th><th>Tentativas</th></tr></thead><tbody>`;
  rows.forEach((row, i) => {
    html += `<tr class="${rankMedalClass(i)}"><td>${i + 1}º</td><td>${renderPlayerName(row.name, true)}</td><td><strong>${row.attempts}/${TDD_MAX_ATTEMPTS}</strong></td></tr>`;
  });
  return html + "</tbody></table>";
}

function tddBuildWinsTable(rows) {
  if (!rows || rows.length === 0) return '<div class="no-data">Ninguém venceu ainda. Seja o primeiro!</div>';
  let html = `<table class="win95-table"><thead><tr><th>#</th><th>Jogador</th><th>Vitórias</th></tr></thead><tbody>`;
  rows.forEach((row, i) => {
    html += `<tr class="${rankMedalClass(i)}"><td>${i + 1}º</td><td>${renderPlayerName(row.name, true)}</td><td><strong>${row.count}</strong></td></tr>`;
  });
  return html + "</tbody></table>";
}

function renderTermoDaily() {
  const root = document.getElementById("termo-daily-content");
  if (!root) return;

  if (tddErrorMsg === "unauth") {
    root.innerHTML = `<div class="ms-session-warning" style="display:block">🔒 Faça login pra jogar o Termo Diário.</div>`;
    return;
  }
  if (!tddDate && tddErrorMsg) {
    root.innerHTML = `<div class="ms-session-warning" style="display:block">⚠️ ${tddErrorMsg}</div>`;
    return;
  }
  if (!tddDate) {
    root.innerHTML = `<div class="loading">⏳ Carregando desafio de hoje...</div>`;
    return;
  }

  const tabsHtml = `
    <div class="btn-row" style="justify-content:center;margin-bottom:6px;gap:8px">
      <button class="win95-action-btn ${tddView === "play" ? "active" : ""}" onclick="tddSetView('play')">🟩 Desafio</button>
      <button class="win95-action-btn ${tddView === "rank" ? "active" : ""}" onclick="tddSetView('rank')">🏆 Ranking</button>
    </div>`;

  if (tddView === "rank") {
    root.innerHTML = `
      ${tabsHtml}
      <div class="section-label">📅 Hoje — Venceram em menos tentativas</div>
      ${tddBuildRankTable(tddTodayRank)}
      <div class="section-label" style="margin-top:8px">🏆 Recordes — Mais vitórias no total</div>
      ${tddBuildWinsTable(tddAllTimeWins)}
    `;
    return;
  }

  const errorHtml = tddErrorMsg ? `<div class="ms-session-warning" style="display:block;margin-top:4px">⚠️ ${escHtml(tddErrorMsg)}</div>` : "";

  let resultHtml = "";
  if (tddDone) {
    resultHtml = `
      <div class="info-box tdd-result ${tddWon ? "tdd-result-win" : "tdd-result-lose"}" style="text-align:center;font-size:13px;margin-top:6px">
        ${tddWon
          ? `🎉 <strong>Você acertou!</strong> A palavra era <strong>${tddWord}</strong>, em ${tddGuesses.length}/${TDD_MAX_ATTEMPTS} tentativas.`
          : `😵 <strong>Não foi dessa vez.</strong> A palavra era <strong>${tddWord}</strong>.`}
        <br><span style="font-size:11px;color:#666">Volte amanhã pra uma nova palavra!</span>
      </div>`;
  }

  root.innerHTML = `
    ${tabsHtml}
    <div class="tdd-board">${tddBuildGridHTML()}</div>
    <div class="tdd-keyboard">${tddBuildKeyboardHTML()}</div>
    ${resultHtml}
    ${errorHtml}
    ${!tddDone ? `<div class="info-box" style="font-size:10px;margin-top:6px">Palavra de hoje (5 letras) — mesma pra todo mundo. Digite e aperte Enter. 6 tentativas, só 1 vez por dia.</div>` : ""}
  `;
}

// Atualiza a bolinha assim que o script carrega, só lendo localStorage.
tddUpdateBadge();
