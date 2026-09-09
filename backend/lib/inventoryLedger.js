const mongoose = require('mongoose');
const { InventoryLedger, ChipModel } = require('../models');

// Tipos que mexem no total físico vs. na reserva (fichas alocadas a torneios).
const RESERVATION_TYPES = new Set(['alocacao', 'retorno']);
function affects(type) { return RESERVATION_TYPES.has(type) ? 'reserved' : 'total'; }

/** Recalcula total/available de uma ficha a partir de TODO o seu ledger. */
async function recalcChip(chipId) {
  const rows = await InventoryLedger.aggregate([
    { $match: { chip_id: new mongoose.Types.ObjectId(String(chipId)) } },
    {
      $group: {
        _id: null,
        total: {
          $sum: { $cond: [{ $in: ['$type', ['alocacao', 'retorno']] }, 0, '$quantity'] },
        },
        reserved: {
          $sum: { $cond: [{ $in: ['$type', ['alocacao', 'retorno']] }, '$quantity', 0] },
        },
      },
    },
  ]);

  const total = Math.max(0, rows[0]?.total || 0);
  const reserved = Math.max(0, rows[0]?.reserved || 0);
  const available = Math.max(0, total - reserved);

  await ChipModel.findByIdAndUpdate(chipId, {
    total_quantity: total,
    reserved_quantity: reserved,
    available_quantity: available,
  });
  return { total, reserved, available };
}

/**
 * Registra um lançamento e mantém o cache (ChipModel) em dia.
 * @param {object} p { chip_id, type, quantity(signed), ref?, note?, user }
 */
async function recordEntry({ chip_id, type, quantity, ref, note, user }) {
  const entry = await InventoryLedger.create({
    chip_id,
    type,
    quantity: Number(quantity),
    ref: ref || { kind: 'manual', id: null },
    note,
    user_name: user?.name || user?.email || 'Sistema',
  });
  const { total } = await recalcChip(chip_id);
  entry.balance_after = total;
  await entry.save();
  return entry;
}

/** Vários lançamentos de uma vez (ex.: alocar um fichário inteiro). */
async function recordMany(entries) {
  const created = [];
  for (const e of entries) created.push(await recordEntry(e));
  return created;
}

/** Recalcula todas as fichas (migração / reparo). */
async function recalcAll() {
  const chips = await ChipModel.find().select('_id');
  for (const c of chips) await recalcChip(c._id);
  return chips.length;
}

module.exports = { recordEntry, recordMany, recalcChip, recalcAll, affects, RESERVATION_TYPES };
