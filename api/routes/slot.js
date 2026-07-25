const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesUserBalance } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber, parseRedisArray } = require("../lib/utils");
const { getCachedBalance } = require("../lib/store-items");
const { unlockAchievement } = require("../lib/achievement-defs");

const BET_AMOUNTS = { low: 5, medium: 15, high: 30 };

// Símbolos com peso (probabilidade relativa) e multiplicador líquido (lucro,
// mesma convenção de roulette.js/blackjack.js) pago quando os 3 rolos batem
// no mesmo símbolo. Pesos somam 100 — quanto mais raro, maior o prêmio.
// 🕐 é o símbolo "jackpot", uma piada com o tema do site inteiro.
const SYMBOLS = [
  { id: "cherry",   emoji: "🍒", weight: 30, payout: 3 },
  { id: "lemon",    emoji: "🍋", weight: 25, payout: 4 },
  { id: "grape",    emoji: "🍇", weight: 20, payout: 6 },
  { id: "bell",     emoji: "🔔", weight: 12, payout: 10 },
  { id: "diamond",  emoji: "💎", weight: 8,  payout: 20 },
  { id: "clock",    emoji: "🕐", weight: 5,  payout: 75 },
];
const TOTAL_WEIGHT = SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

function spinReel() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const s of SYMBOLS) {
    if (roll < s.weight) return s.id;
    roll -= s.weight;
  }
  return SYMBOLS[SYMBOLS.length - 1].id;
}

function symbolPayout(id) {
  const s = SYMBOLS.find((s) => s.id === id);
  return s ? s.payout : 0;
}

// Resolve o resultado de uma rodada a partir dos 3 símbolos sorteados.
// - 3 iguais: ganha stake * payout do símbolo.
// - exatamente 2 iguais: perde só metade da ficha (consolação).
// - nenhum igual: perde a ficha inteira.
function resolveSpin(reels, stake) {
  const [a, b, c] = reels;
  if (a === b && b === c) {
    return { outcome: "win", coinsWon: stake * symbolPayout(a), coinsLost: 0 };
  }
  if (a === b || b === c || a === c) {
    return { outcome: "partial", coinsWon: 0, coinsLost: Math.floor(stake / 2) };
  }
  return { outcome: "lose", coinsWon: 0, coinsLost: stake };
}

async function getSlHistory(kv) {
  return parseRedisArray(await kv.get("slot_history"));
}

async function pushSlHistory(kv, entry) {
  const history = await getSlHistory(kv);
  history.unshift(entry);
  if (history.length > 10) history.length = 10;
  await kv.set("slot_history", history);
  return history;
}

async function acquireSlLock(kv, uKey) {
  const result = await kv.set(`sllock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}
async function releaseSlLock(kv, uKey) {
  await kv.del(`sllock:${uKey}`);
}

// ─── GET /api/slot/status ───────────────────────────────────────────────────
router.get("/slot/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins } = await getCachedBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    const history = await getSlHistory(kv);

    res.json({ balance, history });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/slot/spin ────────────────────────────────────────────────────
router.post("/slot/spin", requireAuth, invalidatesUserBalance(), async (req, res) => {
  const { betAmount } = req.body;
  const stake = BET_AMOUNTS[betAmount];
  if (!stake) return res.status(400).json({ error: "Ficha de aposta inválida." });

  const kv = getKV();
  const uKey = userKey(req.sessionName);
  if (!(await acquireSlLock(kv, uKey)))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === uKey);
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins } = await getCachedBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    if (balance < stake) return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const reels = [spinReel(), spinReel(), spinReel()];
    const { outcome, coinsWon, coinsLost } = resolveSpin(reels, stake);

    if (coinsWon > 0) {
      const wonKey = `slotwon:${uKey}`;
      const newTotal = parseRedisNumber(await kv.get(wonKey)) + coinsWon;
      await kv.set(wonKey, newTotal);

      const slRank = (await kv.get("gamerank:slot")) || [];
      const existingIdx = slRank.findIndex((s) => userKey(s.name) === uKey);
      if (existingIdx >= 0) slRank.splice(existingIdx, 1);
      slRank.push({ name: user.name, score: newTotal, date: new Date().toISOString() });
      slRank.sort((a, b) => b.score - a.score);
      if (slRank.length > 50) slRank.length = 50;
      await kv.set("gamerank:slot", slRank);
    }
    if (coinsLost > 0) {
      const lostKey = `slotlost:${uKey}`;
      await kv.set(lostKey, parseRedisNumber(await kv.get(lostKey)) + coinsLost);
    }

    const spinsKey = `slotspins:${uKey}`;
    await kv.set(spinsKey, parseRedisNumber(await kv.get(spinsKey)) + 1);

    // ─── Conquistas ─────────────────────────────────────────────────────────
    const newAchievements = [];
    const streakKey = `sl_streak:${uKey}`;

    if (outcome === "win") {
      const newStreak = parseRedisNumber(await kv.get(streakKey)) + 1;
      await kv.set(streakKey, newStreak);

      if (await unlockAchievement(kv, user.name, "sl_first_win")) newAchievements.push("sl_first_win");
      if (reels[0] === "clock" && await unlockAchievement(kv, user.name, "sl_jackpot")) newAchievements.push("sl_jackpot");
      if (betAmount === "high" && await unlockAchievement(kv, user.name, "sl_high_roller")) newAchievements.push("sl_high_roller");
      if (newStreak >= 3 && await unlockAchievement(kv, user.name, "sl_streak_3")) newAchievements.push("sl_streak_3");
    } else {
      await kv.del(streakKey);
    }

    const history = await pushSlHistory(kv, { reels, outcome });
    const newBalance = Math.max(0, balance + coinsWon - coinsLost);

    res.json({
      reels,
      outcome,
      coinsWon,
      coinsLost,
      balance: newBalance,
      history,
      newAchievements,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseSlLock(kv, uKey);
  }
});

// ─── GET /api/slot/rank ──────────────────────────────────────────────────────
router.get("/slot/rank", async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const entries = [];
    for (const user of users) {
      const uKey = userKey(user.name);
      const coinsWon = parseRedisNumber(await kv.get(`slotwon:${uKey}`));
      if (coinsWon <= 0) continue;
      const spinsPlayed = parseRedisNumber(await kv.get(`slotspins:${uKey}`));
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
// unitário direto — ver test/routes/slot.test.js.
module.exports.SYMBOLS = SYMBOLS;
module.exports.spinReel = spinReel;
module.exports.symbolPayout = symbolPayout;
module.exports.resolveSpin = resolveSpin;
