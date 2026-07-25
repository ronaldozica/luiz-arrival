const { userKey, parseRedisNumber, parseRedisArray } = require("./utils");
const { isWeekday } = require("./datetime");
const { getCachedOrCompute } = require("./cache");

// ─── Loja de Prêmios ─────────────────────────────────────────────────────────
// Preços calibrados pra ~6 LuizCoins/dia (jogador engajado apostando todo dia
// útil, sem contar minigame). Minigames viraram fliperama (paga ficha pra
// jogar, ver ARCADE_ENTRY_FEE em lib/games.js) — sem teto diário, autolimitado
// pelo custo de entrada. Alvos: gifs em poucos dias; esmeralda em até ~4 dias;
// rubi em menos de 2 semanas; dourado em menos de 1 mês; diamante (2,5x o
// dourado) em menos de 2 meses.
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
  { id: "color_topazio", price: 150, type: "namecolor", color: "#e64a19", title: "Topázio" },
  { id: "color_diamante", price: 225, type: "namecolor", color: "#b3e5fc", title: "Diamante" },
  { id: "color_platina", price: 500, type: "namecolor", color: "#e0e0e0", title: "Platina" },
  { id: "color_fogo",    price: 500, type: "namecolor", color: "#ff4500", title: "Fogo" },
  { id: "color_agua",    price: 500, type: "namecolor", color: "#0288d1", title: "Água" },
  { id: "color_terra",   price: 500, type: "namecolor", color: "#6d4c41", title: "Terra" },
  { id: "color_ar",      price: 500, type: "namecolor", color: "#80deea", title: "Ar" },
  { id: "color_gelo",    price: 750, type: "namecolor", color: "#b3e5fc", title: "Gelo" },
  { id: "color_cosmico", price: 750, type: "namecolor", color: "#8e24aa", title: "Cósmico" },
  { id: "color_rainbow", price: 1000, type: "namecolor", color: "#ff5252", title: "Arco-Íris" },
  { id: "color_neon",    price: 1000, type: "namecolor", color: "#0fffc1", title: "Neon" },
  { id: "frame_gold", price: 150, type: "emojiframe", frameClass: "emoji-frame-gold", title: "Moldura Dourada" },
  { id: "frame_neon", price: 250, type: "emojiframe", frameClass: "emoji-frame-neon", title: "Moldura Neon" },
  { id: "frame_fire", price: 350, type: "emojiframe", frameClass: "emoji-frame-fire", title: "Moldura de Fogo" },
  { id: "cursor_target", price: 80,  type: "cursor", emoji: "🎯", title: "Cursor Mira" },
  { id: "cursor_coin",   price: 80,  type: "cursor", emoji: "🪙", title: "Cursor Moeda" },
  { id: "cursor_crown",  price: 120, type: "cursor", emoji: "👑", title: "Cursor Coroa" },
  { id: "farmseed_strawberry", price: 60,  type: "farmseed", seedKey: "strawberry", icon: "🍓", title: "Semente de Morango",  desc: "Plante morangos na fazenda (1h · +10🪙 · limite diário = parcelas desbloqueadas)" },
  { id: "farmseed_orange",     price: 120, type: "farmseed", seedKey: "orange",     icon: "🍊", title: "Semente de Laranja",  desc: "Plante laranjas na fazenda (12h · +60🪙 · limite diário = parcelas desbloqueadas)" },
  { id: "farmseed_pineapple",  price: 300, type: "farmseed", seedKey: "pineapple",  icon: "🍍", title: "Semente de Abacaxi", desc: "Plante abacaxis na fazenda (3 dias · +324🪙 · limite diário = parcelas desbloqueadas)" },
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

function findEmojiFrameItem(id) {
  return STORE_ITEMS.find((i) => i.id === id && i.type === "emojiframe");
}

