// ==========================================
// SUDOKU 95 - Vanilla JS
// ==========================================

// ─── DIFFICULTY CONFIG ─────────────────────
const SD_DIFFICULTIES = {
  easy:   { remove: 35 },
  medium: { remove: 45 },
  hard:   { remove: 55 },
};

const SD_MAX_MISTAKES = 3;

let currentSdDifficulty = "easy";
let sdSolution = [];
let sdGivenMask = []; // true = célula original (não editável)
let sdBoard = [];     // valores atuais digitados pelo jogador
let sdCells = [];     // elementos DOM [r][c]
let sdSelected = null; // {r, c}
let sdMistakes = 0;
let sdTimer = 0;
let sdInterval = null;
let sdGameOver = false;
let sdPaid = false;
let sdRoundToken = null;

/**
 * Abre a janela do Sudoku, inicializa o tabuleiro e valida a sessão.
 */
function openSudokuWindow() {
  openWindow("win-sudoku");
  initSudoku();
  checkSdSessionValidity();
  const w = document.getElementById("win-sudoku");
  if (w) {
    centerWindow(w);
    clampWindowToViewport(w);
  }
}

/**
 * Testa se a sessão atual consegue salvar o rank ao final da partida.
 */
async function checkSdSessionValidity() {
  const warningEl = document.getElementById("sd-session-warning");
  if (!warningEl) return;

  if (!currentUser || !sessionToken) {
    warningEl.style.display = "block";
    return;
  }

  try {
    const res = await fetch(`${API}/session-check`, {
      headers: authHeaders(sessionToken),
    });
    warningEl.style.display = res.ok ? "none" : "block";
  } catch (e) {
    warningEl.style.display = "block";
  }
}

// ─── DIFFICULTY SWITCHING ──────────────────

function setSdDifficulty(diff) {
  currentSdDifficulty = diff;

  document.querySelectorAll(".sd-diff-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.diff === diff);
  });

  initSudoku();
}

/**
 * Inicializa e reseta o jogo com a dificuldade atual
 */
function initSudoku() {
  stopSudoku();

  sdSolution = generateSdSolution();
  const config = SD_DIFFICULTIES[currentSdDifficulty] || SD_DIFFICULTIES.easy;
  const puzzle = buildSdPuzzle(sdSolution, config.remove);

  sdBoard = puzzle.map((row) => row.slice());
  sdGivenMask = puzzle.map((row) => row.map((v) => v !== 0));
  sdSelected = null;
  sdMistakes = 0;
  sdTimer = 0;
  sdGameOver = false;
  sdPaid = false;
  sdRoundToken = null;

  document.getElementById("sd-face").innerText = "🙂";
  updateSdCounters();
  renderSdGrid();
  sdSetDifficultyButtonsEnabled(true);
  refreshGameZoom("win-sudoku");

  const boardContainer = document.querySelector("#win-sudoku .ms-board-container");
  arcadeInsertCoin(boardContainer, "sudoku", currentSdDifficulty).then((result) => {
    if (!result.started) return;
    sdPaid = true;
    sdRoundToken = result.roundToken;
    sdSetDifficultyButtonsEnabled(false);
    startSdTimer();
  });
}

function sdSetDifficultyButtonsEnabled(enabled) {
  document.querySelectorAll(".sd-diff-btn").forEach((b) => { b.disabled = !enabled; });
}

// ─── GENERATION ─────────────────────────────

function sdShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sdIsValid(board, r, c, n) {
  for (let i = 0; i < 9; i++) {
    if (board[r][i] === n || board[i][c] === n) return false;
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++) {
    for (let j = bc; j < bc + 3; j++) {
      if (board[i][j] === n) return false;
    }
  }
  return true;
}

function sdFillBoard(board) {
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9), c = i % 9;
    if (board[r][c] !== 0) continue;
    for (const n of sdShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
      if (sdIsValid(board, r, c, n)) {
        board[r][c] = n;
        if (sdFillBoard(board)) return true;
        board[r][c] = 0;
      }
    }
    return false;
  }
  return true;
}

function generateSdSolution() {
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  sdFillBoard(board);
  return board;
}

function buildSdPuzzle(solution, removeCount) {
  const puzzle = solution.map((row) => row.slice());
  const positions = sdShuffle(
    Array.from({ length: 81 }, (_, i) => i),
  ).slice(0, removeCount);
  positions.forEach((pos) => {
    const r = Math.floor(pos / 9), c = pos % 9;
    puzzle[r][c] = 0;
  });
  return puzzle;
}

