// ==========================================
// CAMPO MINADO 95 - Vanilla JS
// ==========================================

const MS_ROWS = 9;
const MS_COLS = 9;
const MS_MINES = 10;

let msBoard = [];
let msMinesLeft = MS_MINES;
let msTimer = 0;
let msInterval = null;
let msGameOver = false;
let msFirstClick = true;
let msRevealedCount = 0;

/**
 * Inicializa e reseta o jogo
 */
function initMinesweeper() {
  stopMinesweeper();
  msBoard = [];
  msMinesLeft = MS_MINES;
  msTimer = 0;
  msGameOver = false;
  msFirstClick = true;
  msRevealedCount = 0;

  document.getElementById('ms-face').innerText = "🙂";
  updateMsCounters();

  const grid = document.getElementById('ms-grid');
  grid.innerHTML = '';

  // Cria a matriz vazia e os elementos DOM
  for (let r = 0; r < MS_ROWS; r++) {
    msBoard[r] = [];
    for (let c = 0; c < MS_COLS; c++) {
      msBoard[r][c] = {
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborMines: 0,
        element: document.createElement('div')
      };

      const cellEl = msBoard[r][c].element;
      cellEl.className = 'ms-cell';
      cellEl.dataset.r = r;
      cellEl.dataset.c = c;
      
      // Evento de clique esquerdo (Revelar)
      cellEl.addEventListener('mousedown', (e) => {
        if (e.button === 0) handleMsClick(r, c);
      });
      
      // Evento de clique direito (Bandeira)
      cellEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        handleMsRightClick(r, c);
      });

      grid.appendChild(cellEl);
    }
  }
}

/**
 * Lida com o clique esquerdo
 */
function handleMsClick(r, c) {
  if (msGameOver || msBoard[r][c].isRevealed || msBoard[r][c].isFlagged) return;

  // No primeiro clique, gera as minas garantindo que o local clicado esteja livre
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
 * Lida com o clique direito (colocar/tirar bandeira)
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
 * Revela uma célula e faz a expansão (Flood Fill) se for vazia (0)
 */
function revealMsCell(r, c) {
  const cell = msBoard[r][c];
  if (cell.isRevealed || cell.isFlagged) return;

  cell.isRevealed = true;
  cell.element.classList.add('revealed');
  msRevealedCount++;

  if (cell.neighborMines > 0) {
    cell.element.innerText = cell.neighborMines;
    cell.element.dataset.value = cell.neighborMines;
  } else {
    // Flood fill para células vazias (vizinhança)
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const nr = r + i;
        const nc = c + j;
        if (nr >= 0 && nr < MS_ROWS && nc >= 0 && nc < MS_COLS) {
          revealMsCell(nr, nc);
        }
      }
    }
  }
}

/**
 * Distribui as minas aleatoriamente, evitando a célula do primeiro clique
 */
function placeMsMines(firstRow, firstCol) {
  let minesPlaced = 0;
  while (minesPlaced < MS_MINES) {
    const r = Math.floor(Math.random() * MS_ROWS);
    const c = Math.floor(Math.random() * MS_COLS);
    
    // Evita colocar bomba onde clicou ou onde já tem bomba
    if (!msBoard[r][c].isMine && !(r === firstRow && c === firstCol)) {
      msBoard[r][c].isMine = true;
      minesPlaced++;
    }
  }
}

/**
 * Calcula quantas minas existem ao redor de cada célula
 */
function calculateMsNeighbors() {
  for (let r = 0; r < MS_ROWS; r++) {
    for (let c = 0; c < MS_COLS; c++) {
      if (msBoard[r][c].isMine) continue;

      let count = 0;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          const nr = r + i;
          const nc = c + j;
          if (nr >= 0 && nr < MS_ROWS && nc >= 0 && nc < MS_COLS) {
            if (msBoard[nr][nc].isMine) count++;
          }
        }
      }
      msBoard[r][c].neighborMines = count;
    }
  }
}

/**
 * Verifica condição de vitória (todas as células sem bomba reveladas)
 */
function checkMsWin() {
  const cellsToReveal = (MS_ROWS * MS_COLS) - MS_MINES;
  if (msRevealedCount === cellsToReveal) {
    triggerMsGameOver(true);
  }
}

/**
 * Finaliza o jogo (Vitória ou Derrota)
 */
function triggerMsGameOver(won, killerRow = -1, killerCol = -1) {
  msGameOver = true;
  stopMsTimer();

  const faceBtn = document.getElementById('ms-face');
  
  if (won) {
    faceBtn.innerText = "😎";
    msMinesLeft = 0;
    updateMsCounters();
    // Transforma minas não flagradas em bandeiras
    for (let r = 0; r < MS_ROWS; r++) {
      for (let c = 0; c < MS_COLS; c++) {
        if (msBoard[r][c].isMine && !msBoard[r][c].isFlagged) {
          msBoard[r][c].element.innerText = "🚩";
        }
      }
    }
  } else {
    faceBtn.innerText = "😵";
    // Revela todas as minas
    for (let r = 0; r < MS_ROWS; r++) {
      for (let c = 0; c < MS_COLS; c++) {
        const cell = msBoard[r][c];
        if (cell.isMine) {
          cell.element.classList.add('revealed');
          if (r === killerRow && c === killerCol) {
            cell.element.classList.add('mine'); // Fundo vermelho para a bomba que te matou
          }
          cell.element.innerText = "💣";
        } else if (cell.isFlagged) {
          // Bandeira errada
          cell.element.innerText = "❌";
        }
      }
    }
  }
}

// ─── FUNÇÕES DE TIMER E CONTADORES ─────────────────

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
  const mineCountStr = Math.max(0, msMinesLeft).toString().padStart(3, '0');
  const timerStr = msTimer.toString().padStart(3, '0');
  
  document.getElementById('ms-mine-count').innerText = mineCountStr;
  document.getElementById('ms-timer').innerText = timerStr;
}