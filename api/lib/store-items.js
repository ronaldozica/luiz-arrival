const { userKey, parseRedisNumber, parseRedisArray } = require("./utils");
const { isWeekday } = require("./datetime");
const { getDayData } = require("./days");

// ─── Loja de Prêmios ─────────────────────────────────────────────────────────
const STORE_ITEMS = [
  { id: "palinha", price: 10, src: "/photos/palinha.gif", title: "Luiz dando uma palinha" },
  { id: "baixista", price: 10, src: "/photos/baixista.gif", title: "Luiz Fernando baixista" },
  { id: "confusp", price: 25, src: "/photos/confuso.gif", title: "Luiz confuso" },
  { id: "color_esmeralda", price: 100, type: "namecolor", color: "#00c853", title: "Esmeralda" },
  { id: "color_rubi", price: 250, type: "namecolor", color: "#e53935", title: "Rubi" },
  { id: "color_dourado", price: 1000, type: "namecolor", color: "#ffd600", title: "Dourada" },
  { id: "color_diamante", price: 10000, type: "namecolor", color: "#b3e5fc", title: "Diamante" },
];

// ─── Emoji de ranking (compra livre, não é um item fixo da loja) ────────────
const EMOJI_PRICE = 500;
const EMOJI_MAX_OWNED = 3;
// Aceita um único emoji (incluindo sequências com ZWJ/seletor de variação/modificador de tom de pele) ou uma bandeira (par de Regional Indicator).
const ZWJ = "‍";
const VS16 = "️";
const EMOJI_REGEX = new RegExp(
  "^(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?(?:" + ZWJ + "\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?)*)$",
  "u"
);

async function calcBalance(kv, user, users) {
  const hcmNames = new Set(
    users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
  );
  const isUserHCM = hcmNames.has(userKey(user.name));

  let index = (await kv.get("days_index")) || [];
  let earnedCoins = 0;

  for (const dateKey of index) {
    if (!isWeekday(dateKey)) continue;
    const day = await getDayData(kv, dateKey);
    if (!day.arrival || !day.rankings) continue;
    const userRank = day.rankings.find(
      (r) => userKey(r.name) === userKey(user.name),
    );
    if (userRank) {
      if (userRank.position === 1) earnedCoins += 25;
      else if (userRank.position === 2) earnedCoins += 10;
      else if (userRank.position === 3) earnedCoins += 5;
      earnedCoins += 1;
    }
    if (isUserHCM) {
      const hcmRanks = day.rankings.filter((r) =>
        hcmNames.has(userKey(r.name)),
      );
      if (hcmRanks.length > 0) {
        const topHcmPos = hcmRanks[0].position;
        const isTopHcm = hcmRanks.some(
          (r) =>
            r.position === topHcmPos &&
            userKey(r.name) === userKey(user.name),
        );
        if (isTopHcm && userRank) earnedCoins += 5;
      }
    }
  }

  const gameCoinsKey = `gamecoins:${userKey(user.name)}`;
  const gameCoins = parseRedisNumber(await kv.get(gameCoinsKey));
  earnedCoins += gameCoins;

  const purchasesKey = `purchases:${userKey(user.name)}`;
  const purchases = parseRedisArray(await kv.get(purchasesKey));
  let spentCoins = 0;
  purchases.forEach((id) => {
    const item = STORE_ITEMS.find((i) => i.id === id);
    if (item) spentCoins += item.price;
  });

  const emojiOwnedKey = `emoji_owned:${userKey(user.name)}`;
  const emojiOwned = parseRedisArray(await kv.get(emojiOwnedKey));
  spentCoins += emojiOwned.length * EMOJI_PRICE;

  return { earnedCoins, spentCoins, purchases, gameCoins, emojiOwned };
}

module.exports = { STORE_ITEMS, EMOJI_PRICE, EMOJI_MAX_OWNED, EMOJI_REGEX, calcBalance };
