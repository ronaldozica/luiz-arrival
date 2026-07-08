const { userKey, parseRedisNumber, parseRedisArray } = require("./utils");
const { isWeekday } = require("./datetime");
const { getDayData } = require("./days");

// ─── Loja de Prêmios ─────────────────────────────────────────────────────────
// Preços calibrados pra ~6 LuizCoins/dia (jogador engajado apostando todo dia
// útil, sem contar minigame — ver GAME_COINS_DAILY_CAP em routes/game-rank.js
// pro teto que mantém esse canal na mesma ordem de grandeza). Alvos: gifs em
// poucos dias; esmeralda em até ~4 dias; rubi em menos de 2 semanas; dourado
// em menos de 1 mês; diamante (2,5x o dourado) em menos de 2 meses.
const STORE_ITEMS = [
  { id: "wp_luizbeatle", price: 50, type: "wallpaper", src: "/assets/wallpapers/luizBeatle.jpg", title: "LuizBeatle", wpKey: "luizbeatle" },
  { id: "wp_luizbliss",  price: 50, type: "wallpaper", src: "/assets/wallpapers/luizBliss.jpg",  title: "LuizBliss",  wpKey: "luizbliss"  },
  { id: "palinha", price: 15, src: "/photos/palinha.gif", title: "Luiz dando uma palinha" },
  { id: "baixista", price: 15, src: "/photos/baixista.gif", title: "Luiz Fernando baixista" },
  { id: "confusp", price: 20, src: "/photos/confuso.gif", title: "Luiz confuso" },
  { id: "color_esmeralda", price: 20, type: "namecolor", color: "#00c853", title: "Esmeralda" },
  { id: "color_safira", price: 35, type: "namecolor", color: "#1e88e5", title: "Safira" },
  { id: "color_rubi", price: 50, type: "namecolor", color: "#e53935", title: "Rubi" },
  { id: "color_ametista", price: 75, type: "namecolor", color: "#ab47bc", title: "Ametista" },
  { id: "color_dourado", price: 90, type: "namecolor", color: "#ffd600", title: "Dourada" },
  { id: "color_topazio", price: 150, type: "namecolor", color: "#ff7043", title: "Topázio" },
  { id: "color_diamante", price: 225, type: "namecolor", color: "#b3e5fc", title: "Diamante" },
  { id: "color_platina", price: 500, type: "namecolor", color: "#e0e0e0", title: "Platina" },
];

// ─── Cores exclusivas (fora da loja) ────────────────────────────────────────
// Não aparecem em STORE_ITEMS (não são compráveis) e não passam por
// purchases:USERID — a posse é concedida diretamente aqui, por userKey, à mão.
// "Coração" é um presente único para a Rosane, nunca disponível pra compra.
const EXCLUSIVE_COLORS = [
  { id: "color_coracao", color: "#ff1744", title: "Coração" },
];

const EXCLUSIVE_COLOR_GRANTS = {
  rosane: ["color_coracao"],
};

function getExclusiveColorIds(name) {
  return EXCLUSIVE_COLOR_GRANTS[userKey(name)] || [];
}

function findNameColorItem(id) {
  return (
    STORE_ITEMS.find((i) => i.id === id && i.type === "namecolor") ||
    EXCLUSIVE_COLORS.find((i) => i.id === id)
  );
}

// ─── Emoji de ranking (compra livre, não é um item fixo da loja) ────────────
// Sem limite de quantidade; cada emoji novo custa 125 LuizCoins mais que o anterior.
const EMOJI_BASE_PRICE = 25;
const EMOJI_PRICE_STEP = 25;
function emojiPriceForCount(ownedCount) {
  return EMOJI_BASE_PRICE + EMOJI_PRICE_STEP * ownedCount;
}

// ─── Preço pago "congelado" (compras passadas não mudam de valor) ──────────
// Mudar STORE_ITEMS.price ou EMOJI_BASE_PRICE/EMOJI_PRICE_STEP daqui para
// frente só afeta NOVAS compras: cada compra nova é guardada como
// `{ id/emoji, pricePaid }`, não apenas o id/emoji. Assim o valor gasto fica
// fixo no momento da compra, independente de o item mudar de preço depois.
//
// Compras feitas ANTES desta mudança foram salvas como string solta (sem
// pricePaid). Pra elas, usamos os snapshots abaixo — congelados para sempre,
// nunca sincronizados com STORE_ITEMS/EMOJI_BASE_PRICE — só para não alterar
// retroativamente o saldo de quem já comprou. NUNCA edite estes valores.
const LEGACY_STORE_PRICES = {
  palinha: 10,
  baixista: 10,
  confusp: 25,
  color_esmeralda: 100,
  color_rubi: 250,
  color_dourado: 1000,
  color_diamante: 10000,
};
const LEGACY_EMOJI_BASE_PRICE = 125;
const LEGACY_EMOJI_PRICE_STEP = 125;

