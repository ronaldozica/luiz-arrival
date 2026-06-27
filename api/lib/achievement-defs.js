const { userKey, parseRedisArray } = require("./utils");

// ─── Conquistas (Achievements) ───────────────────────────────────────────────
const ACHIEVEMENT_DEFS = [
  { id: "snake_500", title: "Serpente veloz", description: "Faça mais de 500 pontos no Snake", icon: "🐍" },
  { id: "minesweeper_beginner", title: "Detonador iniciante", description: "Complete uma partida de Campo Minado no modo Iniciante", icon: "💣" },
  { id: "minesweeper_intermediate", title: "Detonador intermediário", description: "Complete uma partida de Campo Minado no modo Intermediário", icon: "🧨" },
  { id: "minesweeper_expert", title: "Detonador especialista", description: "Complete uma partida de Campo Minado no modo Especialista", icon: "🏆" },
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
