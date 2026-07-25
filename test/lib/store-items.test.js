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
  STORE_ITEMS,
  findEmojiFrameItem,
  TITLES,
  TITLE_IDS,
  TITLE_BASE_PRICE,
  TITLE_PRICE_STEP,
  titlePriceForCount,
  titleList,
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

describe("cores de prestígio (rainbow/neon/gelo/cósmico)", () => {
  test("as 4 cores novas existem em STORE_ITEMS como namecolor", () => {
    const ids = ["color_rainbow", "color_neon", "color_gelo", "color_cosmico"];
    for (const id of ids) {
      const item = STORE_ITEMS.find((i) => i.id === id);
      assert.ok(item, `${id} deveria existir em STORE_ITEMS`);
      assert.equal(item.type, "namecolor");
    }
  });

  test("rainbow e neon custam 1000, gelo e cósmico custam 750", () => {
    assert.equal(STORE_ITEMS.find((i) => i.id === "color_rainbow").price, 1000);
    assert.equal(STORE_ITEMS.find((i) => i.id === "color_neon").price, 1000);
    assert.equal(STORE_ITEMS.find((i) => i.id === "color_gelo").price, 750);
    assert.equal(STORE_ITEMS.find((i) => i.id === "color_cosmico").price, 750);
  });
});

describe("molduras de emoji (findEmojiFrameItem)", () => {
  test("encontra as 3 molduras cadastradas", () => {
    assert.equal(findEmojiFrameItem("frame_gold").frameClass, "emoji-frame-gold");
    assert.equal(findEmojiFrameItem("frame_neon").frameClass, "emoji-frame-neon");
    assert.equal(findEmojiFrameItem("frame_fire").frameClass, "emoji-frame-fire");
  });

  test("retorna undefined pra id inexistente ou de outro tipo", () => {
    assert.equal(findEmojiFrameItem("color_rubi"), undefined);
    assert.equal(findEmojiFrameItem("frame_inexistente"), undefined);
  });
});

describe("cursores (STORE_ITEMS type cursor)", () => {
  test("os 3 cursores existem com emoji e preço esperados", () => {
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_target").emoji, "🎯");
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_coin").emoji, "🪙");
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_crown").emoji, "👑");
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_target").price, 80);
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_coin").price, 80);
    assert.equal(STORE_ITEMS.find((i) => i.id === "cursor_crown").price, 120);
  });
});

describe("títulos curados (TITLES / titlePriceForCount / titleList)", () => {
  test("TITLE_IDS contém todos os ids de TITLES, sem duplicados", () => {
    assert.equal(TITLE_IDS.size, TITLES.length);
    for (const t of TITLES) assert.ok(TITLE_IDS.has(t.id));
  });

  test("titlePriceForCount cresce TITLE_PRICE_STEP a cada compra, a partir de TITLE_BASE_PRICE", () => {
    assert.equal(titlePriceForCount(0), TITLE_BASE_PRICE);
    assert.equal(titlePriceForCount(1), TITLE_BASE_PRICE + TITLE_PRICE_STEP);
    assert.equal(titlePriceForCount(3), TITLE_BASE_PRICE + 3 * TITLE_PRICE_STEP);
  });

  test("titleList extrai titleId de cada entrada comprada", () => {
    assert.deepEqual(
      titleList([{ titleId: "title_lenda", pricePaid: 100 }, { titleId: "title_rei", pricePaid: 200 }]),
      ["title_lenda", "title_rei"],
    );
    assert.deepEqual(titleList([]), []);
  });
});
