const { userKey, parseRedisArray } = require("./utils");

// ─── Conquistas (Achievements) ───────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: "snake_500", title: "Serpente veloz", description: "Faça mais de 500 pontos no Snake", icon: "🐍" },
  { id: "minesweeper_beginner", title: "Detonador iniciante", description: "Complete uma partida de Campo Minado no modo Iniciante", icon: "💣" },
  { id: "minesweeper_intermediate", title: "Detonador intermediário", description: "Complete uma partida de Campo Minado no modo Intermediário", icon: "🧨" },
  { id: "minesweeper_expert", title: "Detonador especialista", description: "Complete uma partida de Campo Minado no modo Especialista", icon: "🏆" },
  { id: "sudoku_easy", title: "Aprendiz dos números", description: "Complete um Sudoku no modo Fácil", icon: "🔢" },
  { id: "sudoku_medium", title: "Mestre dos números", description: "Complete um Sudoku no modo Médio", icon: "🧮" },
  { id: "sudoku_hard", title: "Gênio dos números", description: "Complete um Sudoku no modo Difícil", icon: "🧠" },
  { id: "aimtrainer_sharp", title: "Mira afiada", description: "Faça 5000+ pontos no Aim Trainer", icon: "🎯" },
  { id: "aimtrainer_legend", title: "Lenda da mira", description: "Faça 3000+ pontos no Aim Trainer modo Difícil", icon: "🏆" },
  { id: "spider_easy", title: "Aprendiz do Spider", description: "Complete uma Paciência Spider no modo Fácil (1 naipe)", icon: "🕷️" },
  { id: "spider_medium", title: "Estrategista do Spider", description: "Complete uma Paciência Spider no modo Médio (2 naipes)", icon: "🃏" },
  { id: "spider_hard", title: "Lenda do Spider", description: "Complete uma Paciência Spider no modo Difícil (4 naipes)", icon: "🏆" },
  { id: "spider_no_hints", title: "Pura estratégia", description: "Vença uma Paciência Spider sem usar nenhuma dica", icon: "🧠" },
  { id: "spider_with_hints", title: "Com uma ajudinha", description: "Vença uma Paciência Spider usando ao menos uma dica", icon: "💡" },
  { id: "spider_flawless", title: "Vitória impecável", description: "Vença uma Paciência Spider sem usar dicas nem desfazer jogadas", icon: "💎" },
  { id: "bj_first_win", title: "Sortuda de iniciante", description: "Vença sua primeira mão no LuizJack 21", icon: "🎴" },
  { id: "bj_natural", title: "Natural!", description: "Consiga um Blackjack natural (21 nas 2 primeiras cartas)", icon: "🃏" },
  { id: "bj_high_roller", title: "High Roller", description: "Vença uma mão com aposta Alta (30 LC) no LuizJack", icon: "💰" },
  { id: "bj_streak_3", title: "Em chamas", description: "Vença 3 mãos seguidas no LuizJack", icon: "🔥" },
  { id: "bj_daily_cap", title: "A casa perdeu", description: "Atinja o limite diário de 100 LC no LuizJack em um único dia", icon: "🏆" },
  { id: "bet_winner", title: "Profeta do Luiz", description: "Seja o vencedor (1º lugar) em uma aposta do dia", icon: "🔮" },
  { id: "novato_em_ascensao", title: "Novato em ascensão", description: "Termine entre os 3 primeiros de um dia tendo jogado menos de 5 dias até então", icon: "🌱" },
  { id: "weekly_champion", title: "Campeão da semana", description: "Termine em 1º lugar no ranking semanal", icon: "👑" },
  { id: "weekly_top3", title: "Pódio semanal", description: "Termine entre os 3 primeiros do ranking semanal", icon: "📈" },
];

// Desbloqueia uma conquista para um usuário, se ele ainda não a tiver.
// Retorna true se a conquista foi desbloqueada agora (false se já tinha).
async function unlockAchievement(kv, name, achievementId) {
  const unlockedKey = `achievements:${userKey(name)}`;
  const unlocked = parseRedisArray(await kv.get(unlockedKey));
  if (unlocked.includes(achievementId)) return false;
  unlocked.push(achievementId);
  await kv.set(unlockedKey, JSON.stringify(unlocked));
  return true;
}

module.exports = { ACHIEVEMENT_DEFS, unlockAchievement };
