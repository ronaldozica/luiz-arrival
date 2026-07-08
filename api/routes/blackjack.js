const express = require("express");
const router = express.Router();
const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisNumber } = require("../lib/utils");
const { calcBalance } = require("../lib/store-items");
const { todayKey } = require("../lib/datetime");

const BJ_DAILY_CAP = 100;
const BET_AMOUNTS = { low: 5, medium: 15, high: 30 };

const SUITS = ["♠", "♥", "♦", "♣"];
const VALUES = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const value of VALUES)
      deck.push({ suit, value });
  // Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card) {
  if (["J", "Q", "K"].includes(card.value)) return 10;
  if (card.value === "A") return 11;
  return parseInt(card.value, 10);
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.value === "A") aces++;
    total += cardValue(card);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function isNaturalBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

async function getUserAndBalance(kv, sessionName) {
  const users = await getUsers(kv);
  const user = users.find((u) => userKey(u.name) === userKey(sessionName));
  if (!user) return { user: null, balance: 0, users: [] };
  const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
  return { user, balance: Math.max(0, earnedCoins - spentCoins), users };
}

async function acquireBjLock(kv, uKey) {
  const result = await kv.set(`bjlock:${uKey}`, "1", { nx: true, ex: 15 });
  return result !== null;
}
async function releaseBjLock(kv, uKey) {
  await kv.del(`bjlock:${uKey}`);
}

// ─── GET /api/blackjack/status ────────────────────────────────────────────────
router.get("/blackjack/status", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const { user, balance } = await getUserAndBalance(kv, req.sessionName);
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const uKey = userKey(user.name);
    const dKey = `bjdaily:${uKey}:${todayKey()}`;
    const dailyEarned = parseRedisNumber(await kv.get(dKey));

    const gameRaw = await kv.get(`bj_game:${uKey}`);
    let activeGame = null;
    if (gameRaw) {
      const g = typeof gameRaw === "string" ? JSON.parse(gameRaw) : gameRaw;
      activeGame = {
        playerHand: g.playerHand,
        dealerVisible: [g.dealerHand[0]],
        playerValue: handValue(g.playerHand),
        bet: g.bet,
        betLevel: g.betLevel,
      };
    }

    res.json({
      balance,
      dailyEarned,
      dailyCap: BJ_DAILY_CAP,
      blocked: dailyEarned >= BJ_DAILY_CAP,
      activeGame,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/blackjack/start ────────────────────────────────────────────────
router.post("/blackjack/start", requireAuth, async (req, res) => {
  const { betLevel } = req.body;
  const bet = BET_AMOUNTS[betLevel];
  if (!bet) return res.status(400).json({ error: "Nível de aposta inválido." });

  const kv = getKV();
  const { user, balance, users } = await getUserAndBalance(kv, req.sessionName);
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!(await acquireBjLock(kv, uKey)))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const existingGame = await kv.get(`bj_game:${uKey}`);
    if (existingGame) return res.status(400).json({ error: "Você já tem uma partida em andamento." });

    const dKey = `bjdaily:${uKey}:${todayKey()}`;
    const dailyEarned = parseRedisNumber(await kv.get(dKey));
    if (dailyEarned >= BJ_DAILY_CAP)
      return res.status(400).json({ error: "Limite diário de ganhos atingido. Volte amanhã!" });

    if (balance < bet) return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const deck = makeDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];
    const game = { playerHand, dealerHand, deck, bet, betLevel };

    const playerBJ = isNaturalBlackjack(playerHand);
    const dealerBJ = isNaturalBlackjack(dealerHand);

    if (playerBJ || dealerBJ) {
      // Resolve immediately — no need to save game state
      return await resolveHand(kv, user, users, uKey, game, dKey, dailyEarned, res, playerBJ, dealerBJ);
    }

    await kv.set(`bj_game:${uKey}`, JSON.stringify(game), { ex: 10 * 60 });

    res.json({
      status: "playing",
      playerHand,
      dealerVisible: [dealerHand[0]],
      playerValue: handValue(playerHand),
      bet,
      betLevel,
      balance,
      dailyEarned,
      dailyCap: BJ_DAILY_CAP,
    });
  } finally {
    await releaseBjLock(kv, uKey);
  }
});

