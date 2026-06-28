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

const DIFFICULTY_LABELS = {
  beginner: "Iniciante",
  intermediate: "Intermediário",
  expert: "Especialista",
  easy: "Fácil",
  medium: "Médio",
  hard: "Difícil",
  normal: "Normal",
};

module.exports = { GAMES, DIFFICULTY_LABELS };
