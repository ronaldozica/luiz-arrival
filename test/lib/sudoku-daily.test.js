const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  generateDailyPuzzle,
  boardMatchesSolution,
  DAILY_REMOVE,
  GRID_SIZE,
  BOX_ROWS,
  BOX_COLS,
} = require("../../api/lib/sudoku-daily");

function isValidSudokuSolution(board) {
  const seenRows = Array.from({ length: GRID_SIZE }, () => new Set());
  const seenCols = Array.from({ length: GRID_SIZE }, () => new Set());
  const seenBoxes = Array.from({ length: GRID_SIZE }, () => new Set());
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const n = board[r][c];
      if (!Number.isInteger(n) || n < 1 || n > GRID_SIZE) return false;
      const box = Math.floor(r / BOX_ROWS) * (GRID_SIZE / BOX_COLS) + Math.floor(c / BOX_COLS);
      if (seenRows[r].has(n) || seenCols[c].has(n) || seenBoxes[box].has(n)) return false;
      seenRows[r].add(n);
      seenCols[c].add(n);
      seenBoxes[box].add(n);
    }
  }
  return true;
}

describe("tamanho da grade (estilo Mini Sudoku do LinkedIn)", () => {
  test("grade 6x6 com caixas de 2x3", () => {
    assert.equal(GRID_SIZE, 6);
    assert.equal(BOX_ROWS, 2);
    assert.equal(BOX_COLS, 3);
  });
});

describe("generateDailyPuzzle", () => {
  test("é determinístico para a mesma data", () => {
    const a = generateDailyPuzzle("2026-07-22");
    const b = generateDailyPuzzle("2026-07-22");
    assert.deepEqual(a.puzzle, b.puzzle);
    assert.deepEqual(a.solution, b.solution);
  });

  test("datas diferentes geram puzzles diferentes", () => {
    const a = generateDailyPuzzle("2026-07-22");
    const b = generateDailyPuzzle("2026-07-23");
    assert.notDeepEqual(a.puzzle, b.puzzle);
  });

  test("a solução é um sudoku 6x6 válido (sem repetição em linha/coluna/caixa 2x3)", () => {
    const { solution } = generateDailyPuzzle("2026-07-22");
    assert.equal(solution.length, GRID_SIZE);
    assert.ok(isValidSudokuSolution(solution));
  });

  test("o puzzle remove exatamente DAILY_REMOVE células, mantendo o resto igual à solução", () => {
    const { puzzle, solution } = generateDailyPuzzle("2026-07-22");
    let blanks = 0;
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (puzzle[r][c] === 0) blanks++;
        else assert.equal(puzzle[r][c], solution[r][c]);
      }
    }
    assert.equal(blanks, DAILY_REMOVE);
  });
});

describe("boardMatchesSolution", () => {
  test("aceita a própria solução", () => {
    const { solution } = generateDailyPuzzle("2026-07-22");
    assert.equal(boardMatchesSolution(solution, solution), true);
  });

  test("rejeita um board com um único número trocado", () => {
    const { solution } = generateDailyPuzzle("2026-07-22");
    const wrong = solution.map((row) => row.slice());
    wrong[0][0] = wrong[0][0] === GRID_SIZE ? 1 : wrong[0][0] + 1;
    assert.equal(boardMatchesSolution(wrong, solution), false);
  });

  test("rejeita formatos malformados sem lançar exceção", () => {
    const { solution } = generateDailyPuzzle("2026-07-22");
    assert.equal(boardMatchesSolution(null, solution), false);
    assert.equal(boardMatchesSolution([], solution), false);
    assert.equal(boardMatchesSolution([[1, 2, 3]], solution), false);
  });
});