// Extrai só os ids de uma lista de compras que pode misturar o formato antigo
// (string) com o novo (`{ id, pricePaid }`) — usado em toda checagem de
// "o usuário já tem esse item?".
function purchaseIds(rawPurchases) {
  return rawPurchases.map((p) => (typeof p === "string" ? p : p.id));
}

function purchaseSpent(rawPurchases) {
  return rawPurchases.reduce((sum, p) => {
    if (typeof p === "string") return sum + (LEGACY_STORE_PRICES[p] || 0);
    return sum + (p.pricePaid || 0);
  }, 0);
}

// Extrai só os emojis de uma lista que pode misturar string (antigo) com
// `{ emoji, pricePaid }` (novo).
function emojiList(rawOwned) {
  return rawOwned.map((e) => (typeof e === "string" ? e : e.emoji));
}

function emojiSpent(rawOwned) {
  return rawOwned.reduce((sum, e, i) => {
    if (typeof e === "string") return sum + LEGACY_EMOJI_BASE_PRICE + LEGACY_EMOJI_PRICE_STEP * i;
    return sum + (e.pricePaid || 0);
  }, 0);
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
//
// A curva segue um decaimento suave (estilo sino) — quem errou em até 60min
// ainda recebe alguma recompensa; a penalidade brusca era antes de 10min.
const PRECISION_BANDS = [
  { maxDiff: 0,  coins: 30 },
  { maxDiff: 5,  coins: 25 },
  { maxDiff: 10, coins: 20 },
  { maxDiff: 20, coins: 15 },
  { maxDiff: 30, coins: 10 },
  { maxDiff: 45, coins: 6 },
  { maxDiff: 60, coins: 3 },
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

// "Luiz de Placa": jogador ativa antes de apostar (ver routes/bets.js) e ganha
// o dobro de moedas pela aposta daquele dia, uma vez por semana. Apostas
// invalidadas por sniping não dobram — o jogador já está sendo penalizado e
// não há "precisão" nenhuma a recompensar em dobro.
function coinsForGuess(rankingEntry) {
  if (!rankingEntry) return PARTICIPATION_COINS;
  if (rankingEntry.invalidated === undefined) return legacyCoinsForGuess(rankingEntry);
  if (rankingEntry.invalidated) return PARTICIPATION_COINS;
  const band = PRECISION_BANDS.find((b) => rankingEntry.diff <= b.maxDiff);
  const coins = band ? band.coins : PARTICIPATION_COINS;
  return rankingEntry.placa ? coins * 2 : coins;
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

  const farmCoins = parseRedisNumber(await kv.get(`farmcoins:${userKey(user.name)}`));
  earnedCoins += farmCoins;

  const bjWon = parseRedisNumber(await kv.get(`bjwon:${userKey(user.name)}`));
  earnedCoins += bjWon;

  const purchasesKey = `purchases:${userKey(user.name)}`;
  const rawPurchases = parseRedisArray(await kv.get(purchasesKey));
  const purchases = purchaseIds(rawPurchases);
  let spentCoins = purchaseSpent(rawPurchases);

  const emojiOwnedKey = `emoji_owned:${userKey(user.name)}`;
  const rawEmojiOwned = parseRedisArray(await kv.get(emojiOwnedKey));
  const emojiOwned = emojiList(rawEmojiOwned);
  spentCoins += emojiSpent(rawEmojiOwned);

  const farmSpent = parseRedisNumber(await kv.get(`farmspent:${userKey(user.name)}`));
  spentCoins += farmSpent;

  const bjLost = parseRedisNumber(await kv.get(`bjlost:${userKey(user.name)}`));
  spentCoins += bjLost;

  return { earnedCoins, spentCoins, purchases, gameCoins, emojiOwned };
}

module.exports = {
  STORE_ITEMS,
  EXCLUSIVE_COLORS,
  getExclusiveColorIds,
  findNameColorItem,
  EMOJI_BASE_PRICE,
  EMOJI_PRICE_STEP,
  emojiPriceForCount,
  EMOJI_REGEX,
  PRECISION_BANDS,
  PARTICIPATION_COINS,
  coinsForGuess,
  purchaseIds,
  emojiList,
  calcBalance,
};
