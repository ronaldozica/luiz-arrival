const express = require("express");
const router = express.Router();

const { getKV } = require("../lib/redis");
const { getUsers } = require("../lib/users");
const { getDayData, setDayData, MAX_DAYS } = require("../lib/days");
const {
  todayKey,
  isWeekday,
  currentTimeMinutes,
  timeStrToMinutes,
  minutesToTimeStr,
  getNextWeekdayStr,
} = require("../lib/datetime");
const { userKey } = require("../lib/utils");
const { getBearerToken, resolveUserSession } = require("../lib/session");
const { requireAuth } = require("../lib/auth-middleware");
const { getCachedOrCompute } = require("../lib/cache");

// GET /api/today
router.get("/today", async (req, res) => {
  try {
    const kv = getKV();
    const key = todayKey();
    const todayDay = await getDayData(kv, key);
    const nowMins = currentTimeMinutes();
    const cutoffMins = timeStrToMinutes("10:00");

    let activeBetDate = key;
    if (!isWeekday(key) || todayDay.arrival || nowMins >= cutoffMins) {
      activeBetDate = getNextWeekdayStr();
    }

    const isNextDay = activeBetDate !== key;
    const targetDate = activeBetDate;
    const targetDayData = isNextDay ? await getDayData(kv, targetDate) : todayDay;

    // Identifica o viewer pelo token de sessão
    let viewerName = null;
    const token = getBearerToken(req);
    if (token) {
      viewerName = await resolveUserSession(kv, token) || null;
    }

    const targetViewerGuess = targetDayData.guesses.find(
      (g) => viewerName && userKey(g.name) === userKey(viewerName)
    );

    let exposedGuesses = [];
    let hiddenCount = 0;

    if (targetViewerGuess) {
      exposedGuesses = targetDayData.guesses;
    } else if (isNextDay) {
      hiddenCount = targetDayData.guesses.filter(
        (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
      ).length;
      exposedGuesses = [];
    } else {
      const bettingOpenForToday = !todayDay.arrival && nowMins < cutoffMins && isWeekday(key);
      if (todayDay.arrival) {
        exposedGuesses = todayDay.guesses;
      } else if (bettingOpenForToday) {
        hiddenCount = todayDay.guesses.filter(
          (g) => !viewerName || userKey(g.name) !== userKey(viewerName)
        ).length;
        exposedGuesses = [];
      } else {
        hiddenCount = todayDay.guesses.length;
        exposedGuesses = [];
      }
    }

    res.json({
      date: key,
      displayDate: targetDate,
      guesses: exposedGuesses,
      hiddenCount,
      arrival: isNextDay ? null : (todayDay.arrival || null),
      rankings: isNextDay ? null : (todayDay.rankings || null),
      currentTime: minutesToTimeStr(nowMins),
      activeBetDate,
      viewerHasGuessed: !!targetViewerGuess,
      viewerGuess: targetViewerGuess || null,
      bettingOpen: true
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/guess — requer sessão válida
router.post("/guess", requireAuth, async (req, res) => {
  try {
    const { time } = req.body;
    const name = req.sessionName;

    if (!time) {
      return res.status(400).json({ error: "Campo 'time' é obrigatório." });
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: "Formato de hora inválido. Use HH:MM." });
    }

    const kv = getKV();
    const users = await getUsers(kv);
    const user = users.find((u) => userKey(u.name) === userKey(name));
    if (!user) {
      return res.status(401).json({ error: "Usuário não encontrado." });
    }

    let activeBetDate = todayKey();
    const todayDay = await getDayData(kv, activeBetDate);
    const nowMins = currentTimeMinutes();

    if (!isWeekday(activeBetDate) || todayDay.arrival || nowMins >= timeStrToMinutes("10:00")) {
      activeBetDate = getNextWeekdayStr();
    }

    const day = await getDayData(kv, activeBetDate);

    if (day.arrival) {
      return res.status(400).json({ error: "Apostas já foram encerradas para este dia." });
    }

    if (activeBetDate === todayKey() && nowMins >= timeStrToMinutes("10:00")) {
      return res.status(400).json({ error: "Apostas encerradas após 10h." });
    }

    const existing = day.guesses.findIndex(g => userKey(g.name) === userKey(name));
    if (existing >= 0) {
      return res.status(409).json({
        error: "Você já apostou! Só é permitido um palpite por dia.",
      });
    }

    day.guesses.push({
      name: user.name,
      time,
      createdAt: new Date().toISOString(),
    });

    await setDayData(kv, activeBetDate, day);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/history
router.get("/history", async (req, res) => {
  try {
    const kv = getKV();
    const results = await getCachedOrCompute(kv, "cache:history", async () => {
      let index = (await kv.get("days_index")) || [];
      const computed = [];
      for (const dateKey of index.reverse()) {
        if (!isWeekday(dateKey)) continue;
        const day = await getDayData(kv, dateKey);
        if (day.arrival) {
          computed.push({
            date: dateKey,
            arrival: day.arrival,
            rankings: day.rankings || [],
            guesses: day.guesses || [],
          });
        }
        if (computed.length >= MAX_DAYS) break;
      }
      return computed;
    });
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/overall-rank
router.get("/overall-rank", async (req, res) => {
  try {
    const kv = getKV();
    const ranked = await getCachedOrCompute(kv, "cache:overall_rank", async () => {
      let index = (await kv.get("days_index")) || [];
      const scores = {};
      const users = await getUsers(kv);
      const hcmNames = new Set(
        users.filter((u) => u.isHCM).map((u) => userKey(u.name)),
      );

      for (const dateKey of index) {
        if (!isWeekday(dateKey)) continue;
        const day = await getDayData(kv, dateKey);
        if (!day.arrival || !day.rankings) continue;
        const total = day.rankings.length;
        for (const r of day.rankings) {
          const key = r.name;
          if (!scores[key])
            scores[key] = {
              name: r.name,
              points: 0,
              wins: 0,
              days: 0,
              totalDiff: 0,
              isHCM: hcmNames.has(userKey(r.name)),
            };
          scores[key].points += total - r.position + 1;
          scores[key].totalDiff += r.diff;
          scores[key].days += 1;
          if (r.position === 1) scores[key].wins += 1;
        }
      }
      return Object.values(scores)
        .map((s) => ({
          ...s,
          avgDiffMins: s.days > 0 ? Math.round(s.totalDiff / s.days) : 0,
        }))
        .sort((a, b) => b.points - a.points || a.avgDiffMins - b.avgDiffMins);
    });
    res.json(ranked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
