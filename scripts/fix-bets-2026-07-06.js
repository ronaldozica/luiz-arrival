// Recalcula as invalidações do dia 2026-07-06 com a regra corrigida.
// Apostas feitas dentro de 15 min do horário real de chegada (em qualquer
// direção — antes OU depois) são invalidadas por sniping.
require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const { Redis } = require("@upstash/redis");

const kv = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SNIPING_WINDOW_MS = 15 * 60 * 1000;
const BRASILIA_UTC_OFFSET_MINUTES = 3 * 60;

function brasiliaWallTimeToInstant(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) + BRASILIA_UTC_OFFSET_MINUTES * 60000;
}

function timeStrToMinutes(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

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

async function main() {
  const key = "2026-07-06";
  const day = (await kv.get(`day:${key}`)) || { guesses: [], arrival: null };

  if (!day.arrival) {
    console.error("Nenhuma chegada registrada para", key);
    process.exit(1);
  }

  console.log(`Data: ${key} | Chegada: ${day.arrival}`);
  console.log(`\nApostas encontradas (${day.guesses.length}):`);
  day.guesses.forEach((g) =>
    console.log(`  ${g.name}: aposta ${g.time}, feita às ${new Date(g.createdAt).toLocaleString("pt-BR")}`)
  );

  const arrivalMins = timeStrToMinutes(day.arrival);
  const arrivalInstant = brasiliaWallTimeToInstant(key, day.arrival);

  const withDiff = day.guesses.map((g) => {
    const createdAtMs = Date.parse(g.createdAt) || 0;
    const sinceArrivalMs = arrivalInstant - createdAtMs;
    return {
      ...g,
      diff: Math.abs(timeStrToMinutes(g.time) - arrivalMins),
      invalidated: Math.abs(sinceArrivalMs) <= SNIPING_WINDOW_MS,
      _deltaMin: Math.round(sinceArrivalMs / 60000),
    };
  });

  console.log("\nAnálise de sniping (positivo = aposta feita ANTES da chegada):");
  withDiff.forEach((g) =>
    console.log(
      `  ${g.invalidated ? "❌ INVÁLIDA" : "✅ válida  "} ${g.name}: delta ${g._deltaMin} min (${g._deltaMin >= 0 ? "antes" : "depois"} da chegada)`
    )
  );

  const valid = withDiff
    .filter((g) => !g.invalidated)
    .sort((a, b) => a.diff - b.diff || Date.parse(a.createdAt) - Date.parse(b.createdAt));
  valid.forEach((g, i) => { g.position = i + 1; });

  const invalidated = withDiff.filter((g) => g.invalidated);
  invalidated.forEach((g) => { g.position = null; });

  day.rankings = [...valid, ...invalidated].map(({ _deltaMin, ...rest }) => rest);

  await kv.set(`day:${key}`, day);

  const weekKey = getWeekKey(key);
  const deleted = await kv.del(
    "cache:history",
    "cache:overall_rank",
    `cache:week_rank:${weekKey}`,
    "cache:weekly_history"
  );
  console.log(`\nCache invalidado (${deleted} chave(s)).`);

  console.log("\nRanking final:");
  day.rankings.forEach((r) =>
    console.log(`  ${r.position ? `#${r.position}` : "❌"} ${r.name}: aposta ${r.time}, diff ${r.diff} min`)
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
