// Acessado via propriedade (não desestruturado) de propósito: permite que
// testes façam `require("./redis").getKV = fakeFn` pra injetar um kv de
// mentira nos middlewares abaixo, sem precisar de um framework de mock.
const redisLib = require("./redis");
const { userKey } = require("./utils");

// ─── Cache de leituras pesadas ────────────────────────────────────────────────
// Os endpoints de ranking/histórico/perfis fazem fan-out (1 leitura por dia ou
// por usuário). Para não estourar o limite de comandos do plano gratuito do
// Redis, o resultado computado é guardado sob uma única chave e só é
// recalculado quando os dados de origem mudam (ver invalidateCache nos pontos
// de escrita: setDayData, saveUsers e o middleware invalidatesCache).
//
// O TTL abaixo é só uma rede de segurança: se algum caminho de escrita futuro
// esquecer de invalidar a chave, o cache se autocorrige sozinho em poucos
// minutos em vez de ficar errado indefinidamente.
const CACHE_SAFETY_TTL_SECONDS = 5 * 60;

async function getCachedOrCompute(kv, cacheKey, computeFn) {
  const cached = await kv.get(cacheKey);
  if (cached !== null && cached !== undefined) return cached;
  const value = await computeFn();
  await kv.set(cacheKey, value, { ex: CACHE_SAFETY_TTL_SECONDS });
  return value;
}

async function invalidateCache(kv, ...keys) {
  if (keys.length) await kv.del(...keys);
}

// Middleware: invalida as chaves de cache informadas antes de a rota responder
// com sucesso (status < 400). Centraliza a invalidação na declaração da rota
// em vez de espalhar `invalidateCache` pelo corpo de cada handler — uma rota
// nova que use este middleware nunca esquece de invalidar.
//
// Importante: a invalidação precisa ser aguardada (await) ANTES do
// res.json() sair, não disparada depois via res.on("finish"). Em ambiente
// serverless (Vercel), a invocação da função pode ser encerrada assim que a
// resposta é enviada — qualquer trabalho assíncrono não aguardado que ainda
// esteja em voo (como o DEL no Upstash) corre risco real de ser interrompido
// antes de terminar, deixando o cache velho para trás silenciosamente. Por
// isso o res.json é interceptado aqui: a invalidação roda e é aguardada
// primeiro, e só then a resposta original é enviada.
function invalidatesCache(...cacheKeys) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400) return originalJson(body);
      const kv = redisLib.getKV();
      return invalidateCache(kv, ...cacheKeys)
        .catch((e) => console.error("[CACHE INVALIDATE]", cacheKeys, e))
        .then(() => originalJson(body));
    };
    next();
  };
}

// Middleware: invalida o cache de saldo (balance:<uKey>) do usuário
// autenticado da requisição antes de a rota responder com sucesso — mesma
// ideia de invalidatesCache (ver nota acima sobre por que precisa ser
// aguardado antes do res.json, não depois), mas para a chave dinâmica por
// usuário do calcBalance (ver getCachedBalance em lib/store-items.js). Ações
// de admin que alteram o saldo de OUTRO usuário (não o autenticado) não usam
// este middleware — precisam invalidar manualmente a chave do usuário-alvo.
function invalidatesUserBalance() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 400 || !req.sessionName) return originalJson(body);
      const kv = redisLib.getKV();
      return invalidateCache(kv, `balance:${userKey(req.sessionName)}`)
        .catch((e) => console.error("[CACHE INVALIDATE balance]", req.sessionName, e))
        .then(() => originalJson(body));
    };
    next();
  };
}

module.exports = {
  CACHE_SAFETY_TTL_SECONDS,
  getCachedOrCompute,
  invalidateCache,
  invalidatesCache,
  invalidatesUserBalance,
};