// ─── POST /api/blackjack/action ───────────────────────────────────────────────
router.post("/blackjack/action", requireAuth, async (req, res) => {
  const { action } = req.body;
  if (!["hit", "stand"].includes(action))
    return res.status(400).json({ error: "Ação inválida." });

  const kv = getKV();
  const { user, users } = await getUserAndBalance(kv, req.sessionName);
  if (!user) return res.status(401).json({ error: "Acesso negado." });

  const uKey = userKey(user.name);
  if (!(await acquireBjLock(kv, uKey)))
    return res.status(429).json({ error: "Operação em andamento. Tente novamente." });

  try {
    const gameRaw = await kv.get(`bj_game:${uKey}`);
    if (!gameRaw) return res.status(400).json({ error: "Nenhuma partida ativa." });
    const game = typeof gameRaw === "string" ? JSON.parse(gameRaw) : gameRaw;

    const dKey = `bjdaily:${uKey}:${todayKey()}`;
    const dailyEarned = parseRedisNumber(await kv.get(dKey));

    if (action === "hit") {
      game.playerHand.push(game.deck.pop());
      const pv = handValue(game.playerHand);

      if (pv > 21) {
        // Bust — resolve without dealer drawing
        return await resolveHand(kv, user, users, uKey, game, dKey, dailyEarned, res, false, false, "bust");
      }
      if (pv === 21) {
        // Auto-stand on 21
        return await resolveHand(kv, user, users, uKey, game, dKey, dailyEarned, res, false, false, "stand");
      }

      await kv.set(`bj_game:${uKey}`, JSON.stringify(game), { ex: 10 * 60 });
      const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
      return res.json({
        status: "playing",
        playerHand: game.playerHand,
        dealerVisible: [game.dealerHand[0]],
        playerValue: pv,
        bet: game.bet,
        betLevel: game.betLevel,
        balance: Math.max(0, earnedCoins - spentCoins),
        dailyEarned,
        dailyCap: BJ_DAILY_CAP,
      });
    }

    // stand
    return await resolveHand(kv, user, users, uKey, game, dKey, dailyEarned, res, false, false, "stand");
  } finally {
    await releaseBjLock(kv, uKey);
  }
});

async function resolveHand(kv, user, users, uKey, game, dKey, dailyEarned, res, playerBJ, dealerBJ, trigger) {
  const { playerHand, dealerHand, deck, bet } = game;

  // Dealer draws to 17+ (only when player didn't bust and no natural)
  if (trigger !== "bust" && !playerBJ) {
    while (handValue(dealerHand) < 17) {
      dealerHand.push(deck.pop());
    }
  }

  const pv = handValue(playerHand);
  const dv = handValue(dealerHand);

  let outcome; // "blackjack" | "win" | "push" | "lose" | "bust"
  let coinsWon = 0;
  let coinsLost = 0;

  if (trigger === "bust") {
    outcome = "bust";
    coinsLost = bet;
  } else if (playerBJ && dealerBJ) {
    outcome = "push";
  } else if (playerBJ) {
    outcome = "blackjack";
    coinsWon = Math.floor(bet * 1.5);
  } else if (dealerBJ) {
    outcome = "lose";
    coinsLost = bet;
  } else if (dv > 21 || pv > dv) {
    outcome = "win";
    coinsWon = bet;
  } else if (pv < dv) {
    outcome = "lose";
    coinsLost = bet;
  } else {
    outcome = "push";
  }

  // Apply daily cap
  if (coinsWon > 0) {
    coinsWon = Math.min(coinsWon, Math.max(0, BJ_DAILY_CAP - dailyEarned));
  }

  if (coinsWon > 0) {
    const wonKey = `bjwon:${uKey}`;
    await kv.set(wonKey, parseRedisNumber(await kv.get(wonKey)) + coinsWon);
    await kv.set(dKey, dailyEarned + coinsWon, { ex: 2 * 24 * 60 * 60 });
  }
  if (coinsLost > 0) {
    const lostKey = `bjlost:${uKey}`;
    await kv.set(lostKey, parseRedisNumber(await kv.get(lostKey)) + coinsLost);
  }

  await kv.del(`bj_game:${uKey}`);

  const { earnedCoins, spentCoins } = await calcBalance(kv, user, users);
  const newDailyEarned = dailyEarned + coinsWon;

  res.json({
    status: "done",
    playerHand,
    dealerHand,
    playerValue: pv,
    dealerValue: dv,
    outcome,
    coinsWon,
    coinsLost,
    newBalance: Math.max(0, earnedCoins - spentCoins),
    dailyEarned: newDailyEarned,
    dailyCap: BJ_DAILY_CAP,
    blocked: newDailyEarned >= BJ_DAILY_CAP,
  });
}

module.exports = router;
