require("dotenv").config({
  path: require("path").resolve(__dirname, "../.env.local"),
});

const express = require("express");
const cors = require("cors");
const app = express();

app.use(express.json());
app.use(cors());

app.use("/api", require("./routes/auth"));
app.use("/api", require("./routes/bets"));
app.use("/api", require("./routes/admin"));
app.use("/api", require("./routes/game-rank"));
app.use("/api", require("./routes/store"));
app.use("/api", require("./routes/profile"));
app.use("/api", require("./routes/achievements"));
app.use("/api", require("./routes/leaderboards"));
app.use("/api", require("./routes/farm"));
app.use("/api", require("./routes/blackjack"));
app.use("/api", require("./routes/roulette"));
app.use("/api", require("./routes/requests").router);

// ─── Migração única: Lenda da mira rebaixada de 10000→3000 ──────────────────
// Concede o achievement a todos com 3000+ no aim trainer difícil.
// Idempotente: usa flag Redis para não rodar duas vezes.
;(async () => {
  try {
    const { getKV } = require("./lib/redis");
    const { unlockAchievement } = require("./lib/achievement-defs");
    const kv = getKV();
    if (await kv.get("migration:aimtrainer_legend_3000")) return;
    const scores = (await kv.get("gamerank:aimtrainer:hard")) || [];
    for (const entry of scores.filter((e) => e.score >= 3000)) {
      await unlockAchievement(kv, entry.name, "aimtrainer_legend");
    }
    await kv.set("migration:aimtrainer_legend_3000", "1");
  } catch { /* silent — tenta de novo na próxima cold start */ }
})();

// ─── Export para Vercel ───────────────────────────────────────────────────────
module.exports = app;
