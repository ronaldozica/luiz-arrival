const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { requireAuth } = require("../lib/auth-middleware");
const { invalidatesCache } = require("../lib/cache");
const { getUsers } = require("../lib/users");
const { userKey, parseRedisArray } = require("../lib/utils");
const { STORE_ITEMS, EXCLUSIVE_COLORS, getExclusiveColorIds, calcBalance } = require("../lib/store-items");

// GET /api/store — requer sessão válida
router.get("/store", requireAuth, async (req, res) => {
  try {
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const { earnedCoins, spentCoins, purchases, gameCoins } = await calcBalance(kv, user, users);

    const responseItems = STORE_ITEMS.map((item) => {
      const isUnlocked = purchases.includes(item.id);
      const base = { id: item.id, title: item.title, price: item.price, type: item.type || "media" };
      if (item.type === "namecolor") {
        return { ...base, color: item.color, description: item.description };
      }
      return { ...base, src: isUnlocked ? item.src : null, ...(item.wpKey ? { wpKey: item.wpKey } : {}) };
    });

    const activeColorId = (await kv.get(`color_active:${userKey(user.name)}`)) || null;

    // Cores exclusivas (ex.: "Coração") não entram em STORE_ITEMS — não são
    // compráveis e não devem aparecer na vitrine da loja. Mas se o jogador
    // já foi contemplado com uma, ela precisa aparecer como opção no
    // seletor de cor do Perfil — daí o campo separado abaixo.
    const exclusiveColors = EXCLUSIVE_COLORS.filter((c) =>
      getExclusiveColorIds(user.name).includes(c.id),
    ).map((c) => ({ id: c.id, title: c.title, color: c.color, type: "namecolor" }));

    res.json({
      balance: Math.max(0, earnedCoins - spentCoins),
      coinsFromGames: gameCoins,
      spentCoins,
      purchases,
      items: responseItems,
      exclusiveColors,
      activeColorId,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/store/buy — requer sessão válida
router.post("/store/buy", requireAuth, invalidatesCache("cache:profiles"), async (req, res) => {
  try {
    const { itemId } = req.body;
    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(req.sessionName));
    if (!user) return res.status(401).json({ error: "Acesso negado." });

    const item = STORE_ITEMS.find((i) => i.id === itemId);
    if (!item) return res.status(404).json({ error: "Item não encontrado." });

    const { earnedCoins, spentCoins, purchases } = await calcBalance(kv, user, users);

    if (purchases.includes(itemId))
      return res.status(400).json({ error: "Você já possui este item." });

    const balance = earnedCoins - spentCoins;
    if (balance < item.price)
      return res.status(400).json({ error: "LuizCoins™ insuficientes." });

    // Grava o preço pago junto com o id — se o preço do item mudar depois,
    // essa compra já feita não é afetada (ver lib/store-items.js).
    const purchasesKey = `purchases:${userKey(user.name)}`;
    const rawPurchases = parseRedisArray(await kv.get(purchasesKey));
    rawPurchases.push({ id: itemId, pricePaid: item.price });
    await kv.set(purchasesKey, JSON.stringify(rawPurchases));

    res.json({ success: true, newBalance: balance - item.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
