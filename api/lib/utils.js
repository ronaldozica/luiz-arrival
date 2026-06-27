function parseRedisNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function parseRedisArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function userKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function absDiff(a, b) {
  return Math.abs(a - b);
}

module.exports = { parseRedisNumber, parseRedisArray, userKey, absDiff };
