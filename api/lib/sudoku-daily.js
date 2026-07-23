// ─── Geração determinística do Sudoku do dia ─────────────────────────────────
// Mesma lógica de geração de public/js/sudoku.js (sdShuffle/sdIsValid/
// sdFillBoard/buildSdPuzzle), mas usando um PRNG seedado pela data em vez de
// Math.random(), pra o puzzle do dia ser sempre o mesmo pra todo mundo e
// reproduzível caso precise ser regenerado.

const DAILY_REMOVE = 45; // dificuldade média — mesma faixa do Sudoku normal

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

function fillBoard(board, rng) {
  for (let i = 0; i < 81; i++) {
    const r = Math.floor(i / 9), c = i % 9;
    if (board[r][c] !== 0) continue;
    for (const n of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
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
  const board = Array.from({ length: 9 }, () => Array(9).fill(0));
  fillBoard(board, rng);
  return board;
}

function buildPuzzle(solution, removeCount, rng) {
  const puzzle = solution.map((row) => row.slice());
  const positions = shuffle(
    Array.from({ length: 81 }, (_, i) => i),
    rng,
  ).slice(0, removeCount);
  positions.forEach((pos) => {
    const r = Math.floor(pos / 9), c = pos % 9;
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
  if (!Array.isArray(board) || board.length !== 9) return false;
  for (let r = 0; r < 9; r++) {
    if (!Array.isArray(board[r]) || board[r].length !== 9) return false;
    for (let c = 0; c < 9; c++) {
      if (Number(board[r][c]) !== solution[r][c]) return false;
    }
  }
  return true;
}

module.exports = { generateDailyPuzzle, boardMatchesSolution, DAILY_REMOVE };
