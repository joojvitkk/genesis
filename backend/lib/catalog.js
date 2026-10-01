// Regras do CATÁLOGO estrutural (G1): Ficha → Modelo de Fichário → Fichário físico.
// Funções puras de validação + consultas de apoio; as rotas só orquestram.
const mongoose = require('mongoose');
const {
  Chip, BinderModel, Binder, StackModel, Allocation, Movement,
} = require('../models');
const { escapeRegex } = require('../utils/sanitize');

/** Erro com status HTTP, capturado pelo catch das rotas. */
class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; if (details) this.details = details; }
}

/** Resposta de erro padrão: HttpError → seu status; chave duplicada → 409; validação → 400. */
function sendError(res, err) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  if (err?.code === 11000) return res.status(409).json({ error: 'Já existe um registro com esses dados.' });
  return res.status(400).json({ error: err.message });
}

// ─── Fichas ──────────────────────────────────────────────────────────────────

// Campos que o cadastro de ficha REJEITA (400): nome de modelo e quantidades pertencem ao
// Modelo de Fichário / movimentações, nunca à ficha (spec §3.1, §16, João).
// A ficha só tem VALOR NOMINAL: o nome é derivado, e qualquer campo de quantidade ou de valor monetário é recusado
// (a quantidade é saldo derivado; dinheiro nunca pertence à ficha).
const rejectedChipFields = (body) => Object.keys(body || {}).filter((f) => f === 'name' || /quantity|monet|money|price|preco|preço/i.test(f));

/** A ficha já foi usada (movimentada, em modelo de fichário, stack ou alocação)? */
async function chipInUse(chipId) {
  const checks = await Promise.all([
    Movement.exists({ chip_id: chipId }),
    BinderModel.exists({ 'composition.chip_id': chipId }),
    StackModel.exists({ 'composition.chip_id': chipId }),
    Allocation.exists({ 'chips.chip_id': chipId }),
  ]);
  return checks.some(Boolean);
}

/** Ficha ATIVA com a mesma identidade (valor + cor), se existir. */
function findChipTwin({ value, color }, excludeId) {
  const q = { value, color: color ?? null, active: { $ne: false } };
  if (excludeId) q._id = { $ne: excludeId };
  return Chip.findOne(q);
}

// ─── Composições (modelo de fichário e fichário físico) ──────────────────────

/**
 * Valida e normaliza `[{ chip_id, quantity }]`.
 * - fichas existentes, sem repetição, quantidade inteira ≥ 1 (≥ 0 se `allowZero`)
 * - fichas inativas só entram se já estavam na composição anterior (`keepIds`)
 * @returns {Promise<Array<{chip_id: string, quantity: number}>>}
 */
async function normalizeComposition(lines, { keepIds = [], allowZero = false, allowEmpty = false } = {}) {
  if (!Array.isArray(lines)) throw new HttpError(400, 'A composição deve ser uma lista de fichas.');
  const clean = [];
  const seen = new Set();
  for (const line of lines) {
    const id = String(line?.chip_id || '');
    if (!mongoose.isValidObjectId(id)) throw new HttpError(400, 'Ficha inválida na composição.');
    if (seen.has(id)) throw new HttpError(400, 'A mesma ficha não pode aparecer duas vezes na composição.');
    seen.add(id);
    const quantity = Number(line.quantity);
    const min = allowZero ? 0 : 1;
    if (!Number.isInteger(quantity) || quantity < min) {
      throw new HttpError(400, `A quantidade de cada ficha deve ser um inteiro ${allowZero ? '≥ 0' : '≥ 1'}.`);
    }
    clean.push({ chip_id: id, quantity });
  }
  if (!clean.length && !allowEmpty) throw new HttpError(400, 'Informe ao menos uma ficha na composição.');

  const chips = await Chip.find({ _id: { $in: clean.map((l) => l.chip_id) } });
  const byId = new Map(chips.map((c) => [String(c._id), c]));
  const keep = new Set(keepIds.map(String));
  for (const l of clean) {
    const chip = byId.get(l.chip_id);
    if (!chip) throw new HttpError(400, 'Ficha não encontrada na composição.');
    if (chip.active === false && !keep.has(l.chip_id)) {
      throw new HttpError(400, `A ${chip.name} está inativa e não pode ser adicionada.`);
    }
  }
  return clean;
}

// ─── Nomes / códigos únicos ──────────────────────────────────────────────────

const ci = (text) => new RegExp(`^${escapeRegex(String(text).trim())}$`, 'i');

async function assertUniqueBinderModelName(name, excludeId) {
  const q = { name: ci(name) };
  if (excludeId) q._id = { $ne: excludeId };
  if (await BinderModel.exists(q)) throw new HttpError(409, `Já existe um modelo de fichário chamado "${name}".`);
}

async function assertUniqueBinder({ name, code }, excludeId) {
  const notSelf = excludeId ? { _id: { $ne: excludeId } } : {};
  if (name && await Binder.exists({ ...notSelf, name: ci(name) })) {
    throw new HttpError(409, `Já existe um fichário chamado "${name}".`);
  }
  if (code && await Binder.exists({ ...notSelf, code: ci(code) })) {
    throw new HttpError(409, `Já existe um fichário com o código "${code}".`);
  }
}

module.exports = {
  HttpError, sendError, chipInUse, findChipTwin, normalizeComposition, rejectedChipFields,
  assertUniqueBinderModelName, assertUniqueBinder,
};
