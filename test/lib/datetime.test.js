const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
  todayKey,
  isWeekday,
  getWeekKey,
  timeStrToMinutes,
  minutesToTimeStr,
  brasiliaWallTimeToInstant,
  getNextWeekdayStr,
} = require("../../api/lib/datetime");

describe("datetime", () => {
  test("todayKey retorna o formato YYYY-MM-DD", () => {
    assert.match(todayKey(), /^\d{4}-\d{2}-\d{2}$/);
  });

  test("isWeekday reconhece dias úteis e fins de semana", () => {
    assert.equal(isWeekday("2026-07-20"), true); // segunda-feira
    assert.equal(isWeekday("2026-07-22"), true); // quarta-feira
    assert.equal(isWeekday("2026-07-25"), false); // sábado
    assert.equal(isWeekday("2026-07-26"), false); // domingo
  });

  test("timeStrToMinutes / minutesToTimeStr fazem o roundtrip", () => {
    assert.equal(timeStrToMinutes("08:47"), 527);
    assert.equal(minutesToTimeStr(527), "08:47");
    assert.equal(minutesToTimeStr(timeStrToMinutes("23:59")), "23:59");
    assert.equal(minutesToTimeStr(timeStrToMinutes("00:00")), "00:00");
  });

  test("getWeekKey agrupa datas da mesma semana ISO", () => {
    // segunda a domingo da mesma semana devem cair na mesma chave
    const monday = getWeekKey("2026-07-20");
    const sunday = getWeekKey("2026-07-26");
    assert.equal(monday, sunday);
    assert.match(monday, /^\d{4}-W\d{2}$/);
  });

  test("getWeekKey distingue semanas diferentes", () => {
    assert.notEqual(getWeekKey("2026-07-20"), getWeekKey("2026-07-27"));
  });

  test("brasiliaWallTimeToInstant converte pro instante UTC certo (UTC-3)", () => {
    const instant = brasiliaWallTimeToInstant("2026-07-22", "12:00");
    const d = new Date(instant);
    assert.equal(d.getUTCHours(), 15); // 12:00 em Brasília = 15:00 UTC
    assert.equal(d.getUTCDate(), 22);
  });

  test("getNextWeekdayStr nunca cai em sábado/domingo", () => {
    const next = getNextWeekdayStr();
    assert.equal(isWeekday(next), true);
  });
});
