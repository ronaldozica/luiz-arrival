const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { makeDeck, cardValue, handValue, isNaturalBlackjack } = require("../../api/routes/blackjack");

describe("makeDeck", () => {
  test("tem 52 cartas únicas (13 valores x 4 naipes)", () => {
    const deck = makeDeck();
    assert.equal(deck.length, 52);
    const keys = new Set(deck.map((c) => `${c.value}${c.suit}`));
    assert.equal(keys.size, 52);
  });

  test("vem embaralhado (não é sempre a mesma ordem)", () => {
    // Probabilisticamente impossível dar a mesma ordem 2x se realmente embaralha
    const a = makeDeck().map((c) => `${c.value}${c.suit}`).join(",");
    const b = makeDeck().map((c) => `${c.value}${c.suit}`).join(",");
    assert.notEqual(a, b);
  });
});

describe("cardValue", () => {
  test("J/Q/K valem 10", () => {
    for (const v of ["J", "Q", "K"]) {
      assert.equal(cardValue({ value: v, suit: "♠" }), 10);
    }
  });

  test("Ás vale 11 (o ajuste pra 1 é feito em handValue)", () => {
    assert.equal(cardValue({ value: "A", suit: "♠" }), 11);
  });

  test("cartas numéricas valem seu próprio número", () => {
    for (let n = 2; n <= 10; n++) {
      assert.equal(cardValue({ value: String(n), suit: "♥" }), n);
    }
  });
});

describe("handValue", () => {
  test("soma simples sem Ás", () => {
    assert.equal(handValue([{ value: "10", suit: "♠" }, { value: "7", suit: "♥" }]), 17);
  });

  test("Ás conta como 11 quando não estoura", () => {
    assert.equal(handValue([{ value: "A", suit: "♠" }, { value: "9", suit: "♥" }]), 20);
  });

  test("Ás vira 1 automaticamente pra evitar estouro (soft → hard)", () => {
    assert.equal(handValue([{ value: "A", suit: "♠" }, { value: "9", suit: "♥" }, { value: "5", suit: "♦" }]), 15);
  });

  test("dois Ases: só um vira 1 se precisar", () => {
    // A + A = 22 estoura → um vira 1 → 12
    assert.equal(handValue([{ value: "A", suit: "♠" }, { value: "A", suit: "♥" }]), 12);
  });

  test("mão sem Ás que estoura continua estourada (handValue não impede bust)", () => {
    assert.equal(handValue([{ value: "K", suit: "♠" }, { value: "Q", suit: "♥" }, { value: "5", suit: "♦" }]), 25);
  });
});

describe("isNaturalBlackjack", () => {
  test("2 cartas somando 21 é blackjack natural", () => {
    assert.equal(isNaturalBlackjack([{ value: "A", suit: "♠" }, { value: "K", suit: "♥" }]), true);
  });

  test("21 com 3 cartas NÃO é natural (só as 2 primeiras contam)", () => {
    assert.equal(
      isNaturalBlackjack([{ value: "7", suit: "♠" }, { value: "7", suit: "♥" }, { value: "7", suit: "♦" }]),
      false,
    );
  });

  test("2 cartas que não somam 21 não é natural", () => {
    assert.equal(isNaturalBlackjack([{ value: "10", suit: "♠" }, { value: "9", suit: "♥" }]), false);
  });
});
