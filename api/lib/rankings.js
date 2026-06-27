const { getDayData } = require("./days");
const { isWeekday, getWeekKey } = require("./datetime");
const { userKey } = require("./utils");
const { coinsForGuess } = require("./store-items");

// ─── Ranking agregado (ranking semanal e geral) ─────────────────────────────
// Tudo aqui é recalculado a partir de `days_index` + `day:<data>` e fica atrás
// de getCachedOrCompute (ver routes/bets.js) — só recomputa quando os dados
// de origem mudam. Com ~30 usuários e histórico retido indefinidamente
// (ver lib/days.js), isso ainda é barato; se a base de usuários crescer muito,
// vale considerar manter contadores incrementais por usuário em vez de
// reprocessar o histórico inteiro a cada invalidação de cache.

// Mínimo de dias jogados para entrar no ranking geral "oficial" — abaixo
// disso, o jogador aparece na lista separada de novatos. Evita que 1 ou 2
// acertos isolados projetem alguém ao topo só pela média de poucas amostras.
const MIN_DAYS_FOR_OVERALL_RANK = 5;

function emptyStats(name, isHCM) {
  return { name, isHCM, points: 0, wins: 0, days: 0, totalDiff: 0 };
}

// Acumula, para cada usuário presente em day.rankings, os pontos (moedas de
// precisão), vitórias e erro acumulado — usado tanto pelo ranking semanal
// quanto pelo geral.
function accumulateDay(scores, day, hcmNames) {
  if (!day.arrival || !day.rankings) return;
  for (const r of day.rankings) {
    const key = r.name;
    if (!scores[key]) scores[key] = emptyStats(r.name, hcmNames.has(userKey(r.name)));
    scores[key].points += coinsForGuess(r);
    if (!r.invalidated) {
      scores[key].totalDiff += r.diff;
      scores[key].days += 1;
      if (r.position === 1) scores[key].wins += 1;
    }
  }
}

function finalizeScores(scores) {
  return Object.values(scores).map((s) => ({
    ...s,
    avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0,
  }));
}

async function computeWeekRanking(kv, users, weekKey) {
  const hcmNames = new Set(users.filter((u) => u.isHCM).map((u) => userKey(u.name)));
  const index = (await kv.get("days_index")) || [];
  const scores = {};
  let dateKeys = [];

  for (const dateKey of index) {
    if (!isWeekday(dateKey) || getWeekKey(dateKey) !== weekKey) continue;
    dateKeys.push(dateKey);
    const day = await getDayData(kv, dateKey);
    accumulateDay(scores, day, hcmNames);
  }

  const ranking = finalizeScores(scores).sort(
    (a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins,
  );
  return { weekKey, dateKeys: dateKeys.sort(), ranking };
}

async function computeOverallRanking(kv, users) {
  const hcmNames = new Set(users.filter((u) => u.isHCM).map((u) => userKey(u.name)));
  const index = (await kv.get("days_index")) || [];
  const scores = {};

  for (const dateKey of index) {
    if (!isWeekday(dateKey)) continue;
    const day = await getDayData(kv, dateKey);
    accumulateDay(scores, day, hcmNames);
  }

  const all = finalizeScores(scores).map((s) => ({
    ...s,
    avgPoints: s.days > 0 ? Math.round((s.points / s.days) * 10) / 10 : 0,
  }));

  const ranked = all
    .filter((s) => s.days >= MIN_DAYS_FOR_OVERALL_RANK)
    .sort((a, b) => b.avgPoints - a.avgPoints || a.avgDiffMins - b.avgDiffMins);
  const rookies = all
    .filter((s) => s.days > 0 && s.days < MIN_DAYS_FOR_OVERALL_RANK)
    .sort((a, b) => b.avgPoints - a.avgPoints || a.avgDiffMins - b.avgDiffMins);

  return { ranked, rookies, minDays: MIN_DAYS_FOR_OVERALL_RANK };
}

// Lista as semanas anteriores (exclui a semana atual) com o ranking final de
// cada uma, mais recente primeiro. Usado pela aba "Rankings anteriores".
async function listPastWeeks(kv, users, currentWeekKey) {
  const index = (await kv.get("days_index")) || [];
  const weekDates = {};
  for (const dateKey of index) {
    if (!isWeekday(dateKey)) continue;
    const weekKey = getWeekKey(dateKey);
    if (weekKey === currentWeekKey) continue;
    if (!weekDates[weekKey]) weekDates[weekKey] = [];
    weekDates[weekKey].push(dateKey);
  }

  const weekKeys = Object.keys(weekDates).sort().reverse();
  const weeks = [];
  for (const weekKey of weekKeys) {
    const { ranking, dateKeys } = await computeWeekRanking(kv, users, weekKey);
    if (ranking.length === 0) continue;
    weeks.push({
      weekKey,
      startDate: dateKeys[0],
      endDate: dateKeys[dateKeys.length - 1],
      ranking,
    });
  }
  return weeks;
}

// Conta quantos dias válidos (não invalidados) o usuário já jogou, sem contar
// `excludeDateKey` (o dia que está sendo resolvido agora pelo admin). Usado só
// para checar a conquista "novato em ascensão" — não precisa de cache próprio
// porque só corre uma vez por resolução de chegada (ação rara do admin).
async function countPlayedDaysBefore(kv, name, excludeDateKey) {
  const index = (await kv.get("days_index")) || [];
  let count = 0;
  for (const dateKey of index) {
    if (dateKey === excludeDateKey || !isWeekday(dateKey)) continue;
    const day = await getDayData(kv, dateKey);
    if (!day.rankings) continue;
    const entry = day.rankings.find((r) => userKey(r.name) === userKey(name));
    if (entry && !entry.invalidated) count++;
  }
  return count;
}

module.exports = {
  MIN_DAYS_FOR_OVERALL_RANK,
  computeWeekRanking,
  computeOverallRanking,
  listPastWeeks,
  countPlayedDaysBefore,
};
