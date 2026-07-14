const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber } = require("../lib/utils");
const { calcBalance } = require("../lib/store-items");

const FARM_SEEDS = {
  corn:       { cost: 8,   growthMs: 2  * 3600000, reward: 14  },
  tomato:     { cost: 20,  growthMs: 6  * 3600000, reward: 38  },
  pumpkin:    { cost: 45,  growthMs: 24 * 3600000, reward: 90  },
  grape:      { cost: 90,  growthMs: 48 * 3600000, reward: 190 },
  strawberry: { cost: 12,  growthMs: 1  * 3600000, reward: 22,  premium: true },
  orange:     { cost: 30,  growthMs: 12 * 3600000, reward: 68,  premium: true },
  pineapple:  { cost: 100, growthMs: 72 * 3600000, reward: 330, premium: true },
};

// Primeiras 3 parcelas desbloqueadas desde o início; resto exige compra.
const PLOT_UNLOCK_COSTS = [0, 0, 0, 50, 50, 50, 150, 150, 150];
const TOTAL_PLOTS = 9;

function defaultFarm() {
  return Array.from({ length: TOTAL_PLOTS }, (_, i) =>
    i < 3 ? null : { locked: true, cost: PLOT_UNLOCK_COSTS[i] }
  );
}

async function getFarmPlots(kv, uKey) {
  const raw = await kv.get(`farm:${uKey}`);
  if (!raw) return defaultFarm();
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length === TOTAL_PLOTS) return parsed;
  } catch {}
  return defaultFarm();
}

async function getUserBalance(kv, user, users) {
  const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
  return Math.max(0, earnedCoins - spentCoins);
}

