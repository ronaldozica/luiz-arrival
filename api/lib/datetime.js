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

// Brasil não usa horário de verão desde 2019, então o offset de -3h é fixo.
const BRASILIA_UTC_OFFSET_MINUTES = 3 * 60;

// Converte uma data+hora local de Brasília (ex: "2026-06-27" + "08:47") no
// instante UTC correspondente, em ms. Usado para comparar com timestamps
// (createdAt) gerados por `new Date().toISOString()`.
function brasiliaWallTimeToInstant(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) + BRASILIA_UTC_OFFSET_MINUTES * 60000;
}

// Retorna a semana ISO (segunda a domingo) de uma data, no formato "2026-W26".
// Usado para agrupar dias em rankings semanais sem precisar de uma estrutura
// de dados nova — a chave é derivada da data, igual ao isWeekday.
function getWeekKey(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Desloca para a quinta-feira da mesma semana ISO (segunda=1 .. domingo=7),
  // garantindo que o ano ISO esteja correto perto da virada do ano.
  const isoDay = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + (4 - isoDay));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNum = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

module.exports = {
  getBrasiliaDate,
  todayKey,
  isWeekday,
  currentTimeMinutes,
  timeStrToMinutes,
  minutesToTimeStr,
  getNextWeekdayStr,
  brasiliaWallTimeToInstant,
  getWeekKey,
};
