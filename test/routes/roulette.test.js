const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { numberColor, betWins, EU_WHEEL_ORDER, RED_NUMBERS, PAYOUTS } = require("../../api/routes/roulette");

describe("roda europeia", () => {
  test("tem 37 números (0 a 36), cada um exatamente uma vez", () => {
    assert.equal(EU_WHEEL_ORDER.length, 37);
    const set = new Set(EU_WHEEL_ORDER);
    assert.equal(set.size, 37);
    for (let n = 0; n <= 36; n++) assert.ok(set.has(n), `número ${n} ausente da roda`);
  });

  test("18 números vermelhos, 18 pretos, 0 é verde (não entra em nenhum dos dois)", () => {
    assert.equal(RED_NUMBERS.size, 18);
    assert.ok(!RED_NUMBERS.has(0));
  });
});

describe("numberColor", () => {
  test("0 é verde", () => {
    assert.equal(numberColor(0), "green");
  });

  test("todo número 1-36 é vermelho ou preto, nunca verde", () => {
    for (let n = 1; n <= 36; n++) {
      assert.notEqual(numberColor(n), "green");
    }
  });

  test("consistente com o conjunto RED_NUMBERS", () => {
    for (let n = 1; n <= 36; n++) {
      assert.equal(numberColor(n), RED_NUMBERS.has(n) ? "red" : "black");
    }
  });
});

describe("betWins", () => {
  test("straight só ganha no número exato", () => {
    assert.equal(betWins("straight", 17, 17), true);
    assert.equal(betWins("straight", 17, 18), false);
  });

  test("red/black nunca pagam no 0 (verde)", () => {
    assert.equal(betWins("red", undefined, 0), false);
    assert.equal(betWins("black", undefined, 0), false);
  });

  test("odd/even nunca pagam no 0", () => {
    assert.equal(betWins("odd", undefined, 0), false);
    assert.equal(betWins("even", undefined, 0), false);
    assert.equal(betWins("odd", undefined, 7), true);
    assert.equal(betWins("even", undefined, 8), true);
  });

  test("low (1-18) e high (19-36) cobrem os intervalos certos, excluindo o 0", () => {
    assert.equal(betWins("low", undefined, 1), true);
    assert.equal(betWins("low", undefined, 18), true);
    assert.equal(betWins("low", undefined, 19), false);
    assert.equal(betWins("low", undefined, 0), false);
    assert.equal(betWins("high", undefined, 19), true);
    assert.equal(betWins("high", undefined, 36), true);
    assert.equal(betWins("high", undefined, 18), false);
  });

  test("as 3 dúzias cobrem 1-36 sem sobreposição e excluem o 0", () => {
    for (let n = 1; n <= 36; n++) {
      const hits = ["dozen1", "dozen2", "dozen3"].filter((d) => betWins(d, undefined, n));
      assert.equal(hits.length, 1, `número ${n} bateu em ${hits.length} dúzias`);
    }
    assert.equal(betWins("dozen1", undefined, 0), false);
    assert.equal(betWins("dozen2", undefined, 0), false);
    assert.equal(betWins("dozen3", undefined, 0), false);
  });

  test("tipo de aposta desconhecido nunca ganha", () => {
    assert.equal(betWins("qualquer_coisa", undefined, 10), false);
  });

  test("todo número 1-36 vence em exatamente uma cor, uma paridade e um intervalo alto/baixo", () => {
    for (let n = 1; n <= 36; n++) {
      const colorHits = ["red", "black"].filter((t) => betWins(t, undefined, n));
      const parityHits = ["odd", "even"].filter((t) => betWins(t, undefined, n));
      const rangeHits = ["low", "high"].filter((t) => betWins(t, undefined, n));
      assert.equal(colorHits.length, 1);
      assert.equal(parityHits.length, 1);
      assert.equal(rangeHits.length, 1);
    }
  });
});

describe("PAYOUTS (multiplicador líquido)", () => {
  test("número seco paga 35x, apostas simples pagam 1x, dúzias pagam 2x", () => {
    assert.equal(PAYOUTS.straight, 35);
    assert.equal(PAYOUTS.red, 1);
    assert.equal(PAYOUTS.black, 1);
    assert.equal(PAYOUTS.odd, 1);
    assert.equal(PAYOUTS.even, 1);
    assert.equal(PAYOUTS.low, 1);
    assert.equal(PAYOUTS.high, 1);
    assert.equal(PAYOUTS.dozen1, 2);
    assert.equal(PAYOUTS.dozen2, 2);
    assert.equal(PAYOUTS.dozen3, 2);
  });
});
