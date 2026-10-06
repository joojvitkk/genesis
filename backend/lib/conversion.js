// Conversão de fichas — Chip Race / Color Up (G6, spec §8). LÓGICA PURA, sem I/O.
//
// O operador lança o que SAIU de jogo (outs) e o que ENTROU (ins), por denominação. O servidor calcula:
//   value_out = Σ quantidade × valor nominal (saiu)      value_in = Σ quantidade × valor nominal (entrou)
//   math_breakage = value_in − value_out   ← QUEBRA MATEMÁTICA: diferença legítima da conversão (spec §8)
//
// Movimentação física (quantidade de fichas), conversão de valor (nominal) e quebra matemática são coisas
// separadas — e NENHUMA delas é perda física (§18.4): só a conferência física gera divergência (G8).
const TYPES = ['CHIP_RACE', 'COLOR_UP'];
const OUT_TYPE = { CHIP_RACE: 'CHIP_RACE_OUT', COLOR_UP: 'COLOR_UP_OUT' };
const IN_TYPE = { CHIP_RACE: 'CHIP_RACE_IN', COLOR_UP: 'COLOR_UP_IN' };

const idOf = (x) => String(x && typeof x === 'object' && x._id ? x._id : x);

/** [{ chip_id, quantity }] → inteiros ≥ 1, sem ficha repetida. Lança Error com mensagem em português. */
function normalizeSide(list, label) {
  if (!Array.isArray(list) || !list.length) throw new Error(`Informe ao menos uma ficha em "${label}".`);
  const seen = new Set();
  return list.map((l) => {
    const id = idOf(l?.chip_id);
    if (!l?.chip_id || id === 'undefined') throw new Error(`Ficha inválida em "${label}".`);
    if (seen.has(id)) throw new Error(`A mesma ficha aparece duas vezes em "${label}".`);
    seen.add(id);
    const quantity = Number(l.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`A quantidade de "${label}" deve ser um inteiro ≥ 1.`);
    return { chip_id: id, quantity };
  });
}

/**
 * Valida as duas pontas: ambas preenchidas. A MESMA ficha pode estar nos dois lados (ex.: retirar 500 e devolver parte
 * delas aos jogadores): o valor é calculado sobre o bruto e o movimento físico é o LÍQUIDO por ficha (`netSides`).
 */
function normalize(outs, ins) {
  return { outs: normalizeSide(outs, 'Retirado'), ins: normalizeSide(ins, 'Colocado') };
}

/**
 * Líquido por ficha: retirado − colocado. >0 sai de jogo (OUT), <0 entra em jogo (IN), 0 não move nada.
 * @returns {{ netOuts: Array, netIns: Array }}
 */
function netSides(outs, ins) {
  const net = new Map();
  for (const l of outs) net.set(l.chip_id, (net.get(l.chip_id) || 0) + l.quantity);
  for (const l of ins) net.set(l.chip_id, (net.get(l.chip_id) || 0) - l.quantity);
  const netOuts = []; const netIns = [];
  for (const [chip_id, q] of net) { if (q > 0) netOuts.push({ chip_id, quantity: q }); else if (q < 0) netIns.push({ chip_id, quantity: -q }); }
  return { netOuts, netIns };
}

/**
 * Valores e quebra. `chipsById`: Map id → { value }. Devolve as linhas com o valor de cada uma.
 * @returns {{ outs, ins, value_out, value_in, math_breakage }}
 */
function compute(outs, ins, chipsById) {
  const price = (id) => {
    const c = chipsById.get(String(id));
    if (!c) throw new Error('Ficha não encontrada.');
    return c.value || 0;
  };
  const line = (l) => ({ chip_id: String(l.chip_id), quantity: l.quantity, value: l.quantity * price(l.chip_id) });
  const o = outs.map(line);
  const i = ins.map(line);
  const value_out = o.reduce((s, l) => s + l.value, 0);
  const value_in = i.reduce((s, l) => s + l.value, 0);
  return { outs: o, ins: i, value_out, value_in, math_breakage: value_in - value_out };
}

module.exports = { TYPES, OUT_TYPE, IN_TYPE, normalizeSide, normalize, netSides, compute };
