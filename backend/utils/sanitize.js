// Utilidades de validação/sanitização sem dependências externas.

/** Escapa uma string para uso seguro dentro de um $regex do MongoDB. */
function escapeRegex(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Converte para inteiro dentro de [min, max], com fallback. */
function toInt(value, { min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/** Mantém apenas as chaves informadas de um objeto (whitelist). */
function pick(obj = {}, keys = []) {
  const out = {};
  for (const k of keys) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/** true se o valor é um número finito. */
function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

module.exports = { escapeRegex, toInt, pick, isFiniteNumber };
