const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { calcBalance } = require("../../api/lib/store-items");

// Mock mínimo do cliente Upstash: só get/mget, sobre um objeto em memória.
// mget espelha o comportamento real (array de valores na mesma ordem das
// chaves pedidas, null pra chave ausente) — é o que garante que a troca de N
// GETs sequenciais por 1 MGET (ver comentário em calcBalance) não mudou o
// resultado, só o número de comandos.
function makeMockKv(store) {
  const mgetCalls = [];
  return {
    async get(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async mget(keys) {
      mgetCalls.push(keys);
      return keys.map((k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null));
    },
    mgetCalls,
  };
}

describe("calcBalance — extrato da carteira (campos individuais via MGET)", () => {
  test("soma corretamente moedas ganhas/gastas de todas as fontes, incluindo formato legado (string) e novo ({id,pricePaid})", async () => {
    const kv = makeMockKv({
      days_index: [],
      "gamecoins:ronaldo": 40,
      "farmcoins:ronaldo": 15,
      "bjwon:ronaldo": 5,
      "purchases:ronaldo": [{ id: "color_rubi", pricePaid: 50 }, "palinha"],
      "emoji_owned:ronaldo": ["🔥", { emoji: "🪙", pricePaid: 25 }],
      "font_owned:ronaldo": [{ fontId: "font_impact", pricePaid: 25 }],
      "farmspent:ronaldo": 30,
      "bjlost:ronaldo": 15,
      "gamespent:ronaldo": 20,
      "roulettewon:ronaldo": 60,
      "roulettelost:ronaldo": 25,
      "slotwon:ronaldo": 60,
      "slotlost:ronaldo": 7,
    });
    const users = [{ name: "Ronaldo", isHCM: false }];

    const result = await calcBalance(kv, users[0], users);

    assert.equal(result.earnedCoins, 40 + 15 + 5 + 60 + 60); // 180
    assert.equal(result.spentCoins, 60 + 150 + 25 + 30 + 15 + 20 + 25 + 7); // 332
    assert.deepEqual(result.purchases, ["color_rubi", "palinha"]);
    assert.deepEqual(result.emojiOwned, ["🔥", "🪙"]);
    assert.deepEqual(result.fontOwned, ["font_impact"]);
    assert.equal(result.gameCoins, 40);
  });

  test("usuário sem nenhuma chave gravada tem saldo zerado (chaves ausentes viram null no MGET, não erro)", async () => {
    const kv = makeMockKv({ days_index: [] });
    const users = [{ name: "Novato", isHCM: false }];

    const result = await calcBalance(kv, users[0], users);

    assert.equal(result.earnedCoins, 0);
    assert.equal(result.spentCoins, 0);
    assert.deepEqual(result.purchases, []);
  });

  test("busca todos os campos da carteira num único MGET (não um GET por campo)", async () => {
    const kv = makeMockKv({ days_index: [] });
    const users = [{ name: "Ronaldo", isHCM: false }];

    await calcBalance(kv, users[0], users);

    assert.equal(kv.mgetCalls.length, 1, "deveria ter feito exatamente 1 chamada de mget (sem dias úteis no índice)");
    assert.equal(kv.mgetCalls[0].length, 13, "os 13 campos da carteira num único mget");
  });
});

describe("calcBalance — histórico de apostas (fins de semana pulados, bônus HCM)", () => {
  function buildBetsKv() {
    return makeMockKv({
      // 2026-07-25 é sábado — nunca deveria virar uma leitura, nem no MGET.
      days_index: ["2026-07-20", "2026-07-21", "2026-07-25"],
      "day:2026-07-20": {
        arrival: "08:00",
        rankings: [
          { name: "Ronaldo", position: 1, diff: 0, invalidated: false },
          { name: "Marcus", position: 2, diff: 5, invalidated: false },
          { name: "Julio", position: 3, diff: 50, invalidated: false },
        ],
      },
      "day:2026-07-21": {
        arrival: "08:05",
        rankings: [
          { name: "Marcus", position: 1, diff: 0, invalidated: false },
          { name: "Ronaldo", position: 2, diff: 5, invalidated: false },
        ],
      },
      // Nenhuma chave "day:2026-07-25" — se o filtro de dia útil vazasse,
      // isso quebraria com day=null (comportamento correto: pula o dia).
    });
  }

  test("pula finais de semana sem nem incluir a chave no MGET", async () => {
    const kv = buildBetsKv();
    const users = [
      { name: "Ronaldo", isHCM: true },
      { name: "Marcus", isHCM: true },
      { name: "Julio", isHCM: false },
    ];

    await calcBalance(kv, users[0], users);

    const dayMgetCall = kv.mgetCalls.find((keys) => keys.some((k) => k.startsWith("day:")));
    assert.ok(dayMgetCall, "deveria ter buscado os dias do histórico num mget");
    assert.deepEqual(dayMgetCall.sort(), ["day:2026-07-20", "day:2026-07-21"]);
  });

  test("bônus de +5 do HCM só é aplicado a quem está em 1º entre os HCM naquele dia", async () => {
    const kv = buildBetsKv();
    const users = [
      { name: "Ronaldo", isHCM: true },
      { name: "Marcus", isHCM: true },
      { name: "Julio", isHCM: false },
    ];

    const ronaldo = await calcBalance(kv, users[0], users);
    const marcus = await calcBalance(kv, users[1], users);

    // Dia 1: Ronaldo é o HCM em 1º (30 + bônus 5). Dia 2: Marcus é o HCM em
    // 1º (30 + bônus 5), Ronaldo fica em 2º nesse dia (diff 5 → banda de 25,
    // sem bônus). Resultado simétrico: os dois terminam com 60.
    assert.equal(ronaldo.earnedCoins, 30 + 5 + 25);
    assert.equal(marcus.earnedCoins, 25 + 30 + 5);
  });

  test("jogador não-HCM nunca recebe o bônus, mesmo vencendo o dia", async () => {
    const kv = buildBetsKv();
    const users = [
      { name: "Ronaldo", isHCM: true },
      { name: "Marcus", isHCM: true },
      { name: "Julio", isHCM: false },
    ];

    const julio = await calcBalance(kv, users[2], users);

    // Julio só apostou no dia 1, em 3º lugar, diff 50 → banda de 3 moedas, sem bônus (não é HCM).
    assert.equal(julio.earnedCoins, 3);
  });
});
