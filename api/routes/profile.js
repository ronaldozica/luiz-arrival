const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache, invalidatesUserBalance, getCachedOrCompute } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray } = require("../lib/utils");
const {
  emojiPriceForCount, EMOJI_REGEX, getCachedBalance, purchaseIds, emojiList,
  getExclusiveColorIds, findNameColorItem, findEmojiFrameItem,
  FONTS, FONT_IDS, fontPriceForCount, fontList,
  TITLES, TITLE_IDS, titlePriceForCount, titleList,
} = require("../lib/store-items");
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
      const purchases = purchaseIds(parseRedisArray(await kv.get(purchasesKey)));
      const ownedColorIds = [...purchases, ...getExclusiveColorIds(user.name)];
      const item = findNameColorItem(colorId);
      if (!item || !ownedColorIds.includes(colorId))
        return res.status(400).json({ error: "Você não possui essa cor." });
      await kv.set(activeKey, colorId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/frame — define qual moldura de emoji (já comprada) é exibida no ranking
router.post("/profile/frame", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { frameId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const activeKey = `frame_active:${userKey(user.name)}`;
    if (!frameId) {
      await kv.del(activeKey);
    } else {
      const purchasesKey = `purchases:${userKey(user.name)}`;
      const purchases = purchaseIds(parseRedisArray(await kv.get(purchasesKey)));
      const item = findEmojiFrameItem(frameId);
      if (!item || !purchases.includes(frameId))
        return res.status(400).json({ error: "Você não possui essa moldura." });
      await kv.set(activeKey, frameId);
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
    const rawOwned = parseRedisArray(await kv.get(`emoji_owned:${uk}`));
    const owned = emojiList(rawOwned);
    const active = (await kv.get(`emoji_active:${uk}`)) || null;
    res.json({ owned, active, nextPrice: emojiPriceForCount(owned.length) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/emoji/buy — compra um emoji novo (qualquer emoji válido)
router.post("/profile/emoji/buy", requireAuth, invalidatesCache("cache:profiles"), invalidatesUserBalance(), async (req, res) => {
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
    const { earnedCoins, spentCoins, emojiOwned } = await getCachedBalance(kv, user, users);

    if (emojiOwned.includes(emoji))
      return res.status(400).json({ error: "Você já possui este emoji." });

    const balance = earnedCoins - spentCoins;
    const price = emojiPriceForCount(emojiOwned.length);
    if (balance < price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    // Grava o preço pago junto com o emoji — se a fórmula de preço mudar
    // depois, essa compra já feita não é afetada (ver lib/store-items.js).
    const rawOwned = parseRedisArray(await kv.get(ownedKey));
    rawOwned.push({ emoji, pricePaid: price });
    await kv.set(ownedKey, JSON.stringify(rawOwned));
    if (rawOwned.length === 1) {
      await kv.set(`emoji_active:${uk}`, emoji);
    }

    res.json({
      success: true,
      owned: emojiList(rawOwned),
      newBalance: balance - price,
      pricePaid: price,
      nextPrice: emojiPriceForCount(rawOwned.length),
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
      const owned = emojiList(parseRedisArray(await kv.get(`emoji_owned:${uk}`)));
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
        const purchases = purchaseIds(parseRedisArray(await kv.get(purchasesKey)));
        const ownedColorIds = [...purchases, ...getExclusiveColorIds(u.name)];

        let activeColor = null;
        const chosenColorId = await kv.get(`color_active:${uk}`);
        if (chosenColorId && ownedColorIds.includes(chosenColorId)) {
          const item = findNameColorItem(chosenColorId);
          if (item) activeColor = { id: chosenColorId, color: item.color, title: item.title };
        }
        if (!activeColor) {
          // Sem escolha explícita: usa a cor de maior prestígio que o jogador possui.
          // "Coração" é exclusiva e fica acima até do Diamante.
          const colorPriority = [
            "color_coracao", "color_rainbow", "color_neon", "color_gelo", "color_cosmico",
            "color_diamante", "color_dourado", "color_rubi", "color_esmeralda",
          ];
          for (const cid of colorPriority) {
            if (ownedColorIds.includes(cid)) {
              const item = findNameColorItem(cid);
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
        const activeFont = (await kv.get(`font_active:${uk}`)) || null;

        let activeFrame = null;
        const chosenFrameId = await kv.get(`frame_active:${uk}`);
        if (chosenFrameId && purchases.includes(chosenFrameId)) {
          const frameItem = findEmojiFrameItem(chosenFrameId);
          if (frameItem) activeFrame = { id: chosenFrameId, frameClass: frameItem.frameClass };
        }

        let activeTitle = null;
        const chosenTitleId = await kv.get(`title_active:${uk}`);
        if (chosenTitleId) {
          const titleDef = TITLES.find((t) => t.id === chosenTitleId);
          const ownedTitles = titleList(parseRedisArray(await kv.get(`title_owned:${uk}`)));
          if (titleDef && ownedTitles.includes(chosenTitleId)) {
            activeTitle = { id: titleDef.id, label: titleDef.label };
          }
        }

        computed[u.name] = {
          nameColor: activeColor, achievement: activeAchievement, emoji: activeEmoji,
          font: activeFont, emojiFrame: activeFrame, title: activeTitle,
        };
      }

      return computed;
    });

    res.json(profiles);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Fontes de ranking ────────────────────────────────────────────────────────

// GET /api/profile/font — fontes compradas, fonte ativa, próximo preço e catálogo
router.get("/profile/font", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const rawOwned = parseRedisArray(await kv.get(`font_owned:${uk}`));
    const owned = fontList(rawOwned);
    const active = (await kv.get(`font_active:${uk}`)) || null;
    res.json({ owned, active, nextPrice: fontPriceForCount(owned.length), catalog: FONTS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/font/buy — compra uma fonte do catálogo
router.post("/profile/font/buy", requireAuth, invalidatesCache("cache:profiles"), invalidatesUserBalance(), async (req, res) => {
  try {
    const { fontId } = req.body;
    if (!fontId || !FONT_IDS.has(fontId))
      return res.status(400).json({ error: "Fonte inválida." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const uk = userKey(user.name);
    const ownedKey = `font_owned:${uk}`;
    // rawFontOwned vem do mesmo calcBalance que calculou o saldo —
    // evita TOCTOU de ler font_owned duas vezes com operações async no meio.
    const { earnedCoins, spentCoins, fontOwned, rawFontOwned } = await getCachedBalance(kv, user, users);

    if (fontOwned.includes(fontId))
      return res.status(400).json({ error: "Você já possui esta fonte." });

    const balance = earnedCoins - spentCoins;
    const price = fontPriceForCount(fontOwned.length);
    if (balance < price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const rawOwned = [...rawFontOwned, { fontId, pricePaid: price }];
    await kv.set(ownedKey, JSON.stringify(rawOwned));
    if (rawOwned.length === 1) {
      await kv.set(`font_active:${uk}`, fontId);
    }

    res.json({
      success: true,
      owned: fontList(rawOwned),
      newBalance: balance - price,
      pricePaid: price,
      nextPrice: fontPriceForCount(rawOwned.length),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/font/set-active — define qual fonte possuída é exibida no ranking
router.post("/profile/font/set-active", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { fontId } = req.body;
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const activeKey = `font_active:${uk}`;

    if (!fontId) {
      await kv.del(activeKey);
    } else {
      const owned = fontList(parseRedisArray(await kv.get(`font_owned:${uk}`)));
      if (!owned.includes(fontId))
        return res.status(400).json({ error: "Você não possui esta fonte." });
      await kv.set(activeKey, fontId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Títulos ao lado do nome ──────────────────────────────────────────────────

// GET /api/profile/title — títulos comprados, título ativo, próximo preço e catálogo
router.get("/profile/title", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const rawOwned = parseRedisArray(await kv.get(`title_owned:${uk}`));
    const owned = titleList(rawOwned);
    const active = (await kv.get(`title_active:${uk}`)) || null;
    res.json({ owned, active, nextPrice: titlePriceForCount(owned.length), catalog: TITLES });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/title/buy — compra um título do catálogo
router.post("/profile/title/buy", requireAuth, invalidatesCache("cache:profiles"), invalidatesUserBalance(), async (req, res) => {
  try {
    const { titleId } = req.body;
    if (!titleId || !TITLE_IDS.has(titleId))
      return res.status(400).json({ error: "Título inválido." });

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const uk = userKey(user.name);
    const ownedKey = `title_owned:${uk}`;
    // rawTitleOwned vem do mesmo calcBalance que calculou o saldo —
    // evita TOCTOU de ler title_owned duas vezes com operações async no meio.
    const { earnedCoins, spentCoins, titleOwned, rawTitleOwned } = await getCachedBalance(kv, user, users);

    if (titleOwned.includes(titleId))
      return res.status(400).json({ error: "Você já possui este título." });

    const balance = earnedCoins - spentCoins;
    const price = titlePriceForCount(titleOwned.length);
    if (balance < price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    const rawOwned = [...rawTitleOwned, { titleId, pricePaid: price }];
    await kv.set(ownedKey, JSON.stringify(rawOwned));
    if (rawOwned.length === 1) {
      await kv.set(`title_active:${uk}`, titleId);
    }

    res.json({
      success: true,
      owned: titleList(rawOwned),
      newBalance: balance - price,
      pricePaid: price,
      nextPrice: titlePriceForCount(rawOwned.length),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/profile/title/set-active — define qual título possuído é exibido no ranking
router.post("/profile/title/set-active", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { titleId } = req.body;
    const kv = getKV();
    const uk = userKey(req.sessionName);
    const activeKey = `title_active:${uk}`;

    if (!titleId) {
      await kv.del(activeKey);
    } else {
      const owned = titleList(parseRedisArray(await kv.get(`title_owned:${uk}`)));
      if (!owned.includes(titleId))
        return res.status(400).json({ error: "Você não possui este título." });
      await kv.set(activeKey, titleId);
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
