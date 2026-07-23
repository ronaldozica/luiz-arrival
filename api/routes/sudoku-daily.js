const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber } = require("../lib/utils");
const { todayKey, getBrasiliaDate } = require("../lib/datetime");
const { generateDailyPuzzle, boardMatchesSolution } = require("../lib/sudoku-daily");

const ROUND_TOKEN_TTL_SECONDS = 2 * 60 * 60;
const ROUND_TOKEN_TOLERANCE_SECONDS = 2;
const MIN_SECONDS = 15; // mesmo piso do Sudoku médio normal (ver api/lib/games.js)
const RANK_SIZE = 50;

function yesterdayKey() {
  const d = getBrasiliaDate();
  d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function getOrCreateDailyPuzzle(kv, dateKey) {
  const key = `sudoku_daily:${dateKey}`;
  let data = await kv.get(key);
  if (!data) {
    const generated = generateDailyPuzzle(dateKey);
    await kv.set(key, generated, { nx: true });
    data = (await kv.get(key)) || generated;
  }
  return typeof data === "string" ? JSON.parse(data) : data;
}

// Fecha o dia anterior (se ainda não foi fechado) e credita o 1º lugar de
// ontem em sudoku_daily_firsts. Sem cron nesse projeto — roda de forma
// preguiçosa na primeira consulta de status depois da virada do dia.
async function finalizeYesterday(kv) {
  const y = yesterdayKey();
  const finalizedKey = `sudoku_daily_finalized:${y}`;
  if (await kv.get(finalizedKey)) return;
  const claimed = await kv.set(finalizedKey, "1", { nx: true });
  if (!claimed) return; // outra requisição concorrente já está cuidando disso

  const rank = (await kv.get(`sudoku_daily_rank:${y}`)) || [];
  if (rank.length > 0) {
    const winnerKey = userKey(rank[0].name);
    const firstsKey = `sudoku_daily_firsts:${winnerKey}`;
    await kv.set(firstsKey, parseRedisNumber(await kv.get(firstsKey)) + 1);
  }
}

async function getAllTimeFirsts(kv) {
  const users = await getUsers(kv);
  const entries = [];
  for (const user of users) {
    const count = parseRedisNumber(await kv.get(`sudoku_daily_firsts:${userKey(user.name)}`));
    if (count <= 0) continue;
    entries.push({ name: user.name, count });
  }
  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, RANK_SIZE);
}

// ─── GET /api/sudoku-daily/status ──────────────────────────────────────────────
router.get("/sudoku-daily/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const date = todayKey();
    const uKey = userKey(req.sessionName);

    await finalizeYesterday(kv);
    const { puzzle } = await getOrCreateDailyPuzzle(kv, date);

    const resultRaw = await kv.get(`sudoku_daily_result:${uKey}:${date}`);
    const result = resultRaw ? (typeof resultRaw === "string" ? JSON.parse(resultRaw) : resultRaw) : null;

    const todayRank = ((await kv.get(`sudoku_daily_rank:${date}`)) || []).slice(0, RANK_SIZE);
    const allTimeFirsts = await getAllTimeFirsts(kv);

    res.json({
      date,
      puzzle,
      alreadyPlayed: !!result,
      result,
      todayRank,
      allTimeFirsts,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/sudoku-daily/start ──────────────────────────────────────────────
router.post("/sudoku-daily/start", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const date = todayKey();
    const uKey = userKey(req.sessionName);

    const existing = await kv.get(`sudoku_daily_result:${uKey}:${date}`);
    if (existing) return res.status(400).json({ error: "Você já jogou o desafio de hoje." });

    const roundToken = crypto.randomBytes(24).toString("hex");
    await kv.set(
      `sdd_roundtoken:${roundToken}`,
      JSON.stringify({ name: req.sessionName, date, startedAt: Date.now() }),
      { ex: ROUND_TOKEN_TTL_SECONDS },
    );

    res.json({ roundToken });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/sudoku-daily/submit ─────────────────────────────────────────────
router.post("/sudoku-daily/submit", requireAuth, async (req, res) => {
  try {
    const { board, mistakes, roundToken } = req.body;
    const kv = getKV();
    const date = todayKey();
    const uKey = userKey(req.sessionName);

    if (await kv.get(`sudoku_daily_result:${uKey}:${date}`))
      return res.status(400).json({ error: "Você já jogou o desafio de hoje." });

    if (!roundToken) return res.status(400).json({ error: "Token de rodada ausente. Reabra o desafio." });
    const tokenKey = `sdd_roundtoken:${roundToken}`;
    const tokenRaw = await kv.get(tokenKey);
    await kv.del(tokenKey); // uso único
    if (!tokenRaw) return res.status(400).json({ error: "Token de rodada inválido ou expirado." });
    const tokenData = typeof tokenRaw === "string" ? JSON.parse(tokenRaw) : tokenRaw;
    if (userKey(tokenData.name) !== uKey || tokenData.date !== date)
      return res.status(400).json({ error: "Token de rodada não corresponde à partida enviada." });

    const elapsedSeconds = (Date.now() - tokenData.startedAt) / 1000;
    if (elapsedSeconds < MIN_SECONDS - ROUND_TOKEN_TOLERANCE_SECONDS)
      return res.status(400).json({ error: "Tempo de partida incompatível com o resultado enviado." });

    const { solution } = await getOrCreateDailyPuzzle(kv, date);
    const won = boardMatchesSolution(board, solution);
    const timeSeconds = Math.round(elapsedSeconds);

    const result = { won, timeSeconds, mistakes: Number(mistakes) || 0, completedAt: new Date().toISOString() };
    await kv.set(`sudoku_daily_result:${uKey}:${date}`, result, { ex: 60 * 24 * 60 * 60 });

    let todayRank = (await kv.get(`sudoku_daily_rank:${date}`)) || [];
    if (won) {
      todayRank.push({ name: req.sessionName, timeSeconds, date: new Date().toISOString() });
      todayRank.sort((a, b) => a.timeSeconds - b.timeSeconds);
      if (todayRank.length > RANK_SIZE) todayRank.length = RANK_SIZE;
      await kv.set(`sudoku_daily_rank:${date}`, todayRank);
    }

    res.json({ won, timeSeconds, todayRank });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