// ─── Títulos ao lado do nome (lista curada, compra escalona igual fonte/emoji) ─
const TITLES = [
  { id: "title_lenda",      label: "Lenda" },
  { id: "title_rei",        label: "Rei dos Jogos" },
  { id: "title_sortudo",    label: "Sortudo" },
  { id: "title_imbativel",  label: "Imbatível" },
  { id: "title_highroller", label: "High Roller" },
  { id: "title_mestre",     label: "Mestre dos Baralhos" },
  { id: "title_maquina",    label: "Máquina de LuizCoins" },
  { id: "title_vidente",    label: "Vidente do Luiz" },
];
const TITLE_IDS = new Set(TITLES.map((t) => t.id));
const TITLE_BASE_PRICE = 100;
const TITLE_PRICE_STEP = 100;
function titlePriceForCount(ownedCount) {
  return TITLE_BASE_PRICE + TITLE_PRICE_STEP * ownedCount;
}
// Títulos: formato `{ titleId, pricePaid }` — sem legado (feature nova).
function titleList(rawOwned) {
  return rawOwned.map((t) => t.titleId);
}
function titleSpent(rawOwned) {
  return rawOwned.reduce((sum, t) => sum + (t.pricePaid || 0), 0);
}

// ─── Emoji de ranking (compra livre, não é um item fixo da loja) ────────────
// Sem limite de quantidade; cada emoji novo custa 125 LuizCoins mais que o anterior.
const EMOJI_BASE_PRICE = 25;
const EMOJI_PRICE_STEP = 25;
function emojiPriceForCount(ownedCount) {
  return EMOJI_BASE_PRICE + EMOJI_PRICE_STEP * ownedCount;
}

