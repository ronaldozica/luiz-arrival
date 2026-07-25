const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { getCachedBalance } = require("../../api/lib/store-items");
const { invalidateCache, invalidatesUserBalance } = require("../../api/lib/cache");

// Mesmo mock de test/lib/calc-balance.test.js, com get/set/del/mget sobre um
// objeto em memória — o bastante pra exercitar getCachedOrCompute e
// invalidateCache sem precisar de um Redis de verdade.
function makeMockKv(store = {}) {
  const delCalls = [];
  return {
    store,
    delCalls,
    async get(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    async set(key, value) {
      store[key] = value;
    },
    async del(...keys) {
      delCalls.push(keys);
      let count = 0;
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(store, k)) {
          delete store[k];
          count++;
        }
      }
      return count;
    },
    async mget(keys) {
      return keys.map((k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null));
    },
  };
}

describe("getCachedBalance", () => {
  test("cache miss: computa via calcBalance e grava o resultado em balance:<uKey>", async () => {
    const kv = makeMockKv({
      days_index: [],
      "gamecoins:ronaldo": 100,
    });
    const user = { name: "Ronaldo", isHCM: false };

    const result = await getCachedBalance(kv, user, [user]);

    assert.equal(result.earnedCoins, 100);
    assert.ok(kv.store["balance:ronaldo"], "deveria ter gravado o resultado no cache");
    assert.equal(kv.store["balance:ronaldo"].earnedCoins, 100);
  });

  test("cache hit: retorna o valor cacheado sem recomputar (mesmo que os dados de origem mudem depois)", async () => {
    const kv = makeMockKv({
      days_index: [],
      "gamecoins:ronaldo": 100,
      // Cache já preenchido com um valor "congelado" propositalmente diferente
      // do que os campos da carteira dariam agora — se getCachedBalance
      // recomputasse, o teste pegaria a diferença.
      "balance:ronaldo": { earnedCoins: 9999, spentCoins: 0, purchases: [] },
    });
    const user = { name: "Ronaldo", isHCM: false };

    const result = await getCachedBalance(kv, user, [user]);

    assert.equal(result.earnedCoins, 9999, "deveria devolver o valor cacheado, não recalcular de gamecoins:ronaldo (100)");
  });

  test("chave de cache é por usuário — saldo de um jogador não vaza pro outro", async () => {
    const kv = makeMockKv({
      days_index: [],
      "gamecoins:ronaldo": 100,
      "gamecoins:julio": 5,
    });
    const users = [{ name: "Ronaldo", isHCM: false }, { name: "Julio", isHCM: false }];

    const ronaldo = await getCachedBalance(kv, users[0], users);
    const julio = await getCachedBalance(kv, users[1], users);

    assert.equal(ronaldo.earnedCoins, 100);
    assert.equal(julio.earnedCoins, 5);
    assert.notEqual(kv.store["balance:ronaldo"], kv.store["balance:julio"]);
  });
});

describe("invalidatesUserBalance (middleware)", () => {
  // Fake mínimo de res do Express: só o bastante pra testar o res.json
  // interceptado (ver cache.js — a invalidação precisa ser AGUARDADA antes
  // do res.json original sair, não disparada depois via res.on("finish"),
  // porque em ambiente serverless a função pode ser encerrada assim que a
  // resposta é enviada, matando qualquer trabalho assíncrono ainda em voo).
  function makeFakeRes(statusCode = 200) {
    const jsonCalls = [];
    return {
      statusCode,
      json(body) { jsonCalls.push(body); return body; },
      jsonCalls,
    };
  }

  test("resposta bem-sucedida (< 400): invalida balance:<uKey> ANTES do res.json original sair", async () => {
    const kv = makeMockKv({ "balance:ronaldo": { earnedCoins: 1 } });
    // getKV() dentro do middleware chama require("./redis").getKV() de verdade
    // (conecta no Upstash real) — pra testar isolado, monkey-patchamos o
    // módulo (ver comentário sobre acesso via propriedade em cache.js).
    const redisLib = require("../../api/lib/redis");
    const originalGetKV = redisLib.getKV;
    redisLib.getKV = () => kv;
    try {
      const middleware = invalidatesUserBalance();
      const req = { sessionName: "Ronaldo" };
      const res = makeFakeRes(200);
      let nextCalled = false;
      middleware(req, res, () => { nextCalled = true; });
      assert.ok(nextCalled, "deveria chamar next() de imediato, sem esperar a invalidação");

      // Simula a rota chamando res.json(...) no final do handler — com o
      // middleware aplicado, isso já é a versão interceptada.
      await res.json({ success: true });

      assert.ok(!("balance:ronaldo" in kv.store), "chave deveria ter sido removida");
      assert.deepEqual(res.jsonCalls, [{ success: true }], "o corpo original ainda devia chegar ao cliente, sem alteração");
    } finally {
      redisLib.getKV = originalGetKV;
    }
  });

  test("resposta de erro (>= 400): NÃO invalida (nada mudou de verdade)", async () => {
    const kv = makeMockKv({ "balance:ronaldo": { earnedCoins: 1 } });
    const redisLib = require("../../api/lib/redis");
    const originalGetKV = redisLib.getKV;
    redisLib.getKV = () => kv;
    try {
      const middleware = invalidatesUserBalance();
      const req = { sessionName: "Ronaldo" };
      const res = makeFakeRes(400);
      middleware(req, res, () => {});
      await res.json({ error: "LuizCoins insuficientes" });

      assert.ok("balance:ronaldo" in kv.store, "chave não deveria ter sido removida numa resposta de erro");
    } finally {
      redisLib.getKV = originalGetKV;
    }
  });

  test("sem req.sessionName (não deveria acontecer com requireAuth, mas defensivo): NÃO invalida nem quebra", async () => {
    const kv = makeMockKv({ "balance:ronaldo": { earnedCoins: 1 } });
    const redisLib = require("../../api/lib/redis");
    const originalGetKV = redisLib.getKV;
    redisLib.getKV = () => kv;
    try {
      const middleware = invalidatesUserBalance();
      const req = {};
      const res = makeFakeRes(200);
      middleware(req, res, () => {});
      await res.json({ success: true });

      assert.ok("balance:ronaldo" in kv.store);
      assert.deepEqual(res.jsonCalls, [{ success: true }]);
    } finally {
      redisLib.getKV = originalGetKV;
    }
  });
});

describe("invalidateCache com múltiplas chaves (invalidação em massa no fechamento do dia)", () => {
  test("N chaves viram 1 única chamada de del, não N chamadas", async () => {
    const kv = makeMockKv({
      "balance:ronaldo": { earnedCoins: 1 },
      "balance:julio": { earnedCoins: 2 },
      "balance:marcus": { earnedCoins: 3 },
    });

    await invalidateCache(kv, "balance:ronaldo", "balance:julio", "balance:marcus");

    assert.equal(kv.delCalls.length, 1, "deveria ter feito exatamente 1 chamada de del pras 3 chaves");
    assert.deepEqual(kv.delCalls[0].sort(), ["balance:julio", "balance:marcus", "balance:ronaldo"]);
    assert.equal(Object.keys(kv.store).length, 0, "as 3 chaves deveriam ter sumido");
  });

  test("lista vazia de chaves não chama del (evita erro de comando sem argumento)", async () => {
    const kv = makeMockKv({});
    await invalidateCache(kv);
    assert.equal(kv.delCalls.length, 0);
  });
});
