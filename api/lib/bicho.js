// ─── Luiz Bicho (Jogo do Bicho Diário) ───────────────────────────────────────
// Sorteio diário único ("Deu no Poste do Luiz") gerado de forma determinística
// a partir da data (mulberry32 seedado por hash da data, igual ao Sudoku Diário
// e ao Termo Diário). Todo mundo concorre à mesma extração de 5 prêmios de
// milhar (0000–9999) no dia, e os números sorteados só saem do servidor depois
// que o jogador registra sua fézinha do dia.

const ANIMALS = [
  { group: 1,  name: "Avestruz",  emoji: "🦩", dezenas: ["01", "02", "03", "04"] },
  { group: 2,  name: "Águia",     emoji: "🦅", dezenas: ["05", "06", "07", "08"] },
  { group: 3,  name: "Burro",     emoji: "🫏", dezenas: ["09", "10", "11", "12"] },
  { group: 4,  name: "Borboleta", emoji: "🦋", dezenas: ["13", "14", "15", "16"] },
  { group: 5,  name: "Cachorro",  emoji: "🐕", dezenas: ["17", "18", "19", "20"] },
  { group: 6,  name: "Cabra",     emoji: "🐐", dezenas: ["21", "22", "23", "24"] },
  { group: 7,  name: "Carneiro",  emoji: "🐏", dezenas: ["25", "26", "27", "28"] },
  { group: 8,  name: "Camelo",    emoji: "🐪", dezenas: ["29", "30", "31", "32"] },
  { group: 9,  name: "Cobra",     emoji: "🐍", dezenas: ["33", "34", "35", "36"] },
  { group: 10, name: "Coelho",    emoji: "🐇", dezenas: ["37", "38", "39", "40"] },
  { group: 11, name: "Cavalo",    emoji: "🐎", dezenas: ["41", "42", "43", "44"] },
  { group: 12, name: "Elefante",  emoji: "🐘", dezenas: ["45", "46", "47", "48"] },
  { group: 13, name: "Galo",      emoji: "🐓", dezenas: ["49", "50", "51", "52"] },
  { group: 14, name: "Gato",      emoji: "🐈", dezenas: ["53", "54", "55", "56"] },
  { group: 15, name: "Jacaré",    emoji: "🐊", dezenas: ["57", "58", "59", "60"] },
  { group: 16, name: "Leão",      emoji: "🦁", dezenas: ["61", "62", "63", "64"] },
  { group: 17, name: "Macaco",    emoji: "🐒", dezenas: ["65", "66", "67", "68"] },
  { group: 18, name: "Porco",     emoji: "🐖", dezenas: ["69", "70", "71", "72"] },
  { group: 19, name: "Pavão",     emoji: "🦚", dezenas: ["73", "74", "75", "76"] },
  { group: 20, name: "Peru",      emoji: "🦃", dezenas: ["77", "78", "79", "80"] },
  { group: 21, name: "Touro",     emoji: "🐂", dezenas: ["81", "82", "83", "84"] },
  { group: 22, name: "Tigre",     emoji: "🐅", dezenas: ["85", "86", "87", "88"] },
  { group: 23, name: "Urso",      emoji: "🐻", dezenas: ["89", "90", "91", "92"] },
  { group: 24, name: "Veado",     emoji: "🦌", dezenas: ["93", "94", "95", "96"] },
  { group: 25, name: "Vaca",      emoji: "🐄", dezenas: ["97", "98", "99", "00"] },
];

const PRIZE_COUNT = 5;
const BET_AMOUNTS = { low: 5, medium: 15, high: 30 };

// Multiplicadores de lucro líquido (mesma convenção de roulette.js e slot.js:
// coinsWon já é o lucro líquido somado ao saldo quando ganha).
// - grupo_cabeca: acerta o bicho do 1º prêmio → 18x a ficha
// - grupo_cercado: acerta o bicho em qualquer um dos 5 prêmios → 4x por prêmio acertado
// - dezena_cabeca: acerta a dezena exata (00–99) do 1º prêmio → 60x a ficha
const PAYOUTS = {
  grupo_cabeca: 18,
  grupo_cercado: 4,
  dezena_cabeca: 60,
};

const BET_MODES = new Set(Object.keys(PAYOUTS));

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeMilhar(milhar) {
  const n = Number(milhar);
  if (!Number.isInteger(n) || n < 0 || n > 9999) return "0000";
  return String(n).padStart(4, "0");
}

function dezenaFromMilhar(milhar) {
  const s = typeof milhar === "string" && /^\d{4}$/.test(milhar)
    ? milhar
    : normalizeMilhar(milhar);
  return s.slice(-2);
}

