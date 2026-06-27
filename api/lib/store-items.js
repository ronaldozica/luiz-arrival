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
// Sem limite de quantidade; cada emoji novo custa 125 LuizCoins mais que o anterior.
const EMOJI_BASE_PRICE = 125;
const EMOJI_PRICE_STEP = 125;
function emojiPriceForCount(ownedCount) {
  return EMOJI_BASE_PRICE + EMOJI_PRICE_STEP * ownedCount;
}
// Aceita um único emoji (incluindo sequências com ZWJ/seletor de variação/modificador de tom de pele) ou uma bandeira (par de Regional Indicator).
const ZWJ = "‍";
const VS16 = "️";
const EMOJI_REGEX = new RegExp(
  "^(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?(?:" + ZWJ + "\\p{Extended_Pictographic}" + VS16 + "?\\p{Emoji_Modifier}?)*)$",
  "u"
);

// ─── Pontuação das apostas (ver lib/rankings.js para o ranking agregado) ────
// Recompensa é baseada na precisão ABSOLUTA do palpite (distância em minutos
// até a chegada real), não na posição relativa aos outros apostadores do dia.
// Isso evita que dias com poucos participantes "infle" artificialmente o
// prêmio de quem só acertou por falta de concorrência. Apostas marcadas como
// `invalidated` (feitas a menos de 30min da chegada real — ver admin.js) só
// recebem a moeda de participação, igual a um palpite muito impreciso.
const PRECISION_BANDS = [
  { maxDiff: 0, coins: 30 },
  { maxDiff: 2, coins: 20 },
  { maxDiff: 5, coins: 10 },
  { maxDiff: 10, coins: 5 },
];
const PARTICIPATION_COINS = 1;

// Dias resolvidos antes desta mudança não têm o campo `invalidated` (era um
// formato antigo, sem checagem de sniping) — usar isso como sinal de "registro
// legado" é mais robusto que uma data de corte fixa, porque continua correto
// mesmo se o admin resolver chegadas em atraso. Esses dias mantêm a fórmula
// antiga (por posição) para não alterar retroativamente o saldo de LuizCoins
// de apostas já fechadas.
function legacyCoinsForGuess(r) {
  let bonus = 0;
  if (r.position === 1) bonus = 25;
  else if (r.position === 2) bonus = 10;
  else if (r.position === 3) bonus = 5;
  return bonus + PARTICIPATION_COINS;
}

function coinsForGuess(rankingEntry) {
  if (!rankingEntry) return PARTICIPATION_COINS;
  if (rankingEntry.invalidated === undefined) return legacyCoinsForGuess(rankingEntry);
  if (rankingEntry.invalidated) return PARTICIPATION_COINS;
  const band = PRECISION_BANDS.find((b) => rankingEntry.diff <= b.maxDiff);
  return band ? band.coins : PARTICIPATION_COINS;
}

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
    if (userRank) earnedCoins += coinsForGuess(userRank);

    if (isUserHCM) {
      const hcmRanks = day.rankings.filter(
        (r) => hcmNames.has(userKey(r.name)) && r.position !== null && r.position !== undefined,
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
  for (let i = 0; i < emojiOwned.length; i++) spentCoins += emojiPriceForCount(i);

  return { earnedCoins, spentCoins, purchases, gameCoins, emojiOwned };
}

module.exports = { STORE_ITEMS, EMOJI_BASE_PRICE, EMOJI_PRICE_STEP, emojiPriceForCount, EMOJI_REGEX, PRECISION_BANDS, PARTICIPATION_COINS, coinsForGuess, calcBalance };
