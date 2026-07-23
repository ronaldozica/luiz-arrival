const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { computeArcadePayout, tierByMin, tierByMax } = require("../../api/routes/game-rank");

describe("tierByMin / tierByMax", () => {
  test("tierByMin retorna o primeiro patamar cujo mínimo o valor atinge", () => {
    const thresholds = [[600, 25], [450, 16], [300, 10], [120, 5]];
    assert.equal(tierByMin(0, thresholds), 0);
    assert.equal(tierByMin(119, thresholds), 0);
    assert.equal(tierByMin(120, thresholds), 5);
    assert.equal(tierByMin(450, thresholds), 16);
    assert.equal(tierByMin(9999, thresholds), 25);
  });

  test("tierByMax retorna o primeiro patamar cujo máximo o valor respeita", () => {
    const thresholds = [[45, 22], [120, 15], [Infinity, 10]];
    assert.equal(tierByMax(10, thresholds), 22);
    assert.equal(tierByMax(45, thresholds), 22);
    assert.equal(tierByMax(46, thresholds), 15);
    assert.equal(tierByMax(1000, thresholds), 10);
  });
});

describe("computeArcadePayout — ficha de 10 LC", () => {
  test("snake segue as faixas de score (ruim=0, mediano=10, bom cresce)", () => {
    assert.equal(computeArcadePayout("snake", null, { scoreNum: 0 }), 0);
    assert.equal(computeArcadePayout("snake", null, { scoreNum: 119 }), 0);
    assert.equal(computeArcadePayout("snake", null, { scoreNum: 300 }), 10); // recupera a ficha
    assert.equal(computeArcadePayout("snake", null, { scoreNum: 600 }), 25);
  });

  test("aimtrainer usa a faixa da dificuldade certa (hard exige menos score que easy pro mesmo troco)", () => {
    const easyMediano = computeArcadePayout("aimtrainer", "easy", { scoreNum: 2500 });
    const hardMediano = computeArcadePayout("aimtrainer", "hard", { scoreNum: 1200 });
    assert.equal(easyMediano, 10);
    assert.equal(hardMediano, 10);
    assert.equal(computeArcadePayout("aimtrainer", "normal", { scoreNum: 0 }), 0);
  });

  test("aimtrainer sem dificuldade reconhecida cai no padrão 'normal'", () => {
    assert.equal(
      computeArcadePayout("aimtrainer", "unknown", { scoreNum: 1500 }),
      computeArcadePayout("aimtrainer", "normal", { scoreNum: 1500 }),
    );
  });

  test("minesweeper beginner: só existe rápido (14) ou break-even (10), nunca prejuízo numa vitória", () => {
    assert.equal(computeArcadePayout("minesweeper", "beginner", { elapsedSeconds: 5 }), 14);
    assert.equal(computeArcadePayout("minesweeper", "beginner", { elapsedSeconds: 999 }), 10);
  });

  test("minesweeper expert paga mais quanto mais rápido", () => {
    assert.equal(computeArcadePayout("minesweeper", "expert", { elapsedSeconds: 100 }), 30);
    assert.equal(computeArcadePayout("minesweeper", "expert", { elapsedSeconds: 250 }), 20);
    assert.equal(computeArcadePayout("minesweeper", "expert", { elapsedSeconds: 1000 }), 12);
  });

  test("sudoku hard: limites exatos das faixas de tempo", () => {
    assert.equal(computeArcadePayout("sudoku", "hard", { elapsedSeconds: 900 }), 32);
    assert.equal(computeArcadePayout("sudoku", "hard", { elapsedSeconds: 901 }), 20);
    assert.equal(computeArcadePayout("sudoku", "hard", { elapsedSeconds: 1500 }), 20);
    assert.equal(computeArcadePayout("sudoku", "hard", { elapsedSeconds: 1501 }), 12);
  });

  test("spider easy: flat rápido/lento sem faixa intermediária", () => {
    assert.equal(computeArcadePayout("spider", "easy", { elapsedSeconds: 299 }), 16);
    assert.equal(computeArcadePayout("spider", "easy", { elapsedSeconds: 300 }), 12);
  });

  test("2048 segue as faixas de score, igual ao snake", () => {
    assert.equal(computeArcadePayout("2048", null, { scoreNum: 299 }), 0);
    assert.equal(computeArcadePayout("2048", null, { scoreNum: 1000 }), 10);
    assert.equal(computeArcadePayout("2048", null, { scoreNum: 8000 }), 28);
  });

  test("todas as faixas de vitória em jogos por tempo pagam pelo menos a ficha (10)", () => {
    const games = [
      ["minesweeper", ["beginner", "intermediate", "expert"]],
      ["sudoku", ["easy", "medium", "hard"]],
      ["spider", ["easy", "medium", "hard"]],
    ];
    for (const [game, diffs] of games) {
      for (const diff of diffs) {
        for (const elapsedSeconds of [0, 50, 500, 5000]) {
          const payout = computeArcadePayout(game, diff, { elapsedSeconds });
          assert.ok(payout >= 10, `${game}:${diff} @ ${elapsedSeconds}s pagou ${payout} (< 10)`);
        }
      }
    }
  });

  test("jogo desconhecido não paga nada", () => {
    assert.equal(computeArcadePayout("pinball", null, { scoreNum: 99999 }), 0);
  });
});
