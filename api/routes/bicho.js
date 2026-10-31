const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesUserBalance } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber, parseRedisArray } = require("../lib/utils");
const { todayKey } = require("../lib/datetime");
const { getCachedBalance } = require("../lib/store-items");
const { unlockAchievement } = require("../lib/achievement-defs");
const {
  ANIMALS,
  BET_AMOUNTS,
  PAYOUTS,
  BET_MODES,
  pickDailyDraw,
  formatDrawPrizes,
  isValidBetInput,
  resolveBichoBet,
  sortTodayWinners,
} = require("../lib/bicho");

const RANK_SIZE = 50;

async function acquireBichoLock(kv, uKey) {
  const result = await kv.set(`bicholock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}

async function releaseBichoLock(kv, uKey) {
  await kv.del(`bicholock:${uKey}`);
}

// Os 5 milhares do dia nunca saem do servidor antes do jogador fazer sua
// fézinha de hoje. NX evita duas requisições simultâneas gravarem sorteios
// diferentes para a mesma data.
async function getOrCreateDailyDraw(kv, dateKey) {
  const key = `bicho_daily_draw:${dateKey}`;
  let raw = await kv.get(key);
  if (!raw) {
    const generated = pickDailyDraw(dateKey);
    await kv.set(key, generated, { nx: true });
    raw = (await kv.get(key)) || generated;
  }
  return parseRedisArray(raw).length === 5 ? parseRedisArray(raw) : pickDailyDraw(dateKey);
}

function defaultState() {
  return { done: false, bet: null };
}

async function getState(kv, uKey, date) {
  const raw = await kv.get(`bicho_daily_state:${uKey}:${date}`);
  if (!raw) return defaultState();
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function saveState(kv, uKey, date, state) {
  await kv.set(`bicho_daily_state:${uKey}:${date}`, state, { ex: 60 * 24 * 60 * 60 });
}

async function buildBichoRank(kv, users) {
  const list = users || (await getUsers(kv));
  const entries = [];
  for (const user of list) {
    const uKey = userKey(user.name);
    const coinsWon = parseRedisNumber(await kv.get(`bichowon:${uKey}`));
    const wins = parseRedisNumber(await kv.get(`bichowins:${uKey}`));
    const betsPlayed = parseRedisNumber(await kv.get(`bichobets:${uKey}`));
    if (coinsWon <= 0 && wins <= 0 && betsPlayed <= 0) continue;
    entries.push({ name: user.name, coinsWon, wins, betsPlayed });
  }
  entries.sort((a, b) => b.coinsWon - a.coinsWon || b.wins - a.wins || b.betsPlayed - a.betsPlayed);
  return entries.slice(0, RANK_SIZE);
}

// ─── GET /api/bicho/status ───────────────────────────────────────────────────
router.get("/bicho/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const date = todayKey();
    const uKey = userKey(user.name);
    const { earnedCoins, spentCoins } = await getCachedBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);

    const state = await getState(kv, uKey, date);
    let draw = null;
    if (state.done) {
      const prizes = await getOrCreateDailyDraw(kv, date);
      draw = formatDrawPrizes(prizes);
    }

    const todayWinners = sortTodayWinners(parseRedisArray(await kv.get(`bicho_daily_winners:${date}`)));
    const rank = await buildBichoRank(kv, users);

    res.json({
      date,
      balance,
      done: !!state.done,
      bet: state.bet || null,
      draw,
      todayWinners,
      rank,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bicho/bet ─────────────────────────────────────────────────────
router.post("/bicho/bet", requireAuth, invalidatesUserBalance(), async (req, res) => {
  const { betAmount, mode, target } = req.body || {};
  const stake = BET_AMOUNTS[betAmount];
  if (!stake) return res.status(400).json({ error: "Valor de ficha inválido." });

  const normalizedTarget = mode === "dezena_cabeca"
    ? String(target ?? "").trim()
    : Number(target);

  if (!isValidBetInput(mode, normalizedTarget)) {
    return res.status(400).json({ error: "Palpite inválido para a modalidade escolhida." });
  }

  const kv = getKV();
  const uKey = userKey(req.sessionName);
  const locked = await acquireBichoLock(kv, uKey);
  if (!locked) {
    return res.status(429).json({ error: "Aguarde a aposta anterior terminar." });
  }

  try {
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === uKey);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const date = todayKey();
    const state = await getState(kv, uKey, date);
    if (state.done) {
      return res.status(400).json({ error: "Você já fez sua fézinha de hoje! Volte amanhã." });
    }

    const { earnedCoins, spentCoins } = await getCachedBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    if (balance < stake) {
      return res.status(400).json({ error: `Saldo insuficiente. Você tem ${balance} LuizCoins™.` });
    }

    const prizes = await getOrCreateDailyDraw(kv, date);
    const { outcome, coinsWon, coinsLost, matchedPrizes } = resolveBichoBet(
      { mode, target: normalizedTarget, stake },
      prizes,
    );
    const won = outcome === "win";

    if (coinsWon > 0) {
      const prevWon = parseRedisNumber(await kv.get(`bichowon:${uKey}`));
      await kv.set(`bichowon:${uKey}`, prevWon + coinsWon);
      const prevWins = parseRedisNumber(await kv.get(`bichowins:${uKey}`));
      await kv.set(`bichowins:${uKey}`, prevWins + 1);
    }
    if (coinsLost > 0) {
      const prevLost = parseRedisNumber(await kv.get(`bicholost:${uKey}`));
      await kv.set(`bicholost:${uKey}`, prevLost + coinsLost);
    }

    const prevBets = parseRedisNumber(await kv.get(`bichobets:${uKey}`));
    await kv.set(`bichobets:${uKey}`, prevBets + 1);

    const betRecord = {
      mode,
      target: normalizedTarget,
      betAmount,
      stake,
      outcome,
      coinsWon,
      coinsLost,
      matchedPrizes,
    };

    state.done = true;
    state.bet = betRecord;
    await saveState(kv, uKey, date, state);

    let todayWinners = parseRedisArray(await kv.get(`bicho_daily_winners:${date}`));
    if (won) {
      todayWinners.push({
        name: user.name,
        mode,
        target: normalizedTarget,
        stake,
        coinsWon,
        matchedPrizes,
        date: new Date().toISOString(),
      });
      todayWinners = sortTodayWinners(todayWinners).slice(0, RANK_SIZE);
      await kv.set(`bicho_daily_winners:${date}`, todayWinners);
    } else {
      todayWinners = sortTodayWinners(todayWinners);
    }

    const newAchievements = [];
    if (won) {
      if (await unlockAchievement(kv, user.name, "bicho_first_win")) newAchievements.push("bicho_first_win");
      if (matchedPrizes.includes(1) && await unlockAchievement(kv, user.name, "bicho_cabeca")) {
        newAchievements.push("bicho_cabeca");
      }
      if (mode === "dezena_cabeca" && await unlockAchievement(kv, user.name, "bicho_dezena")) {
        newAchievements.push("bicho_dezena");
      }
      if (betAmount === "high" && await unlockAchievement(kv, user.name, "bicho_high_roller")) {
        newAchievements.push("bicho_high_roller");
      }
    }

    const newBalance = Math.max(0, balance + coinsWon - coinsLost);
    const draw = formatDrawPrizes(prizes);
    const rank = await buildBichoRank(kv, users);

    res.json({
      date,
      outcome,
      coinsWon,
      coinsLost,
      balance: newBalance,
      done: true,
      bet: betRecord,
      draw,
      todayWinners,
      rank,
      newAchievements,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseBichoLock(kv, uKey);
  }
});

// ─── GET /api/bicho/rank ─────────────────────────────────────────────────────
router.get("/bicho/rank", async (req, res) => {
  try {
    const kv = getKV();
    const entries = await buildBichoRank(kv);
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.ANIMALS = ANIMALS;
module.exports.BET_AMOUNTS = BET_AMOUNTS;
module.exports.PAYOUTS = PAYOUTS;
module.exports.BET_MODES = BET_MODES;
module.exports.pickDailyDraw = pickDailyDraw;
module.exports.formatDrawPrizes = formatDrawPrizes;
module.exports.isValidBetInput = isValidBetInput;
module.exports.resolveBichoBet = resolveBichoBet;
