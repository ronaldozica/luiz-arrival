const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber, parseRedisArray } = require("../lib/utils");
const { calcBalance } = require("../lib/store-items");
const { unlockAchievement } = require("../lib/achievement-defs");

const BET_AMOUNTS = { low: 5, medium: 15, high: 30 };

// Ordem física real da roda europeia (zero único) — usada tanto pra resolver
// a aposta quanto (no cliente) pro ângulo de cada número na rodinha bater com
// uma roleta de verdade.
const EU_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const BET_TYPES = new Set([
  "straight", "red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3",
]);
// Multiplicador líquido (lucro, não retorno bruto) — mesma convenção do Blackjack,
// onde coinsWon já É o lucro da aposta.
const PAYOUTS = {
  straight: 35, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
  dozen1: 2, dozen2: 2, dozen3: 2,
};

function numberColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

function betWins(betType, number, winningNumber) {
  switch (betType) {
    case "straight": return winningNumber === number;
    case "red": return RED_NUMBERS.has(winningNumber);
    case "black": return winningNumber !== 0 && !RED_NUMBERS.has(winningNumber);
    case "odd": return winningNumber !== 0 && winningNumber % 2 === 1;
    case "even": return winningNumber !== 0 && winningNumber % 2 === 0;
    case "low": return winningNumber >= 1 && winningNumber <= 18;
    case "high": return winningNumber >= 19 && winningNumber <= 36;
    case "dozen1": return winningNumber >= 1 && winningNumber <= 12;
    case "dozen2": return winningNumber >= 13 && winningNumber <= 24;
    case "dozen3": return winningNumber >= 25 && winningNumber <= 36;
    default: return false;
  }
}

async function getRlHistory(kv) {
  return parseRedisArray(await kv.get("roulette_history"));
}

async function pushRlHistory(kv, entry) {
  const history = await getRlHistory(kv);
  history.unshift(entry);
  if (history.length > 10) history.length = 10;
  await kv.set("roulette_history", history);
  return history;
}

async function acquireRlLock(kv, uKey) {
  const result = await kv.set(`rllock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}
async function releaseRlLock(kv, uKey) {
  await kv.del(`rllock:${uKey}`);
}

// ─── GET /api/roulette/status ─────────────────────────────────────────────────
router.get("/roulette/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    const history = await getRlHistory(kv);

    res.json({ balance, history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/roulette/spin ───────────────────────────────────────────────────
router.post("/roulette/spin", requireAuth, async (req, res) => {
  const { betType, betAmount, number } = req.body;
  const stake = BET_AMOUNTS[betAmount];
  if (!stake) return res.status(400).json({ error: "Ficha de aposta inválida." });
  if (!BET_TYPES.has(betType)) return res.status(400).json({ error: "Tipo de aposta inválido." });
  if (betType === "straight") {
    const n = Number(number);
    if (!Number.isInteger(n) || n < 0 || n > 36)
      return res.status(400).json({ error: "Número inválido." });
  }

  const kv = getKV();
  const uKey = userKey(req.sessionName);
  if (!(await acquireRlLock(kv, uKey)))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === uKey);
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    if (balance < stake) return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const winningNumber = Math.floor(Math.random() * 37);
    const color = numberColor(winningNumber);
    const won = betWins(betType, betType === "straight" ? Number(number) : undefined, winningNumber);

    let coinsWon = 0;
    let coinsLost = 0;
    if (won) {
      coinsWon = stake * PAYOUTS[betType];
    } else {
      coinsLost = stake;
    }

    if (coinsWon > 0) {
      const wonKey = `roulettewon:${uKey}`;
      const newTotal = parseRedisNumber(await kv.get(wonKey)) + coinsWon;
      await kv.set(wonKey, newTotal);

      const rlRank = (await kv.get("gamerank:roulette")) || [];
      const existingIdx = rlRank.findIndex((s) => userKey(s.name) === uKey);
      if (existingIdx >= 0) rlRank.splice(existingIdx, 1);
      rlRank.push({ name: user.name, score: newTotal, date: new Date().toISOString() });
      rlRank.sort((a, b) => b.score - a.score);
      if (rlRank.length > 50) rlRank.length = 50;
      await kv.set("gamerank:roulette", rlRank);
    }
    if (coinsLost > 0) {
      const lostKey = `roulettelost:${uKey}`;
      await kv.set(lostKey, parseRedisNumber(await kv.get(lostKey)) + coinsLost);
    }

    const spinsKey = `roulettespins:${uKey}`;
    await kv.set(spinsKey, parseRedisNumber(await kv.get(spinsKey)) + 1);

    // ─── Conquistas ─────────────────────────────────────────────────────────
    const newAchievements = [];
    const streakKey = `rl_streak:${uKey}`;

    if (won) {
      const newStreak = parseRedisNumber(await kv.get(streakKey)) + 1;
      await kv.set(streakKey, newStreak);

      if (await unlockAchievement(kv, user.name, "rl_first_win")) newAchievements.push("rl_first_win");
      if (betType === "straight" && await unlockAchievement(kv, user.name, "rl_straight_win")) newAchievements.push("rl_straight_win");
      if (betAmount === "high" && await unlockAchievement(kv, user.name, "rl_high_roller")) newAchievements.push("rl_high_roller");
      if (newStreak >= 3 && await unlockAchievement(kv, user.name, "rl_streak_3")) newAchievements.push("rl_streak_3");
    } else {
      await kv.del(streakKey);
    }

    const history = await pushRlHistory(kv, { number: winningNumber, color });
    const newBalance = Math.max(0, balance + coinsWon - coinsLost);

    res.json({
      winningNumber,
      color,
      outcome: won ? "win" : "lose",
      coinsWon,
      coinsLost,
      balance: newBalance,
      history,
      newAchievements,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseRlLock(kv, uKey);
  }
});

// ─── GET /api/roulette/rank ─────────────────────────────────────────────────────
router.get("/roulette/rank", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const entries = [];
    for (const user of users) {
      const uKey = userKey(user.name);
      const coinsWon = parseRedisNumber(await kv.get(`roulettewon:${uKey}`));
      if (coinsWon <= 0) continue;
      const spinsPlayed = parseRedisNumber(await kv.get(`roulettespins:${uKey}`));
      entries.push({ name: user.name, coinsWon, spinsPlayed });
    }
    entries.sort((a, b) => b.coinsWon - a.coinsWon);
    res.json(entries.slice(0, 50));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
// Anexado ao router (não substitui o export default) só pra permitir teste
// unitário direto — ver test/routes/roulette.test.js.
module.exports.numberColor = numberColor;
module.exports.betWins = betWins;
module.exports.EU_WHEEL_ORDER = EU_WHEEL_ORDER;
module.exports.RED_NUMBERS = RED_NUMBERS;
module.exports.PAYOUTS = PAYOUTS;
