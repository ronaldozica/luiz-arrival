// ==========================================
// CAMPO MINADO 95 - Vanilla JS  (v2)
// ==========================================

// ─── DIFFICULTY CONFIG ─────────────────────
const MS_DIFFICULTIES = {
  beginner:     { rows: 9,  cols: 9,  mines: 10, cellSize: 22 },
  intermediate: { rows: 16, cols: 16, mines: 40, cellSize: 20 },
  expert:       { rows: 16, cols: 30, mines: 99, cellSize: 18 },
};

let currentMsDifficulty = "beginner";
let MS_ROWS, MS_COLS, MS_MINES;

let msBoard = [];
let msMinesLeft = 0;
let msTimer = 0;
let msInterval = null;
let msGameOver = false;
let msFirstClick = true;
let msRevealedCount = 0;

// ─── DIFFICULTY SWITCHING ──────────────────

function setMsDifficulty(diff) {
  currentMsDifficulty = diff;

  // Update button states
  document.querySelectorAll(".ms-diff-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.diff === diff);
  });

  initMinesweeper();
}

/**
 * Inicializa e reseta o jogo com a dificuldade atual
 */
function initMinesweeper() {
  const config = MS_DIFFICULTIES[currentMsDifficulty] || MS_DIFFICULTIES.beginner;
  MS_ROWS  = config.rows;
  MS_COLS  = config.cols;
  MS_MINES = config.mines;

  stopMinesweeper();
  msBoard = [];
  msMinesLeft = MS_MINES;
  msTimer = 0;
  msGameOver = false;
  msFirstClick = true;
  msRevealedCount = 0;

  document.getElementById("ms-face").innerText = "🙂";
  updateMsCounters();

  const grid = document.getElementById("ms-grid");
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${MS_COLS}, ${config.cellSize}px)`;
  grid.style.gridTemplateRows    = `repeat(${MS_ROWS}, ${config.cellSize}px)`;

  // Adjust window width to fit the board
  const win = document.getElementById("win-minesweeper");
  if (win) {
    const padding = 24;
    const boardWidth  = MS_COLS * config.cellSize + padding;
    win.style.width = `${Math.max(230, boardWidth + 20)}px`;
  }

  // Build board
  for (let r = 0; r < MS_ROWS; r++) {
    msBoard[r] = [];
    for (let c = 0; c < MS_COLS; c++) {
      msBoard[r][c] = {
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0,
        element: document.createElement("div"),
      };

      const cellEl = msBoard[r][c].element;
      cellEl.className = "ms-cell";
      cellEl.style.width  = config.cellSize + "px";
      cellEl.style.height = config.cellSize + "px";
      cellEl.style.fontSize = Math.floor(config.cellSize * 0.65) + "px";
      cellEl.dataset.r = r;
      cellEl.dataset.c = c;

      cellEl.addEventListener("mousedown", (e) => {
        if (e.button === 0) handleMsClick(r, c);
      });
      cellEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        handleMsRightClick(r, c);
      });

      grid.appendChild(cellEl);
    }
  }
}

/**
 * Lida com clique esquerdo
 */
function handleMsClick(r, c) {
  if (msGameOver || msBoard[r][c].isRevealed || msBoard[r][c].isFlagged) return;

  if (msFirstClick) {
    msFirstClick = false;
    placeMsMines(r, c);
    calculateMsNeighbors();
    startMsTimer();
  }

  const cell = msBoard[r][c];
  if (cell.isMine) {
    triggerMsGameOver(false, r, c);
  } else {
    revealMsCell(r, c);
    checkMsWin();
  }
}

/**
 * Lida com clique direito (bandeira)
 */
function handleMsRightClick(r, c) {
  if (msGameOver || msBoard[r][c].isRevealed) return;
  const cell = msBoard[r][c];
  cell.isFlagged = !cell.isFlagged;
  cell.element.innerText = cell.isFlagged ? "🚩" : "";
  msMinesLeft += cell.isFlagged ? -1 : 1;
  updateMsCounters();
}

/**
 * Revela célula com flood-fill para vazias
 */
function revealMsCell(r, c) {
  const cell = msBoard[r][c];
  if (cell.isRevealed || cell.isFlagged) return;

  cell.isRevealed = true;
  cell.element.classList.add("revealed");
  msRevealedCount++;

  if (cell.neighborMines > 0) {
    cell.element.innerText = cell.neighborMines;
    cell.element.dataset.value = cell.neighborMines;
  } else {
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const nr = r + i, nc = c + j;
        if (nr >= 0 && nr < MS_ROWS && nc >= 0 && nc < MS_COLS) {
          revealMsCell(nr, nc);
        }
      }
    }
  }
}

/**
 * Distribui minas evitando o primeiro clique
 */
function placeMsMines(firstRow, firstCol) {
  let placed = 0;
  while (placed < MS_MINES) {
    const r = Math.floor(Math.random() * MS_ROWS);
    const c = Math.floor(Math.random() * MS_COLS);
    if (!msBoard[r][c].isMine && !(r === firstRow && c === firstCol)) {
      msBoard[r][c].isMine = true;
      placed++;
    }
  }
}

/**
 * Calcula vizinhos com minas
 */
function calculateMsNeighbors() {
  for (let r = 0; r < MS_ROWS; r++) {
    for (let c = 0; c < MS_COLS; c++) {
      if (msBoard[r][c].isMine) continue;
      let count = 0;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const nr = r + i, nc = c + j;
          if (nr >= 0 && nr < MS_ROWS && nc >= 0 && nc < MS_COLS && msBoard[nr][nc].isMine) count++;
        }
      }
      msBoard[r][c].neighborMines = count;
    }
  }
}

/**
 * Checa vitória
 */
function checkMsWin() {
  const cellsToReveal = MS_ROWS * MS_COLS - MS_MINES;
  if (msRevealedCount === cellsToReveal) {
    triggerMsGameOver(true);
  }
}

/**
 * Finaliza o jogo — vitória usa o tempo como pontuação (menor é melhor → score = 9999 - tempo)
 */
function triggerMsGameOver(won, killerRow = -1, killerCol = -1) {
  msGameOver = true;
  stopMsTimer();

  const faceBtn = document.getElementById("ms-face");

  if (won) {
    faceBtn.innerText = "😎";
    msMinesLeft = 0;
    updateMsCounters();
    for (let r = 0; r < MS_ROWS; r++) {
      for (let c = 0; c < MS_COLS; c++) {
        if (msBoard[r][c].isMine && !msBoard[r][c].isFlagged) {
          msBoard[r][c].element.innerText = "🚩";
        }
      }
    }
    // Score for minesweeper = inverse of time (faster = more points, max 9999)
    const winScore = Math.max(1, 9999 - msTimer);
    submitGameScore("minesweeper", currentMsDifficulty, winScore);
  } else {
    faceBtn.innerText = "😵";
    for (let r = 0; r < MS_ROWS; r++) {
      for (let c = 0; c < MS_COLS; c++) {
        const cell = msBoard[r][c];
        if (cell.isMine) {
          cell.element.classList.add("revealed");
          if (r === killerRow && c === killerCol) {
            cell.element.classList.add("mine");
          }
          cell.element.innerText = "💣";
        } else if (cell.isFlagged) {
          cell.element.innerText = "❌";
        }
      }
    }
  }
}

// ─── TIMER & COUNTERS ─────────────────────

function startMsTimer() {
  if (msInterval) clearInterval(msInterval);
  msInterval = setInterval(() => {
    if (msTimer < 999) msTimer++;
    updateMsCounters();
  }, 1000);
}

function stopMsTimer() {
  if (msInterval) clearInterval(msInterval);
}

function stopMinesweeper() {
  stopMsTimer();
}

function updateMsCounters() {
  const mineCountStr = Math.max(0, msMinesLeft).toString().padStart(3, "0");
  const timerStr     = msTimer.toString().padStart(3, "0");
  document.getElementById("ms-mine-count").innerText = mineCountStr;
  document.getElementById("ms-timer").innerText      = timerStr;
}