// ─── RENDERING ──────────────────────────────

function renderSdGrid() {
  const grid = document.getElementById("sd-grid");
  grid.innerHTML = "";
  sdCells = [];

  for (let r = 0; r < 9; r++) {
    sdCells[r] = [];
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement("div");
      cell.className = "sd-cell";
      if (sdGivenMask[r][c]) cell.classList.add("given");
      if (c % 3 === 0) cell.classList.add("sd-border-left");
      if (r % 3 === 0) cell.classList.add("sd-border-top");
      if (c === 8) cell.classList.add("sd-border-right");
      if (r === 8) cell.classList.add("sd-border-bottom");

      cell.dataset.r = r;
      cell.dataset.c = c;
      cell.innerText = sdBoard[r][c] || "";
      cell.addEventListener("click", () => selectSdCell(r, c));

      grid.appendChild(cell);
      sdCells[r][c] = cell;
    }
  }
}

function selectSdCell(r, c) {
  if (!sdPaid || sdGameOver || sdGivenMask[r][c]) return;
  if (sdSelected) {
    sdCells[sdSelected.r][sdSelected.c].classList.remove("selected");
  }
  sdSelected = { r, c };
  sdCells[r][c].classList.add("selected");
}

/**
 * Preenche a célula selecionada com um número (1-9) e valida contra a solução
 */
function inputSdNumber(num) {
  if (sdGameOver || !sdSelected) return;
  const { r, c } = sdSelected;
  const cell = sdCells[r][c];

  sdBoard[r][c] = num;
  cell.innerText = num;
  cell.classList.remove("wrong");

  if (num !== sdSolution[r][c]) {
    cell.classList.add("wrong");
    sdMistakes++;
    updateSdCounters();
    if (sdMistakes >= SD_MAX_MISTAKES) {
      triggerSdGameOver(false);
      return;
    }
  } else {
    checkSdWin();
  }
}

function eraseSdCell() {
  if (sdGameOver || !sdSelected) return;
  const { r, c } = sdSelected;
  sdBoard[r][c] = 0;
  sdCells[r][c].innerText = "";
  sdCells[r][c].classList.remove("wrong");
}

document.addEventListener("keydown", (e) => {
  const win = document.getElementById("win-sudoku");
  if (!win || win.style.display === "none" || sdGameOver) return;
  if (e.key >= "1" && e.key <= "9") inputSdNumber(Number(e.key));
  else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") eraseSdCell();
});

function checkSdWin() {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (sdBoard[r][c] !== sdSolution[r][c]) return;
    }
  }
  triggerSdGameOver(true);
}

/**
 * Finaliza o jogo — vitória usa o tempo como pontuação (menor é melhor → score = 9999 - tempo)
 */
function triggerSdGameOver(won) {
  sdGameOver = true;
  stopSdTimer();
  const faceBtn = document.getElementById("sd-face");

  sdSetDifficultyButtonsEnabled(true);

  if (won) {
    faceBtn.innerText = "😎";
    const winScore = Math.max(1, 9999 - sdTimer);
    submitGameScore("sudoku", currentSdDifficulty, winScore, function (coinsEarned) {
      showGameCoinsToast(coinsEarned - ARCADE_ENTRY_FEE_DISPLAY);
    }, undefined, { roundToken: sdRoundToken });
  } else {
    faceBtn.innerText = "😵";
    if (sdPaid) {
      forfeitGameRound(sdRoundToken);
      showGameCoinsToast(-ARCADE_ENTRY_FEE_DISPLAY);
    }
  }
}

// ─── TIMER & COUNTERS ─────────────────────

function startSdTimer() {
  if (sdInterval) clearInterval(sdInterval);
  sdInterval = setInterval(() => {
    if (sdTimer < 9999) sdTimer++;
    updateSdCounters();
  }, 1000);
}

function stopSdTimer() {
  if (sdInterval) clearInterval(sdInterval);
}

function stopSudoku() {
  stopSdTimer();
}

function updateSdCounters() {
  const mistakesStr = sdMistakes.toString().padStart(1, "0");
  const timerStr = sdTimer.toString().padStart(3, "0");
  document.getElementById("sd-mistakes").innerText = `${mistakesStr}/${SD_MAX_MISTAKES}`;
  document.getElementById("sd-timer").innerText = timerStr;
}
