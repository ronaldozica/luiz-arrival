// Limpa as chaves de cache de ranking do Redis para que sejam recomputadas
// com a nova fórmula de pontuação (PRECISION_BANDS atualizada em store-items.js).
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

async function main() {
  // Calcula a semana ISO atual (mesma lógica de datetime.js)
  function getWeekKey(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const isoDay = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + (4 - isoDay));
    const isoYear = date.getUTCFullYear();
    const yearStart = new Date(Date.UTC(isoYear, 0, 1));
    const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
    return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
  }

  // Data de hoje em Brasília
  const now = new Date();
  const local = new Date(now.getTime() + (-3 * 60 + now.getTimezoneOffset()) * 60000);
  const todayStr = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  const yesterdayDate = new Date(local);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, "0")}-${String(yesterdayDate.getDate()).padStart(2, "0")}`;

  const thisWeek = getWeekKey(todayStr);
  const lastWeek = getWeekKey(yesterdayStr);

  const keys = [
    "cache:history",
    "cache:overall_rank",
    "cache:weekly_history",
    `cache:week_rank:${thisWeek}`,
  ];
  if (lastWeek !== thisWeek) {
    keys.push(`cache:week_rank:${lastWeek}`);
  }

  console.log(`Hoje: ${todayStr} (${thisWeek}), Ontem: ${yesterdayStr} (${lastWeek})`);
  console.log("Deletando chaves de cache:", keys);

  const deleted = await kv.del(...keys);
  console.log(`Feito — ${deleted} chave(s) deletada(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
