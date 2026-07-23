const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  coinsForGuess,
  PARTICIPATION_COINS,
  emojiPriceForCount,
  fontPriceForCount,
  EMOJI_BASE_PRICE,
  EMOJI_PRICE_STEP,
  FONT_BASE_PRICE,
  FONT_PRICE_STEP,
  EMOJI_REGEX,
  purchaseIds,
  emojiList,
} = require("../../api/lib/store-items");

describe("coinsForGuess", () => {
  test("sem rankingEntry retorna só a moeda de participação", () => {
    assert.equal(coinsForGuess(null), PARTICIPATION_COINS);
    assert.equal(coinsForGuess(undefined), PARTICIPATION_COINS);
  });

  test("registro legado (sem campo invalidated) usa a fórmula por posição", () => {
    assert.equal(coinsForGuess({ position: 1 }), 25 + PARTICIPATION_COINS);
    assert.equal(coinsForGuess({ position: 2 }), 10 + PARTICIPATION_COINS);
    assert.equal(coinsForGuess({ position: 3 }), 5 + PARTICIPATION_COINS);
    assert.equal(coinsForGuess({ position: 4 }), PARTICIPATION_COINS);
  });

  test("aposta invalidada (sniping) só recebe a moeda de participação", () => {
    assert.equal(coinsForGuess({ invalidated: true, diff: 0 }), PARTICIPATION_COINS);
  });

  test("faixas de precisão pagam conforme o diff, mesmo que não seja o 1º colocado", () => {
    assert.equal(coinsForGuess({ invalidated: false, diff: 0 }), 30);
    assert.equal(coinsForGuess({ invalidated: false, diff: 5 }), 25);
    assert.equal(coinsForGuess({ invalidated: false, diff: 10 }), 20);
    assert.equal(coinsForGuess({ invalidated: false, diff: 20 }), 15);
    assert.equal(coinsForGuess({ invalidated: false, diff: 30 }), 10);
    assert.equal(coinsForGuess({ invalidated: false, diff: 45 }), 6);
    assert.equal(coinsForGuess({ invalidated: false, diff: 60 }), 3);
  });

  test("erro maior que 60min só recebe a moeda de participação", () => {
    assert.equal(coinsForGuess({ invalidated: false, diff: 61 }), PARTICIPATION_COINS);
    assert.equal(coinsForGuess({ invalidated: false, diff: 500 }), PARTICIPATION_COINS);
  });

  test("\"Luiz de Placa\" dobra a recompensa, mas não a participação de quem errou feio", () => {
    assert.equal(coinsForGuess({ invalidated: false, diff: 0, placa: true }), 60);
    assert.equal(coinsForGuess({ invalidated: false, diff: 10, placa: true }), 40);
  });

  test("placa não dobra recompensa de aposta invalidada", () => {
    assert.equal(coinsForGuess({ invalidated: true, diff: 0, placa: true }), PARTICIPATION_COINS);
  });
});

describe("preço escalonado de emoji/fonte", () => {
  test("emojiPriceForCount cresce EMOJI_PRICE_STEP a cada compra", () => {
    assert.equal(emojiPriceForCount(0), EMOJI_BASE_PRICE);
    assert.equal(emojiPriceForCount(1), EMOJI_BASE_PRICE + EMOJI_PRICE_STEP);
    assert.equal(emojiPriceForCount(4), EMOJI_BASE_PRICE + 4 * EMOJI_PRICE_STEP);
  });

  test("fontPriceForCount cresce FONT_PRICE_STEP a cada compra", () => {
    assert.equal(fontPriceForCount(0), FONT_BASE_PRICE);
    assert.equal(fontPriceForCount(3), FONT_BASE_PRICE + 3 * FONT_PRICE_STEP);
  });
});

describe("EMOJI_REGEX", () => {
  test("aceita um emoji simples", () => {
    assert.match("🪙", EMOJI_REGEX);
    assert.match("🔥", EMOJI_REGEX);
  });

  test("aceita uma bandeira (par de regional indicator)", () => {
    assert.match("🇧🇷", EMOJI_REGEX);
  });

  test("rejeita texto comum ou múltiplos emojis soltos", () => {
    assert.doesNotMatch("a", EMOJI_REGEX);
    assert.doesNotMatch("ab", EMOJI_REGEX);
    assert.doesNotMatch("", EMOJI_REGEX);
    assert.doesNotMatch("🔥🔥", EMOJI_REGEX);
  });
});

describe("purchaseIds / emojiList (compatibilidade formato antigo/novo)", () => {
  test("purchaseIds extrai ids de strings soltas e de objetos {id, pricePaid}", () => {
    assert.deepEqual(purchaseIds(["palinha", { id: "color_rubi", pricePaid: 50 }]), ["palinha", "color_rubi"]);
  });

  test("emojiList extrai emojis de strings soltas e de objetos {emoji, pricePaid}", () => {
    assert.deepEqual(emojiList(["🔥", { emoji: "🪙", pricePaid: 25 }]), ["🔥", "🪙"]);
  });
});
