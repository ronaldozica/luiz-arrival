// ─── Geração determinística do Sudoku do dia ─────────────────────────────────
// Grade 6x6 (caixas 2x3), mesmo tamanho do "Mini Sudoku" diário do LinkedIn —
// menor e mais rápido de resolver que o Sudoku 9x9 normal do app. Mesma
// lógica de geração de public/js/sudoku.js (sdShuffle/sdIsValid/sdFillBoard/
// buildSdPuzzle), adaptada pro tamanho 6x6 e usando um PRNG seedado pela data
// em vez de Math.random(), pra o puzzle do dia ser sempre o mesmo pra todo
// mundo e reproduzível caso precise ser regenerado.

const GRID_SIZE = 6;
const BOX_ROWS = 2; // caixas de 2 linhas x 3 colunas
const BOX_COLS = 3;
const DIGITS = [1, 2, 3, 4, 5, 6];
const DAILY_REMOVE = 20; // 36 células - 20 = 16 dadas (dificuldade média pro tamanho 6x6)

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// mulberry32 — PRNG simples e rápido, suficiente pra embaralhar um tabuleiro.
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isValid(board, r, c, n) {
  for (let i = 0; i < GRID_SIZE; i++) {
    if (board[r][i] === n || board[i][c] === n) return false;
  }
  const br = Math.floor(r / BOX_ROWS) * BOX_ROWS, bc = Math.floor(c / BOX_COLS) * BOX_COLS;
  for (let i = br; i < br + BOX_ROWS; i++) {
    for (let j = bc; j < bc + BOX_COLS; j++) {
      if (board[i][j] === n) return false;
    }
  }
  return true;
}

function fillBoard(board, rng) {
  for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const r = Math.floor(i / GRID_SIZE), c = i % GRID_SIZE;
    if (board[r][c] !== 0) continue;
    for (const n of shuffle(DIGITS, rng)) {
      if (isValid(board, r, c, n)) {
        board[r][c] = n;
        if (fillBoard(board, rng)) return true;
        board[r][c] = 0;
      }
    }
    return false;
  }
  return true;
}

function generateSolution(rng) {
  const board = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
  fillBoard(board, rng);
  return board;
}

function buildPuzzle(solution, removeCount, rng) {
  const puzzle = solution.map((row) => row.slice());
  const positions = shuffle(
    Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => i),
    rng,
  ).slice(0, removeCount);
  positions.forEach((pos) => {
    const r = Math.floor(pos / GRID_SIZE), c = pos % GRID_SIZE;
    puzzle[r][c] = 0;
  });
  return puzzle;
}

// Gera o puzzle+solução do dia a partir da string da data (ex: "2026-07-22").
function generateDailyPuzzle(dateKey) {
  const rng = mulberry32(hashStringToSeed(dateKey));
  const solution = generateSolution(rng);
  const puzzle = buildPuzzle(solution, DAILY_REMOVE, rng);
  return { puzzle, solution };
}

// Compara uma grade preenchida pelo cliente com a solução guardada no servidor.
function boardMatchesSolution(board, solution) {
  if (!Array.isArray(board) || board.length !== GRID_SIZE) return false;
  for (let r = 0; r < GRID_SIZE; r++) {
    if (!Array.isArray(board[r]) || board[r].length !== GRID_SIZE) return false;
    for (let c = 0; c < GRID_SIZE; c++) {
      if (Number(board[r][c]) !== solution[r][c]) return false;
    }
  }
  return true;
}

module.exports = { generateDailyPuzzle, boardMatchesSolution, DAILY_REMOVE, GRID_SIZE, BOX_ROWS, BOX_COLS };
