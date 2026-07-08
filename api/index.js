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

// ─── Export para Vercel ───────────────────────────────────────────────────────
module.exports = app;
