// ─── Catálogo central de minigames ────────────────────────────────────────────
// Fonte única de verdade pra quais jogos existem e quais dificuldades cada um
// tem. Usado pra validar scores (game-rank.js) e pra agregar rankings entre
// jogos (leaderboards.js) sem duplicar essa lista em mais de um lugar.
const GAMES = {
  snake: { label: "Snake 95", icon: "🐍", difficulties: null },
  minesweeper: { label: "Campo Minado", icon: "💣", difficulties: ["beginner", "intermediate", "expert"] },
  sudoku: { label: "Sudoku", icon: "🔢", difficulties: ["easy", "medium", "hard"] },
  aimtrainer: { label: "Aim Trainer", icon: "🔫", difficulties: ["easy", "normal", "hard"] },
  spider: { label: "Paciência Spider", icon: "🕷️", difficulties: ["easy", "medium", "hard"] },
};

// ─── Mecânica de fliperama ─────────────────────────────────────────────────
// Cada partida custa uma ficha; o troco (POST /api/game-rank) depende do
// desempenho — ver computeArcadePayout em routes/game-rank.js.
const ARCADE_ENTRY_FEE = 10;

const DIFFICULTY_LABELS = {
  beginner: "Iniciante",
  intermediate: "Intermediário",
  expert: "Especialista",
  easy: "Fácil",
  medium: "Médio",
  hard: "Difícil",
  normal: "Normal",
};

// ─── Tempo mínimo plausível pra um score (anti-trapaça) ───────────────────────
// Usado pelo token de rodada (ver POST /api/game-rank/start em game-rank.js)
// pra rejeitar submissões cujo score é fisicamente impossível de ter sido
// alcançado no tempo real decorrido desde o início da partida — fecha tanto a
// brecha de forjar uma requisição sem jogar quanto a de editar a variável de
// score no console e enviar na hora.
//
// Estas constantes espelham a mecânica real de cada jogo no frontend. Se a
// velocidade do Snake ou a duração da rodada do Aim Trainer mudar lá, precisa
// atualizar aqui também.
const AT_ROUND_DURATION_SECONDS = 15; // public/js/aimtrainer.js: AT_ROUND_DURATION
const SNAKE_MIN_SPEED_MS = 60; // public/js/snake.js: MIN_SPEED (velocidade mais rápida possível)

// Pisos fixos de tempo por dificuldade, independentes do score. Importante:
// NÃO dá pra derivar isso do próprio score nesses 3 jogos (ex: 9999 - score),
// porque o score JÁ É 9999 - tempoEmSegundos no cliente — usar o score pra
// validar o score é circular e não pega nada (um score forjado de 9999, que
// alega "venci em 0s", exigiria um mínimo de 0s e passaria sempre). Os
// números abaixo são estimativas conservadoras (bem abaixo de recordes
// humanos reais), só pra bloquear submissões instantâneas/forjadas sem gerar
// falso positivo pra quem joga rápido de verdade.
const MIN_SECONDS_BY_DIFFICULTY = {
  minesweeper: { beginner: 0.5, intermediate: 3, expert: 10 },
  sudoku: { easy: 5, medium: 15, hard: 30 },
  spider: { easy: 15, medium: 30, hard: 45 },
};

function minPlausibleSeconds(game, difficulty, score) {
  switch (game) {
    case "minesweeper":
    case "sudoku":
    case "spider":
      return (MIN_SECONDS_BY_DIFFICULTY[game] && MIN_SECONDS_BY_DIFFICULTY[game][difficulty]) || 0;
    case "aimtrainer":
      // Rodada de duração fixa: só dá pra submeter depois dela acabar de verdade.
      return AT_ROUND_DURATION_SECONDS;
    case "snake": {
      // score/10 = maçãs comidas; usa a velocidade mais rápida possível do
      // jogo, o cenário mais generoso possível pro jogador (menor tempo mínimo).
      const apples = score / 10;
      return apples * (SNAKE_MIN_SPEED_MS / 1000);
    }
    default:
      return 0;
  }
}

module.exports = { GAMES, DIFFICULTY_LABELS, minPlausibleSeconds, ARCADE_ENTRY_FEE };