// ─── Fontes de ranking (catálogo fixo, compra escalona igual ao emoji) ───────
const FONTS = [
  { id: "font_comic_sans",     label: "Comic Sans"       },
  { id: "font_impact",         label: "Impact"           },
  { id: "font_courier",        label: "Courier New"      },
  { id: "font_georgia",        label: "Georgia"          },
  { id: "font_lobster",        label: "Lobster"          },
  { id: "font_press_start",    label: "Press Start 2P"   },
  { id: "font_pacifico",       label: "Pacifico"         },
  { id: "font_dancing_script", label: "Dancing Script"   },
  { id: "font_minecraft",      label: "Minecraft"        },
];
const FONT_IDS = new Set(FONTS.map((f) => f.id));
const FONT_BASE_PRICE = 25;
const FONT_PRICE_STEP = 25;
function fontPriceForCount(ownedCount) {
  return FONT_BASE_PRICE + FONT_PRICE_STEP * ownedCount;
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

// Fontes: formato `{ fontId, pricePaid }` — sem legado (feature nova).
function fontList(rawOwned) {
  return rawOwned.map((f) => f.fontId);
}

function fontSpent(rawOwned) {
  return rawOwned.reduce((sum, f) => sum + (f.pricePaid || 0), 0);
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

// Nomes das ~14 chaves individuais que compõem o "extrato" de um jogador —
// centralizado aqui pra manter WALLET_KEYS (ordem dos kv.mget) e o
// destructuring abaixo sincronizados num só lugar.
const WALLET_FIELDS = [
  "gamecoins", "farmcoins", "bjwon", "purchases", "emoji_owned", "font_owned",
  "farmspent", "bjlost", "gamespent", "roulettewon", "roulettelost",
  "slotwon", "slotlost", "title_owned",
];

// Cada chamada de calcBalance rodava ~40 comandos Redis (1 GET por dia de
// apostas no histórico inteiro + 1 GET por campo da carteira) — o maior
// consumidor de comandos do app, chamado em ~18 rotas diferentes. MGET busca
// várias chaves num único comando (confirmado na doc da Upstash: MGET conta
// como 1, diferente de pipeline/multi-exec que contam 1 por comando), então
// agrupar essas leituras aqui derruba isso pra ~3 comandos por chamada, sem
// mudar nenhuma lógica — só troca N GETs sequenciais por 1 MGET.
async function calcBalance(kv, user, users) {
  const uKey = userKey(user.name);
  const hcmNames = new Set(
    users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
  );
  const isUserHCM = hcmNames.has(uKey);

  const index = (await kv.get("days_index")) || [];
  const weekdayKeys = index.filter(isWeekday);
  const days = weekdayKeys.length > 0
    ? await kv.mget(weekdayKeys.map((dateKey) => `day:${dateKey}`))
    : [];

  let earnedCoins = 0;
  for (let i = 0; i < weekdayKeys.length; i++) {
    const day = days[i];
    if (!day || !day.arrival || !day.rankings) continue;
    const userRank = day.rankings.find((r) => userKey(r.name) === uKey);
    if (userRank) earnedCoins += coinsForGuess(userRank);

    if (isUserHCM) {
      const hcmRanks = day.rankings.filter(
        (r) => hcmNames.has(userKey(r.name)) && r.position !== null && r.position !== undefined,
      );
      if (hcmRanks.length > 0) {
        const topHcmPos = hcmRanks[0].position;
        const isTopHcm = hcmRanks.some(
          (r) => r.position === topHcmPos && userKey(r.name) === uKey,
        );
        if (isTopHcm && userRank) earnedCoins += 5;
      }
    }
  }

  const [
    gameCoinsRaw, farmCoinsRaw, bjWonRaw, purchasesRaw, emojiOwnedRaw, fontOwnedRaw,
    farmSpentRaw, bjLostRaw, gameSpentRaw, rouletteWonRaw, rouletteLostRaw,
    slotWonRaw, slotLostRaw, titleOwnedRaw,
  ] = await kv.mget(WALLET_FIELDS.map((field) => `${field}:${uKey}`));

  const gameCoins = parseRedisNumber(gameCoinsRaw);
  earnedCoins += gameCoins;

  const farmCoins = parseRedisNumber(farmCoinsRaw);
  earnedCoins += farmCoins;

  const bjWon = parseRedisNumber(bjWonRaw);
  earnedCoins += bjWon;

  const rawPurchases = parseRedisArray(purchasesRaw);
  const purchases = purchaseIds(rawPurchases);
  let spentCoins = purchaseSpent(rawPurchases);

  const rawEmojiOwned = parseRedisArray(emojiOwnedRaw);
  const emojiOwned = emojiList(rawEmojiOwned);
  spentCoins += emojiSpent(rawEmojiOwned);

  const rawFontOwned = parseRedisArray(fontOwnedRaw);
  const fontOwned = fontList(rawFontOwned);
  spentCoins += fontSpent(rawFontOwned);

  const farmSpent = parseRedisNumber(farmSpentRaw);
  spentCoins += farmSpent;

  const bjLost = parseRedisNumber(bjLostRaw);
  spentCoins += bjLost;

  const gameSpent = parseRedisNumber(gameSpentRaw);
  spentCoins += gameSpent;

  const rouletteWon = parseRedisNumber(rouletteWonRaw);
  earnedCoins += rouletteWon;

  const rouletteLost = parseRedisNumber(rouletteLostRaw);
  spentCoins += rouletteLost;

  const slotWon = parseRedisNumber(slotWonRaw);
  earnedCoins += slotWon;

  const slotLost = parseRedisNumber(slotLostRaw);
  spentCoins += slotLost;

  const rawTitleOwned = parseRedisArray(titleOwnedRaw);
  const titleOwned = titleList(rawTitleOwned);
  spentCoins += titleSpent(rawTitleOwned);

  return { earnedCoins, spentCoins, purchases, gameCoins, emojiOwned, fontOwned, rawFontOwned, titleOwned, rawTitleOwned };
}

// Cache por usuário do resultado de calcBalance (chave `balance:<uKey>`,
// mesmo getCachedOrCompute/TTL de segurança já usado por cache:profiles
// etc.) — pensado só pra leituras que checam saldo ANTES de fazer sua
// própria escrita (comprar, apostar). Rotas que leem o saldo DEPOIS de já
// terem escrito no mesmo request (ex.: farm/harvest reportando o total após
// colher) devem continuar chamando calcBalance() direto — uma leitura única
// por request não ganha nada com cache, e usar a versão cacheada ali correria
// o risco de devolver o valor de ANTES da própria escrita (cache só é
// invalidado no fim do request, via invalidatesUserBalance em lib/cache.js).
async function getCachedBalance(kv, user, users) {
  return getCachedOrCompute(kv, `balance:${userKey(user.name)}`, () => calcBalance(kv, user, users));
}

module.exports = {
  STORE_ITEMS,
  EXCLUSIVE_COLORS,
  getExclusiveColorIds,
  findNameColorItem,
  findEmojiFrameItem,
  TITLES,
  TITLE_IDS,
  TITLE_BASE_PRICE,
  TITLE_PRICE_STEP,
  titlePriceForCount,
  titleList,
  EMOJI_BASE_PRICE,
  EMOJI_PRICE_STEP,
  emojiPriceForCount,
  EMOJI_REGEX,
  FONTS,
  FONT_IDS,
  FONT_BASE_PRICE,
  FONT_PRICE_STEP,
  fontPriceForCount,
  fontList,
  PRECISION_BANDS,
  PARTICIPATION_COINS,
  coinsForGuess,
  purchaseIds,
  emojiList,
  calcBalance,
  getCachedBalance,
};
