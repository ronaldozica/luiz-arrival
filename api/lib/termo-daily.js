// ─── Termo Diário (Wordle em português) ──────────────────────────────────────
// Palavra do dia gerada de forma determinística a partir da data — mesma
// técnica do Sudoku Diário (mulberry32 seedado por hash da string da data),
// pra todo mundo jogar a mesma palavra e o resultado ser reproduzível.
//
// Lista curada de palavras comuns de 5 letras, SEM acento/cedilha — evita
// qualquer ambiguidade de normalização entre o que o jogador digita e o que
// está armazenado (ex.: "SAIDA" em vez de "SAÍDA"). O jogo aceita qualquer
// palpite de 5 letras alfabéticas, sem checagem de dicionário completo (a
// lista abaixo é só o universo de palavras DO DIA, não de palpites válidos).
const WORDS = [
  "AMIGO", "CARRO", "LIVRO", "PRAIA", "FESTA", "MUNDO", "CAMPO", "DENTE",
  "FALAR", "VERDE", "PRETO", "LARGO", "HOTEL", "NOITE", "TERRA", "PORTA",
  "PEDRA", "FONTE", "PONTE", "VIDRO", "FRUTA", "LEITE", "QUEDA", "RATOS",
  "GATOS", "FALHA", "GRAVE", "LOUCO", "BONDE", "CARTA", "CORPO", "DOCES",
  "FEITO", "FORTE", "GESSO", "HORAS", "IDEIA", "JOVEM", "LARGA", "LIMPO",
  "LINDO", "LOBOS", "LOJAS", "MAIOR", "MARES", "MOEDA", "MORTE", "MOTOR",
  "MUROS", "NADAR", "NAVIO", "NEGRO", "NOVOS", "OSSOS", "OUTRO", "PANOS",
  "PAPEL", "PASSO", "PEIXE", "PERNA", "PESOS", "PLACA", "POBRE", "POEMA",
  "PONTO", "PRADO", "PRESO", "PRIMO", "PULSO", "RADAR", "RAPAZ", "REGRA",
  "RISCO", "ROUPA", "SABOR", "SAIDA", "SALAS", "SALTO", "SANTO", "SAUDE",
  "SENSO", "SETOR", "SINAL", "SOBRE", "SONHO", "SORTE", "TECLA", "TEMPO",
  "TERNO", "TIGRE", "TINTA", "TOLDO", "TORRE", "TOTAL", "TRAVA", "TRIGO",
  "TROCA", "UNHAS", "URSOS", "VALOR", "VASOS", "VELHO", "VENTO", "VERBO",
  "VILAS", "VINHO", "VIRAR", "VISTA", "VIVER", "VOLTA", "ZEBRA", "FOGOS",
  "GALOS", "GANSO", "LEBRE", "MANGA", "MOSCA", "PATOS", "POMBO", "SAPOS",
  "VACAS", "ROXOS", "ROSAS", "MESES", "DEDOS", "OLHOS", "BOCAS", "NARIZ",
];

const WORD_LENGTH = 5;
const MAX_ATTEMPTS = 6;

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// mulberry32 — mesmo PRNG usado em lib/sudoku-daily.js.
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

// Escolhe a palavra do dia a partir da string da data (ex: "2026-07-26").
function pickDailyWord(dateKey) {
  const rng = mulberry32(hashStringToSeed(dateKey));
  const index = Math.floor(rng() * WORDS.length);
  return WORDS[index];
}

// Avalia um palpite contra a resposta, no estilo Wordle: 2 passadas pra
// lidar corretamente com letras repetidas (ex.: palpite "ROXOS" com resposta
// que só tem um "O" — só uma posição pode ficar "present"/"correct" pro O,
// nunca as duas).
function evaluateGuess(guess, answer) {
  const g = guess.toUpperCase().split("");
  const a = answer.toUpperCase().split("");
  const statuses = new Array(g.length).fill("absent");
  const answerUsed = new Array(a.length).fill(false);

  // Passada 1: acertos exatos (posição + letra)
  for (let i = 0; i < g.length; i++) {
    if (g[i] === a[i]) {
      statuses[i] = "correct";
      answerUsed[i] = true;
    }
  }
  // Passada 2: letra existe em outra posição ainda não consumida
  for (let i = 0; i < g.length; i++) {
    if (statuses[i] === "correct") continue;
    const idx = a.findIndex((ch, j) => ch === g[i] && !answerUsed[j]);
    if (idx !== -1) {
      statuses[i] = "present";
      answerUsed[idx] = true;
    }
  }
  return statuses;
}

// Um palpite válido: exatamente WORD_LENGTH letras do alfabeto (A-Z, sem
// acento/cedilha/espaço/número) — mesma restrição da lista de palavras.
function isValidGuessFormat(word) {
  return typeof word === "string" && new RegExp(`^[A-Za-z]{${WORD_LENGTH}}$`).test(word);
}

module.exports = {
  WORDS,
  WORD_LENGTH,
  MAX_ATTEMPTS,
  pickDailyWord,
  evaluateGuess,
  isValidGuessFormat,
};
