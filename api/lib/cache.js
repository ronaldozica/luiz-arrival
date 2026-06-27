const { getKV } = require("./redis");

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

// Middleware: invalida as chaves de cache informadas depois que a rota
// responde com sucesso (status < 400). Centraliza a invalidação na
// declaração da rota em vez de espalhar `invalidateCache` pelo corpo de cada
// handler — uma rota nova que use este middleware nunca esquece de invalidar.
function invalidatesCache(...cacheKeys) {
  return (req, res, next) => {
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      const kv = getKV();
      invalidateCache(kv, ...cacheKeys).catch((e) =>
        console.error("[CACHE INVALIDATE]", cacheKeys, e),
      );
    });
    next();
  };
}

module.exports = {
  CACHE_SAFETY_TTL_SECONDS,
  getCachedOrCompute,
  invalidateCache,
  invalidatesCache,
};
