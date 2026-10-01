// Semáforo de criticidade das divergências (spec §10–11, §18.7). Função PURA: recebe a ficha, a quantidade
// e as configurações (lib/settings.js → `severity`) e devolve o nível. Nada aqui lê banco.
const { HttpError } = require('./catalog');

const LEVELS = ['GREEN', 'YELLOW', 'RED'];
const rank = (level) => LEVELS.indexOf(level);
const atLeast = (level, min) => rank(level) >= rank(min);
const higher = (a, b) => (rank(a) >= rank(b) ? a : b);

/**
 * Classifica uma divergência.
 *  1. Faixa pelo valor nominal: a 1ª faixa com `up_to >= valor` vence (`up_to: null` = sem teto).
 *  2. Escalonamento por quantidade: passou de `yellow_at_quantity`/`red_at_quantity` → sobe para, no mínimo, o nível.
 * @returns {{ level: 'GREEN'|'YELLOW'|'RED', reason: 'band'|'quantity' }}
 */
function classify(chip, quantity, settings) {
  const value = Number(chip?.value) || 0;
  const bands = settings?.bands || [];
  const band = bands.find((b) => b.up_to === null || b.up_to === undefined || value <= b.up_to);
  let level = band ? band.level : 'RED'; // sem faixa que cubra: o conservador
  let reason = 'band';
  const esc = settings?.escalate || {};
  const q = Number(quantity) || 0;
  for (const [key, to] of [['yellow_at_quantity', 'YELLOW'], ['red_at_quantity', 'RED']]) {
    if (Number(esc[key]) > 0 && q >= Number(esc[key]) && rank(to) > rank(level)) { level = to; reason = 'quantity'; }
  }
  return { level, reason };
}

/** A justificativa é obrigatória a partir do nível configurado (default RED). */
const requiresJustification = (level, settings) => atLeast(level, settings?.require_justification_from || 'RED');

/** Valida e normaliza o que o admin envia em PUT /settings/severity. */
function validate(input) {
  const bad = (msg) => { throw new HttpError(400, msg); };
  if (!input || typeof input !== 'object') bad('Configuração do semáforo inválida.');
  if (!Array.isArray(input.bands) || !input.bands.length) bad('Informe ao menos uma faixa.');
  let prev = 0;
  const bands = input.bands.map((b, i) => {
    if (!LEVELS.includes(b?.level)) bad(`Faixa ${i + 1}: nível deve ser GREEN, YELLOW ou RED.`);
    const last = i === input.bands.length - 1;
    if (b.up_to === null || b.up_to === undefined || b.up_to === '') {
      if (!last) bad(`Faixa ${i + 1}: só a última faixa pode ficar sem teto.`);
      return { up_to: null, level: b.level };
    }
    const up = Number(b.up_to);
    if (!Number.isFinite(up) || up <= 0) bad(`Faixa ${i + 1}: o teto deve ser um número maior que zero.`);
    if (up <= prev) bad(`Faixa ${i + 1}: os tetos devem ser crescentes.`);
    if (last) bad('A última faixa deve ficar sem teto (cobre os valores maiores).');
    prev = up;
    return { up_to: up, level: b.level };
  });
  const esc = input.escalate || {};
  const q = (k) => {
    if (esc[k] === null || esc[k] === undefined || esc[k] === '') return null;
    const n = Number(esc[k]);
    if (!Number.isInteger(n) || n <= 0) bad('Os limites de quantidade devem ser inteiros maiores que zero (ou vazios).');
    return n;
  };
  const yellow = q('yellow_at_quantity'); const red = q('red_at_quantity');
  if (yellow && red && red <= yellow) bad('O limite vermelho deve ser maior que o amarelo.');
  const from = input.require_justification_from ?? 'RED';
  if (!LEVELS.includes(from)) bad('Nível mínimo da justificativa inválido.');
  return { bands, escalate: { yellow_at_quantity: yellow, red_at_quantity: red }, require_justification_from: from };
}

module.exports = { LEVELS, rank, atLeast, higher, classify, requiresJustification, validate };