// Mutex atômico: impede que duas requisições simultâneas do mesmo usuário
// passem pela checagem de saldo ao mesmo tempo (TOCTOU race condition).
async function acquireFarmLock(kv, uKey) {
  const result = await kv.set(`farmlock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}

async function releaseFarmLock(kv, uKey) {
  await kv.del(`farmlock:${uKey}`);
}

router.get("/farm", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });
    const plots = await getFarmPlots(kv, userKey(user.name));
    const { earnedCoins, spentCoins, purchases } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    const ownedSeeds = Object.keys(FARM_SEEDS).filter(
      (key) => FARM_SEEDS[key].premium && purchases.includes(`farmseed_${key}`)
    );
    res.json({ plots, balance, ownedSeeds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/farm/plant", requireAuth, async (req, res) => {
  const { plotId, seedType } = req.body;
  const seed = FARM_SEEDS[seedType];
  if (!seed) return res.status(400).json({ error: "Semente inválida." });
  if (typeof plotId !== "number" || plotId < 0 || plotId >= TOTAL_PLOTS)
    return res.status(400).json({ error: "Parcela inválida." });

  const kv = getKV();
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!await acquireFarmLock(kv, uKey))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const plots = await getFarmPlots(kv, uKey);
    const plot = plots[plotId];

    if (plot && plot.locked) return res.status(400).json({ error: "Parcela bloqueada." });
    if (plot && plot.seedType) return res.status(400).json({ error: "Já tem uma planta aqui." });

    const { earnedCoins, spentCoins, purchases } = await calcBalance(kv, user, users);
    const balance = Math.max(0, earnedCoins - spentCoins);
    if (balance < seed.cost) return res.status(400).json({ error: "LuizCoins™ insuficientes." });
    if (seed.premium && !purchases.includes(`farmseed_${seedType}`))
      return res.status(403).json({ error: "Você não possui esta semente. Compre na loja!" });

    plots[plotId] = { seedType, plantedAt: Date.now() };

    const farmSpentKey = `farmspent:${uKey}`;
    const currentSpent = parseRedisNumber(await kv.get(farmSpentKey));
    await kv.set(farmSpentKey, currentSpent + seed.cost);
    await kv.set(`farm:${uKey}`, JSON.stringify(plots));

    res.json({ success: true, plots, newBalance: balance - seed.cost });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseFarmLock(kv, uKey);
  }
});

router.post("/farm/harvest", requireAuth, async (req, res) => {
  const { plotId } = req.body;
  if (typeof plotId !== "number" || plotId < 0 || plotId >= TOTAL_PLOTS)
    return res.status(400).json({ error: "Parcela inválida." });

  const kv = getKV();
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!await acquireFarmLock(kv, uKey))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const plots = await getFarmPlots(kv, uKey);
    const plot = plots[plotId];

    if (!plot || !plot.seedType) return res.status(400).json({ error: "Nada para colher aqui." });
    const seed = FARM_SEEDS[plot.seedType];
    if (!seed) return res.status(400).json({ error: "Semente inválida." });

    // plantedAt vem do Redis (servidor), não do cliente — impossível forjar.
    const elapsed = Date.now() - plot.plantedAt;
    if (elapsed < seed.growthMs) return res.status(400).json({ error: "A planta ainda não está pronta." });

    const withered  = elapsed >= seed.growthMs * 3;
    const degraded  = !withered && elapsed >= seed.growthMs * 2;
    const coinsEarned = withered ? 0 : degraded ? Math.round(seed.reward * 0.75) : seed.reward;

    plots[plotId] = null;

    if (coinsEarned > 0) {
      const farmCoinsKey = `farmcoins:${uKey}`;
      const current = parseRedisNumber(await kv.get(farmCoinsKey));
      await kv.set(farmCoinsKey, current + coinsEarned);
    }
    await kv.set(`farm:${uKey}`, JSON.stringify(plots));

    const balance = await getUserBalance(kv, user, users);
    res.json({ success: true, coinsEarned, withered, degraded, plots, newBalance: balance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseFarmLock(kv, uKey);
  }
});

router.post("/farm/unlock", requireAuth, async (req, res) => {
  const { plotId } = req.body;
  if (typeof plotId !== "number" || plotId < 0 || plotId >= TOTAL_PLOTS)
    return res.status(400).json({ error: "Parcela inválida." });

  const cost = PLOT_UNLOCK_COSTS[plotId];
  if (!cost) return res.status(400).json({ error: "Parcela não precisa ser desbloqueada." });

  const kv = getKV();
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!await acquireFarmLock(kv, uKey))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const plots = await getFarmPlots(kv, uKey);

    if (!plots[plotId] || !plots[plotId].locked)
      return res.status(400).json({ error: "Parcela já desbloqueada." });

    const balance = await getUserBalance(kv, user, users);
    if (balance < cost) return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    plots[plotId] = null;

    const farmSpentKey = `farmspent:${uKey}`;
    const currentSpent = parseRedisNumber(await kv.get(farmSpentKey));
    await kv.set(farmSpentKey, currentSpent + cost);
    await kv.set(`farm:${uKey}`, JSON.stringify(plots));

    res.json({ success: true, plots, newBalance: balance - cost });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseFarmLock(kv, uKey);
  }
});

router.post("/farm/plant-all", requireAuth, async (req, res) => {
  const { seedType } = req.body;
  const seed = FARM_SEEDS[seedType];
  if (!seed) return res.status(400).json({ error: "Semente inválida." });

  const kv = getKV();
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!await acquireFarmLock(kv, uKey))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const plots = await getFarmPlots(kv, uKey);
    const { earnedCoins, spentCoins, purchases } = await calcBalance(kv, user, users);
    let balance = Math.max(0, earnedCoins - spentCoins);

    if (seed.premium && !purchases.includes(`farmseed_${seedType}`))
      return res.status(403).json({ error: "Você não possui esta semente. Compre na loja!" });

    let totalCost = 0;
    let planted = 0;
    const now = Date.now();

    for (let i = 0; i < plots.length; i++) {
      const p = plots[i];
      if (p && (p.locked || p.seedType)) continue;
      if (balance < seed.cost) break;
      plots[i] = { seedType, plantedAt: now };
      balance -= seed.cost;
      totalCost += seed.cost;
      planted++;
    }

    if (planted > 0) {
      const farmSpentKey = `farmspent:${uKey}`;
      const currentSpent = parseRedisNumber(await kv.get(farmSpentKey));
      await kv.set(farmSpentKey, currentSpent + totalCost);
      await kv.set(`farm:${uKey}`, JSON.stringify(plots));
    }

    res.json({ success: true, plots, newBalance: balance, planted });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseFarmLock(kv, uKey);
  }
});

router.post("/farm/harvest-all", requireAuth, async (req, res) => {
  const kv = getKV();
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!await acquireFarmLock(kv, uKey))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const plots = await getFarmPlots(kv, uKey);
    const now = Date.now();
    let totalEarned = 0;
    let witheredCount = 0;
    let degradedCount = 0;
    let harvested = 0;

    for (let i = 0; i < plots.length; i++) {
      const plot = plots[i];
      if (!plot || !plot.seedType) continue;
      const seed = FARM_SEEDS[plot.seedType];
      if (!seed) continue;
      const elapsed = now - plot.plantedAt;
      if (elapsed < seed.growthMs) continue;

      const withered = elapsed >= seed.growthMs * 3;
      const degraded = !withered && elapsed >= seed.growthMs * 2;
      const coinsEarned = withered ? 0 : degraded ? Math.round(seed.reward * 0.75) : seed.reward;

      plots[i] = null;
      totalEarned += coinsEarned;
      harvested++;
      if (withered) witheredCount++;
      else if (degraded) degradedCount++;
    }

    if (harvested > 0 && totalEarned > 0) {
      const farmCoinsKey = `farmcoins:${uKey}`;
      const current = parseRedisNumber(await kv.get(farmCoinsKey));
      await kv.set(farmCoinsKey, current + totalEarned);
    }
    if (harvested > 0) {
      await kv.set(`farm:${uKey}`, JSON.stringify(plots));
    }

    const balance = await getUserBalance(kv, user, users);
    res.json({ success: true, plots, newBalance: balance, totalEarned, witheredCount, degradedCount, harvested });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    await releaseFarmLock(kv, uKey);
  }
});

module.exports = router;
