const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache, getCachedOrCompute } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray } = require("../lib/utils");
const { STORE_ITEMS, EMOJI_BASE_PRICE, emojiPriceForCount, EMOJI_REGEX, calcBalance } = require("../lib/store-items");
const { ACHIEVEMENT_DEFS } = require("../lib/achievement-defs");

// POST /api/profile/color — define qual cor de nome (já comprada) é exibida no ranking
router.post("/profile/color", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { colorId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `color_active:${userKey(user.name)}`;
    if (!colorId) {
      await kv.del(activeKey);
    } else {
      const purchasesKey = `purchases:${userKey(user.name)}`;
      const purchases = parseRedisArray(await kv.get(purchasesKey));
      const item = STORE_ITEMS.find((i) => i.id === colorId && i.type === "namecolor");
      if (!item || !purchases.includes(colorId))
        return res.status(400).json({ error: "Você não possui essa cor." });
      await kv.set(activeKey, colorId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Emoji de ranking ────────────────────────────────────────────────────────
// GET /api/profile/emoji — emojis comprados, emoji ativo, preço e limite
router.get("/profile/emoji", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const owned = parseRedisArray(await kv.get(`emoji_owned:${uk}`));
    const active = (await kv.get(`emoji_active:${uk}`)) || null;
    res.json({ owned, active, nextPrice: emojiPriceForCount(owned.length) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/buy — compra um emoji novo (qualquer emoji válido) por 500 LuizCoins
router.post("/profile/emoji/buy", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!emoji || typeof emoji !== "string" || !EMOJI_REGEX.test(emoji)) {
      return res.status(400).json({ error: "Emoji inválido." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const uk = userKey(user.name);
    const ownedKey = `emoji_owned:${uk}`;
    const { earnedCoins, spentCoins, emojiOwned } = await calcBalance(kv, user, users);

    if (emojiOwned.includes(emoji))
      return res.status(400).json({ error: "Você já possui este emoji." });

    const balance = earnedCoins - spentCoins;
    const price = emojiPriceForCount(emojiOwned.length);
    if (balance < price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const newOwned = [...emojiOwned, emoji];
    await kv.set(ownedKey, JSON.stringify(newOwned));
    if (newOwned.length === 1) {
      await kv.set(`emoji_active:${uk}`, emoji);
    }

    res.json({
      success: true,
      owned: newOwned,
      newBalance: balance - price,
      pricePaid: price,
      nextPrice: emojiPriceForCount(newOwned.length),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/set-active — define qual emoji possuído é exibido no ranking
router.post("/profile/emoji/set-active", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { emoji } = req.body;
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const activeKey = `emoji_active:${uk}`;

    if (!emoji) {
      await kv.del(activeKey);
    } else {
      const owned = parseRedisArray(await kv.get(`emoji_owned:${uk}`));
      if (!owned.includes(emoji))
        return res.status(400).json({ error: "Você não possui esse emoji." });
      await kv.set(activeKey, emoji);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/profiles — público
router.get("/profiles", async (req, res) => {
  try {
    const kv = getKV();
    const profiles = await getCachedOrCompute(kv, "cache:profiles", async () => {
      const users = await getUsers(kv);
      const computed = {};

      for (const u of users) {
        const uk = userKey(u.name);
        const purchasesKey = `purchases:${uk}`;
        const purchases = parseRedisArray(await kv.get(purchasesKey));

        let activeColor = null;
        const chosenColorId = await kv.get(`color_active:${uk}`);
        if (chosenColorId && purchases.includes(chosenColorId)) {
          const item = STORE_ITEMS.find((i) => i.id === chosenColorId && i.type === "namecolor");
          if (item) activeColor = { id: chosenColorId, color: item.color, title: item.title };
        }
        if (!activeColor) {
          // Sem escolha explícita: usa a cor de maior prestígio que o jogador possui.
          const colorPriority = ["color_diamante", "color_dourado", "color_rubi", "color_esmeralda"];
          for (const cid of colorPriority) {
            if (purchases.includes(cid)) {
              const item = STORE_ITEMS.find((i) => i.id === cid);
              if (item) {
                activeColor = { id: cid, color: item.color, title: item.title };
                break;
              }
            }
          }
        }

        let activeAchievement = null;
        try {
          const activeAchId = await kv.get(`achievement_active:${uk}`);
          if (activeAchId) {
            const def = ACHIEVEMENT_DEFS.find((a) => a.id === activeAchId);
            if (def) activeAchievement = { id: def.id, icon: def.icon, title: def.title };
          }
        } catch {}

        const activeEmoji = (await kv.get(`emoji_active:${uk}`)) || null;

        computed[u.name] = { nameColor: activeColor, achievement: activeAchievement, emoji: activeEmoji };
      }

      return computed;
    });

    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