function groupFromDezena(dezena) {
  const n = Number(dezena);
  if (!Number.isInteger(n) || n < 0 || n > 99) return null;
  if (n === 0) return 25;
  return Math.ceil(n / 4);
}

function groupFromMilhar(milhar) {
  return groupFromDezena(dezenaFromMilhar(milhar));
}

function getAnimalByGroup(group) {
  const g = Number(group);
  if (!Number.isInteger(g) || g < 1 || g > 25) return null;
  return ANIMALS[g - 1] || null;
}

// Gera os 5 milhares sorteados para a data (ex.: "2026-10-31").
function pickDailyDraw(dateKey) {
  const rng = mulberry32(hashStringToSeed(`luizbicho:${dateKey}`));
  const prizes = [];
  for (let i = 0; i < PRIZE_COUNT; i++) {
    const n = Math.floor(rng() * 10000);
    prizes.push(String(n).padStart(4, "0"));
  }
  return prizes;
}

function formatDrawPrizes(prizes) {
  return (prizes || []).map((milharRaw, idx) => {
    const milhar = normalizeMilhar(milharRaw);
    const dezena = dezenaFromMilhar(milhar);
    const group = groupFromDezena(dezena);
    const animal = getAnimalByGroup(group);
    return {
      position: idx + 1,
      milhar,
      dezena,
      group,
      name: animal ? animal.name : "",
      emoji: animal ? animal.emoji : "",
    };
  });
}

function isValidBetInput(mode, target) {
  if (!BET_MODES.has(mode)) return false;
  if (mode === "grupo_cabeca" || mode === "grupo_cercado") {
    const g = Number(target);
    return Number.isInteger(g) && g >= 1 && g <= 25;
  }
  if (mode === "dezena_cabeca") {
    return typeof target === "string" && /^\d{2}$/.test(target);
  }
  return false;
}

// Resolve uma aposta contra os 5 milhares do dia.
// Retorna { outcome: "win" | "lose", coinsWon, coinsLost, matchedPrizes: [1..5] }
function resolveBichoBet({ mode, target, stake }, prizes) {
  const formatted = formatDrawPrizes(prizes);
  const matchedPrizes = [];

  if (mode === "grupo_cabeca") {
    const g = Number(target);
    if (formatted[0] && formatted[0].group === g) {
      matchedPrizes.push(1);
    }
    const won = matchedPrizes.length > 0;
    return {
      outcome: won ? "win" : "lose",
      coinsWon: won ? stake * PAYOUTS.grupo_cabeca : 0,
      coinsLost: won ? 0 : stake,
      matchedPrizes,
    };
  }

  if (mode === "grupo_cercado") {
    const g = Number(target);
    for (const p of formatted) {
      if (p.group === g) matchedPrizes.push(p.position);
    }
    const hits = matchedPrizes.length;
    const won = hits > 0;
    return {
      outcome: won ? "win" : "lose",
      coinsWon: won ? stake * PAYOUTS.grupo_cercado * hits : 0,
      coinsLost: won ? 0 : stake,
      matchedPrizes,
    };
  }

  if (mode === "dezena_cabeca") {
    const dez = String(target).padStart(2, "0");
    if (formatted[0] && formatted[0].dezena === dez) {
      matchedPrizes.push(1);
    }
    const won = matchedPrizes.length > 0;
    return {
      outcome: won ? "win" : "lose",
      coinsWon: won ? stake * PAYOUTS.dezena_cabeca : 0,
      coinsLost: won ? 0 : stake,
      matchedPrizes,
    };
  }

  return { outcome: "lose", coinsWon: 0, coinsLost: stake, matchedPrizes: [] };
}

// Ordena o ranking diário por maior prêmio (coinsWon decrescente) e, em caso
// de empate, por quem apostou primeiro (date ISO 8601 crescente).
function sortTodayWinners(winners) {
  return [...(winners || [])].sort((a, b) => {
    if (b.coinsWon !== a.coinsWon) return b.coinsWon - a.coinsWon;
    const ta = a.date ? Date.parse(a.date) : 0;
    const tb = b.date ? Date.parse(b.date) : 0;
    if (ta !== tb) return ta - tb;
    return 0;
  });
}

module.exports = {
  ANIMALS,
  PRIZE_COUNT,
  BET_AMOUNTS,
  PAYOUTS,
  BET_MODES,
  dezenaFromMilhar,
  groupFromDezena,
  groupFromMilhar,
  getAnimalByGroup,
  pickDailyDraw,
  formatDrawPrizes,
  isValidBetInput,
  resolveBichoBet,
  sortTodayWinners,
};
