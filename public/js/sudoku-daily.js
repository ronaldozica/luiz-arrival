// ==========================================
// SUDOKU DIÁRIO — puzzle fixo por dia, com ranking
// ==========================================
// Diferente do Sudoku normal (sudoku.js): o puzzle é o MESMO pra todo mundo
// no dia, gerado pelo servidor (api/lib/sudoku-daily.js) — por isso a solução
// nunca é enviada ao cliente (senão vazaria pra todo mundo naquele dia). A
// validação de erro aqui é por conflito de regra (linha/coluna/quadrante),
// não por comparação com uma solução local. A vitória só é confirmada de
// verdade pelo servidor em POST /api/sudoku-daily/submit.
//
// Grade 6x6 (caixas de 2 linhas x 3 colunas) — mesmo tamanho do "Mini Sudoku"
// diário do LinkedIn. Espelha GRID_SIZE/BOX_ROWS/BOX_COLS de
// api/lib/sudoku-daily.js; mudar lá exige mudar aqui também.

const SDD_SIZE = 6;
const SDD_BOX_ROWS = 2;
const SDD_BOX_COLS = 3;
const SDD_MAX_MISTAKES = 3;

let sddDate = null;
let sddPuzzle = null;
let sddGivenMask = null;
let sddBoard = null;
let sddSelected = null; // {r, c}
let sddMistakes = 0;
let sddGameOver = false;
let sddAlreadyPlayed = false;
let sddResult = null;
let sddTodayRank = [];
let sddAllTimeFirsts = [];
let sddRoundToken = null;
let sddView = "play"; // play | rank
let sddErrorMsg = null;

function openSudokuDailyWindow() {
  openWindow("win-sudoku-daily");
  initSudokuDaily();
}

