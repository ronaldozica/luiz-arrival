const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { GAMES, DIFFICULTY_LABELS, minPlausibleSeconds, ARCADE_ENTRY_FEE } = require("../../api/lib/games");

describe("catálogo GAMES", () => {
  test("todo jogo tem label e icon", () => {
    for (const [key, cfg] of Object.entries(GAMES)) {
      assert.ok(cfg.label, `${key} sem label`);
      assert.ok(cfg.icon, `${key} sem icon`);
    }
  });

  test("toda dificuldade usada nos jogos tem um label em DIFFICULTY_LABELS", () => {
    for (const [key, cfg] of Object.entries(GAMES)) {
      if (!cfg.difficulties) continue;
      for (const diff of cfg.difficulties) {
        assert.ok(DIFFICULTY_LABELS[diff], `${key}:${diff} sem label`);
      }
    }
  });

  test("ARCADE_ENTRY_FEE é um número positivo", () => {
    assert.ok(Number.isFinite(ARCADE_ENTRY_FEE) && ARCADE_ENTRY_FEE > 0);
  });
});

describe("minPlausibleSeconds (anti-cheat)", () => {
  test("aimtrainer sempre exige a duração fixa da rodada", () => {
    assert.equal(minPlausibleSeconds("aimtrainer", "hard", 99999), 15);
    assert.equal(minPlausibleSeconds("aimtrainer", "easy", 0), 15);
  });

  test("minesweeper/sudoku/spider usam o piso por dificuldade, ignorando o score", () => {
    assert.equal(minPlausibleSeconds("minesweeper", "beginner", 9999), 0.5);
    assert.equal(minPlausibleSeconds("minesweeper", "expert", 1), 10);
    assert.equal(minPlausibleSeconds("sudoku", "hard", 9999), 30);
    assert.equal(minPlausibleSeconds("spider", "medium", 1), 30);
  });

  test("dificuldade desconhecida cai pra 0 (não bloqueia por engano)", () => {
    assert.equal(minPlausibleSeconds("minesweeper", "nightmare", 100), 0);
  });

  test("snake deriva o mínimo do número de maçãs comidas", () => {
    // score 100 = 10 maçãs; MIN_SPEED = 60ms → 0.6s mínimo
    assert.equal(minPlausibleSeconds("snake", null, 100), 0.6);
    assert.equal(minPlausibleSeconds("snake", null, 0), 0);
  });

  test("2048 usa uma estimativa generosa proporcional ao score", () => {
    assert.equal(minPlausibleSeconds("2048", null, 2000), 1);
    assert.equal(minPlausibleSeconds("2048", null, 0), 0);
  });

  test("jogo desconhecido retorna 0", () => {
    assert.equal(minPlausibleSeconds("pinball", null, 100), 0);
  });
});
