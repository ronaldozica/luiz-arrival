const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  coinsForGuess,
  PARTICIPATION_COINS,
  emojiPriceForCount,
  fontPriceForCount,
  EMOJI_BASE_PRICE,
  FONT_BASE_PRICE,
  EMOJI_REGEX,
  purchaseIds,
  emojiList,
  STORE_ITEMS,
  findEmojiFrameItem,
  findTitleItem,
  findTeamIconItem,
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

describe("preço fixo de emoji/fonte (escalonamento removido)", () => {
  test("emojiPriceForCount sempre retorna EMOJI_BASE_PRICE, não importa quantos já foram comprados", () => {
    assert.equal(emojiPriceForCount(), EMOJI_BASE_PRICE);
    assert.equal(emojiPriceForCount(0), EMOJI_BASE_PRICE);
    assert.equal(emojiPriceForCount(1), EMOJI_BASE_PRICE);
    assert.equal(emojiPriceForCount(50), EMOJI_BASE_PRICE);
  });

  test("fontPriceForCount sempre retorna FONT_BASE_PRICE, não importa quantas já foram compradas", () => {
    assert.equal(fontPriceForCount(), FONT_BASE_PRICE);
    assert.equal(fontPriceForCount(0), FONT_BASE_PRICE);
    assert.equal(fontPriceForCount(3), FONT_BASE_PRICE);
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

describe("títulos (STORE_ITEMS type title, preço fixo de 500 LC, exclusividade)", () => {
  const TITLE_IDS = [
    "title_lenda", "title_rei", "title_sortudo", "title_imbativel",
    "title_highroller", "title_mestre", "title_maquina", "title_vidente",
  ];

  test("os 8 títulos existem em STORE_ITEMS como type title, custando 500 LC cada", () => {
    for (const id of TITLE_IDS) {
      const item = STORE_ITEMS.find((i) => i.id === id);
      assert.ok(item, `${id} deveria existir em STORE_ITEMS`);
      assert.equal(item.type, "title");
      assert.equal(item.price, 500);
    }
  });

  test("findTitleItem encontra um título pelo id e devolve undefined pra id de outro tipo", () => {
    assert.equal(findTitleItem("title_lenda").title, "Lenda");
    assert.equal(findTitleItem("color_rubi"), undefined);
    assert.equal(findTitleItem("title_inexistente"), undefined);
  });
});

describe("emblemas de time (STORE_ITEMS type teamicon)", () => {
  const TEAM_IDS = ["team_cruzeiro", "team_atletico", "team_america", "team_guanambi"];

  test("os 4 times existem em STORE_ITEMS como type teamicon, com src de imagem", () => {
    for (const id of TEAM_IDS) {
      const item = STORE_ITEMS.find((i) => i.id === id);
      assert.ok(item, `${id} deveria existir em STORE_ITEMS`);
      assert.equal(item.type, "teamicon");
      assert.ok(item.src && item.src.startsWith("/"), `${id} deveria ter um src de imagem`);
    }
  });

  test("findTeamIconItem encontra um time pelo id e devolve undefined pra id de outro tipo", () => {
    assert.equal(findTeamIconItem("team_cruzeiro").title, "Cruzeiro");
    assert.equal(findTeamIconItem("color_rubi"), undefined);
    assert.equal(findTeamIconItem("team_inexistente"), undefined);
  });
});
