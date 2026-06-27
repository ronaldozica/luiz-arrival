const { invalidateCache } = require("./cache");
const { getWeekKey } = require("./datetime");

// Histórico fica retido indefinidamente — cada dia ocupa poucos bytes e, com
// ~30 usuários, levaria anos para se aproximar do limite do plano gratuito do
// Redis. Se isso um dia virar um problema real, monitore o uso no painel da
// Upstash e decida o que arquivar/remover; não há remoção automática aqui.
async function getDayData(kv, dateKey) {
  if (!kv) return { guesses: [], arrival: null };
  const data = await kv.get(`day:${dateKey}`);
  return data || { guesses: [], arrival: null };
}

async function setDayData(kv, dateKey, data) {
  await kv.set(`day:${dateKey}`, data);
  let index = (await kv.get("days_index")) || [];
  if (!index.includes(dateKey)) {
    index.push(dateKey);
    index.sort();
    await kv.set("days_index", index);
  }
  await invalidateCache(
    kv,
    "cache:history",
    "cache:overall_rank",
    `cache:week_rank:${getWeekKey(dateKey)}`,
    "cache:weekly_history",
  );
}

module.exports = { getDayData, setDayData };
