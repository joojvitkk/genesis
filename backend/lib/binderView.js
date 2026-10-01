// Apresentação do fichário (G11): o que as telas leem — conteúdo, alocações e situação — é DERIVADO na hora
// dos movimentos e das alocações abertas. Nada disso é gravado no fichário (não há mais cache).
const { Chip, Allocation, Tournament } = require('../models');
const mv = require('./movements');

/**
 * @param {Array<import('mongoose').Document>} binders  fichários (com `model_id` já populado, se quiserem)
 * @returns plain objects: { ...binder, chips: [{ chip_id: <ficha>, quantity }], allocations: [{ tournament_id, tournament_name, chip_ids }], status }
 */
async function present(binders) {
  if (!binders.length) return [];
  const ids = binders.map((b) => b._id);
  const [rows, allocs] = await Promise.all([
    mv.balances({ kind: 'binder' }).then((r) => r.filter((x) => ids.some((id) => String(id) === String(x.binder_id)))),
    Allocation.find({ binder_id: { $in: ids }, open: true }).sort({ createdAt: 1 }).lean(),
  ]);
  const [chips, tournaments] = await Promise.all([
    Chip.find({ _id: { $in: [...new Set(rows.map((r) => String(r.chip_id)))] } }).setOptions({ withDeleted: true }).select('name value color').lean(),
    Tournament.find({ _id: { $in: [...new Set(allocs.map((a) => String(a.tournament_id)))] } }).setOptions({ withDeleted: true }).select('name').lean(),
  ]);
  const chipById = new Map(chips.map((c) => [String(c._id), c]));
  const tName = new Map(tournaments.map((t) => [String(t._id), t.name]));

  return binders.map((b) => {
    const o = b.toObject ? b.toObject() : { ...b };
    const mine = rows.filter((r) => String(r.binder_id) === String(b._id) && r.quantity > 0);
    const open = allocs.filter((a) => String(a.binder_id) === String(b._id));
    o.chips = mine.map((r) => ({ chip_id: chipById.get(String(r.chip_id)) || { _id: r.chip_id }, quantity: r.quantity }))
      .sort((x, y) => (x.chip_id.value ?? 0) - (y.chip_id.value ?? 0));
    o.allocations = open.map((a) => ({ tournament_id: a.tournament_id, tournament_name: tName.get(String(a.tournament_id)), chip_ids: a.chips.map((c) => c.chip_id) }));
    o.status = b.status === 'maintenance' ? 'maintenance' : open.length ? 'allocated' : 'available';
    return o;
  });
}

async function presentOne(binder) {
  return (await present([binder]))[0];
}

module.exports = { present, presentOne };
