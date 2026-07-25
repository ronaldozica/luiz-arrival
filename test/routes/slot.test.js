const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { SYMBOLS, spinReel, symbolPayout, resolveSpin } = require("../../api/routes/slot");

describe("SYMBOLS", () => {
  test("pesos somam 100", () => {
    const total = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
    assert.equal(total, 100);
  });

  test("todo símbolo tem emoji, peso positivo e payout positivo", () => {
    for (const s of SYMBOLS) {
      assert.ok(s.emoji);
      assert.ok(s.weight > 0);
      assert.ok(s.payout > 0);
    }
  });

  test("quanto mais raro (menor peso), maior o payout — ordem crescente de prêmio", () => {
    const sorted = [...SYMBOLS].sort((a, b) => b.weight - a.weight);
    for (let i = 1; i < sorted.length; i++) {
      assert.ok(sorted[i].payout >= sorted[i - 1].payout, `${sorted[i].id} deveria pagar mais que ${sorted[i - 1].id}`);
    }
  });
});

describe("spinReel", () => {
  test("sempre retorna um id válido de SYMBOLS", () => {
    const validIds = new Set(SYMBOLS.map((s) => s.id));
    for (let i = 0; i < 200; i++) {
      assert.ok(validIds.has(spinReel()));
    }
  });
});

describe("symbolPayout", () => {
  test("retorna o payout correto de cada símbolo", () => {
    for (const s of SYMBOLS) assert.equal(symbolPayout(s.id), s.payout);
  });

  test("retorna 0 pra id desconhecido", () => {
    assert.equal(symbolPayout("nao_existe"), 0);
  });
});

describe("resolveSpin", () => {
  test("3 símbolos iguais: ganha stake * payout do símbolo, sem perda", () => {
    const r = resolveSpin(["diamond", "diamond", "diamond"], 30);
    assert.equal(r.outcome, "win");
    assert.equal(r.coinsWon, 30 * symbolPayout("diamond"));
    assert.equal(r.coinsLost, 0);
  });

  test("exatamente 2 símbolos iguais (em qualquer posição): perde só metade da ficha", () => {
    assert.deepEqual(resolveSpin(["cherry", "cherry", "lemon"], 30), { outcome: "partial", coinsWon: 0, coinsLost: 15 });
    assert.deepEqual(resolveSpin(["lemon", "cherry", "cherry"], 30), { outcome: "partial", coinsWon: 0, coinsLost: 15 });
    assert.deepEqual(resolveSpin(["cherry", "lemon", "cherry"], 30), { outcome: "partial", coinsWon: 0, coinsLost: 15 });
  });

  test("metade da ficha arredonda pra baixo em apostas ímpares", () => {
    const r = resolveSpin(["cherry", "cherry", "lemon"], 5);
    assert.equal(r.coinsLost, 2);
  });

  test("nenhum símbolo repetido: perde a ficha inteira", () => {
    const r = resolveSpin(["cherry", "lemon", "grape"], 30);
    assert.deepEqual(r, { outcome: "lose", coinsWon: 0, coinsLost: 30 });
  });

  test("jackpot no símbolo mais raro paga o multiplicador mais alto do catálogo", () => {
    const maxPayout = Math.max(...SYMBOLS.map((s) => s.payout));
    const r = resolveSpin(["clock", "clock", "clock"], 30);
    assert.equal(r.coinsWon, 30 * maxPayout);
  });
});
