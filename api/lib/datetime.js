function getBrasiliaDate() {
  const now = new Date();
  const offset = -3 * 60;
  const local = new Date(
    now.getTime() + (offset + now.getTimezoneOffset()) * 60000,
  );
  return local;
}

function todayKey() {
  const d = getBrasiliaDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekday(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day >= 1 && day <= 5;
}

function currentTimeMinutes() {
  const d = getBrasiliaDate();
  return d.getHours() * 60 + d.getMinutes();
}

function timeStrToMinutes(str) {
  const [h, m] = str.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTimeStr(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function getNextWeekdayStr() {
  const d = getBrasiliaDate();
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  getBrasiliaDate,
  todayKey,
  isWeekday,
  currentTimeMinutes,
  timeStrToMinutes,
  minutesToTimeStr,
  getNextWeekdayStr,
};