// ─── Bolinha de "ainda não fez hoje" ─────────────────────────────────────────
// Só lê localStorage — nunca dispara uma requisição só pra decidir se mostra
// a bolinha. O estado real só é confirmado quando o jogador de fato abre a
// janela (GET /api/sudoku-daily/status), momento em que gravamos o resultado
// aqui pra próxima vez que a página carregar já saber sem perguntar de novo.
function sddTodayKeyLocal() {
  // Mesma lógica de getBrasiliaDate()+todayKey() em api/lib/datetime.js —
  // mudar lá exige mudar aqui também.
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(now.getTime() + (offset + now.getTimezoneOffset()) * 60000);
  const yyyy = local.getFullYear();
  const mm = String(local.getMonth() + 1).padStart(2, "0");
  const dd = String(local.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sddDoneKey(date) {
  return `luizos_sudoku_daily_done_${date}`;
}

function sddHasDoneToday() {
  try {
    return localStorage.getItem(sddDoneKey(sddTodayKeyLocal())) === "1";
  } catch {
    return false;
  }
}

function sddMarkDoneToday(date) {
  try { localStorage.setItem(sddDoneKey(date || sddTodayKeyLocal()), "1"); } catch {}
  sddUpdateBadge();
}

function sddUpdateBadge() {
  const show = !sddHasDoneToday();
  document.querySelectorAll(".sdd-badge-dot, .sdd-badge-corner").forEach((el) => {
    el.classList.toggle("show", show);
  });
}

function sddProgressKey(date) {
  return `luizos_sudoku_daily_${date}`;
}

function sddSaveProgress() {
  if (!sddDate) return;
  try {
    localStorage.setItem(sddProgressKey(sddDate), JSON.stringify({
      board: sddBoard, mistakes: sddMistakes, roundToken: sddRoundToken,
    }));
  } catch {}
}

function sddLoadProgress(date) {
  try {
    const raw = localStorage.getItem(sddProgressKey(date));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function sddClearProgress(date) {
  try { localStorage.removeItem(sddProgressKey(date)); } catch {}
}

async function initSudokuDaily() {
  sddView = "play";
  sddErrorMsg = null;
  sddSelected = null;
  renderSudokuDaily(); // mostra "carregando..."

  if (!sessionToken) {
    sddErrorMsg = "unauth";
    renderSudokuDaily();
    return;
  }

  try {
    const res = await fetch(`${API}/sudoku-daily/status`, { headers: authHeaders(sessionToken) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao carregar.");

    sddDate = data.date;
    sddPuzzle = data.puzzle;
    sddGivenMask = data.puzzle.map((row) => row.map((v) => v !== 0));
    sddAlreadyPlayed = data.alreadyPlayed;
    sddResult = data.result;
    sddTodayRank = data.todayRank || [];
    sddAllTimeFirsts = data.allTimeFirsts || [];
    sddGameOver = data.alreadyPlayed;

    if (data.alreadyPlayed) {
      sddMarkDoneToday(sddDate);
      renderSudokuDaily();
      return;
    }

    const saved = sddLoadProgress(sddDate);
    if (saved && saved.roundToken) {
      sddBoard = saved.board;
      sddMistakes = saved.mistakes || 0;
      sddRoundToken = saved.roundToken;
    } else {
      sddBoard = data.puzzle.map((row) => row.slice());
      sddMistakes = 0;
      const startRes = await fetch(`${API}/sudoku-daily/start`, {
        method: "POST",
        headers: authHeaders(sessionToken),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Erro ao iniciar.");
      sddRoundToken = startData.roundToken;
      sddSaveProgress();
    }
  } catch (e) {
    sddErrorMsg = e.message || "Erro ao carregar o desafio de hoje.";
  }
  renderSudokuDaily();
}

function sddSetView(view) {
  sddView = view;
  renderSudokuDaily();
}

// ─── Validação por conflito de regra (sem solução local) ────────────────────
function sddHasConflict(board, r, c, n) {
  for (let i = 0; i < SDD_SIZE; i++) {
    if (i !== c && board[r][i] === n) return true;
    if (i !== r && board[i][c] === n) return true;
  }
  const br = Math.floor(r / SDD_BOX_ROWS) * SDD_BOX_ROWS, bc = Math.floor(c / SDD_BOX_COLS) * SDD_BOX_COLS;
  for (let i = br; i < br + SDD_BOX_ROWS; i++) {
    for (let j = bc; j < bc + SDD_BOX_COLS; j++) {
      if ((i !== r || j !== c) && board[i][j] === n) return true;
    }
  }
  return false;
}

function sddComputeWrongCells() {
  const wrong = new Set();
  for (let r = 0; r < SDD_SIZE; r++) {
    for (let c = 0; c < SDD_SIZE; c++) {
      const n = sddBoard[r][c];
      if (n && sddHasConflict(sddBoard, r, c, n)) wrong.add(`${r},${c}`);
    }
  }
  return wrong;
}

function sddIsBoardComplete() {
  for (let r = 0; r < SDD_SIZE; r++) {
    for (let c = 0; c < SDD_SIZE; c++) {
      if (!sddBoard[r][c]) return false;
    }
  }
  return true;
}

// ─── Input ────────────────────────────────────────────────────────────────
function selectSddCell(r, c) {
  if (sddGameOver || !sddBoard || sddGivenMask[r][c]) return;
  sddSelected = { r, c };
  renderSudokuDaily();
}

function inputSddNumber(num) {
  if (sddGameOver || !sddSelected || !sddBoard) return;
  const { r, c } = sddSelected;
  if (sddGivenMask[r][c]) return;

  const wasConflict = sddHasConflict(sddBoard, r, c, num);
  sddBoard[r][c] = num;
  if (wasConflict) sddMistakes++;
  sddSaveProgress();

  if (sddMistakes >= SDD_MAX_MISTAKES) {
    triggerSddGameOver(false);
    return;
  }
  if (sddIsBoardComplete() && sddComputeWrongCells().size === 0) {
    triggerSddGameOver(true);
    return;
  }
  renderSudokuDaily();
}

function eraseSddCell() {
  if (sddGameOver || !sddSelected || !sddBoard) return;
  const { r, c } = sddSelected;
  if (sddGivenMask[r][c]) return;
  sddBoard[r][c] = 0;
  sddSaveProgress();
  renderSudokuDaily();
}

document.addEventListener("keydown", (e) => {
  const win = document.getElementById("win-sudoku-daily");
  if (!win || win.style.display === "none" || sddGameOver) return;
  if (e.key >= "1" && e.key <= "6") inputSddNumber(Number(e.key));
  else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") eraseSddCell();
});

// ─── Fim de jogo ──────────────────────────────────────────────────────────
async function triggerSddGameOver(won) {
  sddGameOver = true;
  renderSudokuDaily(); // trava a UI enquanto confirma com o servidor

  try {
    const res = await fetch(`${API}/sudoku-daily/submit`, {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: JSON.stringify({ board: sddBoard, mistakes: sddMistakes, roundToken: sddRoundToken }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao enviar resultado.");

    sddClearProgress(sddDate);
    sddAlreadyPlayed = true;
    sddResult = { won: data.won, timeSeconds: data.timeSeconds, mistakes: sddMistakes };
    sddTodayRank = data.todayRank || sddTodayRank;
    sddMarkDoneToday(sddDate);
  } catch (e) {
    sddErrorMsg = e.message || "Erro ao enviar resultado.";
  }
  renderSudokuDaily();
}

// ─── Rendering ────────────────────────────────────────────────────────────
function sddFormatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function buildSddGridHTML() {
  const wrongCells = sddComputeWrongCells();
  let html = "";
  for (let r = 0; r < SDD_SIZE; r++) {
    for (let c = 0; c < SDD_SIZE; c++) {
      const classes = ["sd-cell"];
      if (sddGivenMask[r][c]) classes.push("given");
      if (c % SDD_BOX_COLS === 0) classes.push("sd-border-left");
      if (r % SDD_BOX_ROWS === 0) classes.push("sd-border-top");
      if (c === SDD_SIZE - 1) classes.push("sd-border-right");
      if (r === SDD_SIZE - 1) classes.push("sd-border-bottom");
      if (sddSelected && sddSelected.r === r && sddSelected.c === c) classes.push("selected");
      if (wrongCells.has(`${r},${c}`)) classes.push("wrong");
      const val = sddBoard[r][c] || "";
      html += `<div class="${classes.join(" ")}" onclick="selectSddCell(${r},${c})">${val}</div>`;
    }
  }
  return html;
}

function buildSddRankTable(rows, { timeCol }) {
  if (!rows || rows.length === 0) return '<div class="no-data">Ninguém ainda hoje. Seja o primeiro!</div>';
  let html = `<table class="win95-table"><thead><tr><th>#</th><th>Jogador</th><th>${timeCol ? "Tempo" : "Vitórias"}</th></tr></thead><tbody>`;
  rows.forEach((row, i) => {
    const value = timeCol ? sddFormatTime(row.timeSeconds) : row.count;
    html += `<tr class="${rankMedalClass(i)}"><td>${i + 1}º</td><td>${renderPlayerName(row.name, true)}</td><td><strong>${value}</strong></td></tr>`;
  });
  return html + "</tbody></table>";
}

function renderSudokuDaily() {
  const root = document.getElementById("sudoku-daily-content");
  if (!root) return;

  if (sddErrorMsg === "unauth") {
    root.innerHTML = `<div class="ms-session-warning" style="display:block">🔒 Faça login pra jogar o Sudoku Diário.</div>`;
    return;
  }
  if (sddErrorMsg) {
    root.innerHTML = `<div class="ms-session-warning" style="display:block">⚠️ ${sddErrorMsg}</div>`;
    return;
  }
  if (!sddDate) {
    root.innerHTML = `<div class="loading">⏳ Carregando desafio de hoje...</div>`;
    return;
  }

  const rankHtml = `
    <div class="btn-row" style="justify-content:center;margin-bottom:6px;gap:8px">
      <button class="win95-action-btn ${sddView === "play" ? "active" : ""}" onclick="sddSetView('play')">🧩 Desafio</button>
      <button class="win95-action-btn ${sddView === "rank" ? "active" : ""}" onclick="sddSetView('rank')">🏆 Ranking</button>
    </div>`;

  if (sddView === "rank") {
    root.innerHTML = `
      ${rankHtml}
      <div class="section-label">📅 Hoje — Mais rápidos</div>
      ${buildSddRankTable(sddTodayRank, { timeCol: true })}
      <div class="section-label" style="margin-top:8px">🏆 Recordes — Mais 1º lugares</div>
      ${buildSddRankTable(sddAllTimeFirsts, { timeCol: false })}
    `;
    return;
  }

  if (sddAlreadyPlayed) {
    const won = sddResult && sddResult.won;
    root.innerHTML = `
      ${rankHtml}
      <div class="info-box" style="text-align:center;font-size:13px">
        ${won
          ? `😎 <strong>Você já venceu o desafio de hoje!</strong><br>Tempo: <strong>${sddFormatTime(sddResult.timeSeconds)}</strong>`
          : `😵 <strong>Você já tentou o desafio de hoje</strong> e não conseguiu dessa vez.`}
        <br><span style="font-size:11px;color:#666">Volte amanhã pra um novo puzzle!</span>
      </div>
    `;
    return;
  }

  root.innerHTML = `
    ${rankHtml}
    <div class="ms-header">
      <div class="ms-counter">${sddMistakes}/${SDD_MAX_MISTAKES}</div>
      <div class="ms-face">🙂</div>
      <div class="ms-counter" style="visibility:hidden">000</div>
    </div>
    <div class="ms-board-container">
      <div class="sdd-grid">${buildSddGridHTML()}</div>
    </div>
    <div class="sdd-numpad">
      ${[1, 2, 3, 4, 5, 6].map((n) => `<button class="win95-action-btn" onclick="inputSddNumber(${n})">${n}</button>`).join("")}
      <button class="win95-action-btn" onclick="eraseSddCell()">⌫</button>
    </div>
    <div class="info-box" style="font-size:10px;margin-top:4px">
      Puzzle de hoje (6x6) — mesmo pra todo mundo. Clique numa célula e digite 1-6. 3 erros encerram a tentativa, e só dá pra tentar 1 vez por dia.
    </div>
  `;
}

// Atualiza a bolinha assim que o script carrega (sem esperar a janela abrir),
// só lendo localStorage — nenhuma requisição disparada aqui.
sddUpdateBadge();
