const { invalidateCache } = require("./cache");
const { isWeekday } = require("./datetime");

const MAX_DAYS = 22;

async function getDayData(kv, dateKey) {
  if (!kv) return { guesses: [], arrival: null };
  const data = await kv.get(`day:${dateKey}`);
  return data || { guesses: [], arrival: null };
}

async function setDayData(kv, dateKey, data) {
  await kv.set(`day:${dateKey}`, data);
  let index = (await kv.get("days_index")) || [];
  if (!index.includes(dateKey)) {
    index.push(dateKey);
    index.sort();
    const weekdays = index.filter(isWeekday);
    if (weekdays.length > MAX_DAYS) {
      const toRemove = weekdays.slice(0, weekdays.length - MAX_DAYS);
      for (const k of toRemove) await kv.del(`day:${k}`);
      index = index.filter((d) => !toRemove.includes(d));
    }
    await kv.set("days_index", index);
  }
  await invalidateCache(kv, "cache:history", "cache:overall_rank");
}

module.exports = { MAX_DAYS, getDayData, setDayData };
