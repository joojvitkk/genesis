// G2 — saldos de abertura no motor de movimentações.
//
//  1. Cada fichário ATIVO com fichas em `chips[]` (composição legada) recebe um lote de ASSEMBLY
//     de abertura (externo → fichário) com essas quantidades — o fichário é a verdade física.
//  2. O que o ledger v1 diz que existe (Σ lançamentos de estoque) e NÃO está em nenhum fichário vai
//     para o fichário "LEGADO" (D5), que o admin redistribui depois. Se os fichários somarem MAIS que
//     o ledger v1 (dupla contabilização — ver scripts/audit-legacy-chips.js), vale o fichário.
//  3. Os lançamentos v1 de estoque viram histórico congelado (`legacy: true`); as reservas de torneio
//     ('alocacao'/'retorno') continuam vivas até o G5.
//  4. Reconstrói os caches derivados (Binder.chips, Chip.total/reserved/available).
//
// Idempotente: se já existem movimentos de migração, não faz nada. Todos os movimentos criados levam
// meta.migration = 'g2-opening'.

const MARK = 'g2-opening';
const RESERVATION = ['alocacao', 'retorno'];
const LEGACY_CODE = 'LEGADO';

const sid = (x) => String(x);

async function balancesByBinderChip(db) {
  const movements = db.collection('movements');
  const side = async (s) => (await movements.aggregate([
    { $match: { [`${s}.kind`]: 'binder' } },
    { $group: { _id: { id: `$${s}.id`, chip: '$chip_id' }, q: { $sum: '$quantity' } } },
  ]).toArray());
  const map = new Map();
  for (const r of await side('to')) map.set(`${r._id.id}:${r._id.chip}`, { binder: r._id.id, chip: r._id.chip, q: r.q });
  for (const r of await side('from')) {
    const k = `${r._id.id}:${r._id.chip}`;
    const cur = map.get(k) || { binder: r._id.id, chip: r._id.chip, q: 0 };
    cur.q -= r.q;
    map.set(k, cur);
  }
  return [...map.values()];
}

async function rebuildCaches(db) {
  const rows = (await balancesByBinderChip(db)).filter((r) => r.q > 0);
  const byBinder = new Map();
  const totalByChip = new Map();
  for (const r of rows) {
    if (!byBinder.has(sid(r.binder))) byBinder.set(sid(r.binder), []);
    byBinder.get(sid(r.binder)).push({ chip_id: r.chip, quantity: r.q });
    totalByChip.set(sid(r.chip), (totalByChip.get(sid(r.chip)) || 0) + r.q);
  }
  for (const b of await db.collection('chipcases').find({}).project({ _id: 1 }).toArray()) {
    await db.collection('chipcases').updateOne({ _id: b._id }, { $set: { chips: byBinder.get(sid(b._id)) || [] } });
  }
  const reserved = new Map((await db.collection('inventoryledgers').aggregate([
    { $match: { type: { $in: RESERVATION } } },
    { $group: { _id: '$chip_id', q: { $sum: '$quantity' } } },
  ]).toArray()).map((r) => [sid(r._id), r.q]));
  for (const c of await db.collection('chipmodels').find({}).project({ _id: 1 }).toArray()) {
    const total = totalByChip.get(sid(c._id)) || 0;
    const res = reserved.get(sid(c._id)) || 0;
    await db.collection('chipmodels').updateOne({ _id: c._id }, { $set: { total_quantity: total, reserved_quantity: res, available_quantity: total - res } });
  }
}

module.exports = {
  async up(db) {
    const movements = db.collection('movements');
    if (await movements.countDocuments({ 'meta.migration': MARK }) > 0) return; // já migrado

    const now = new Date();
    const docs = [];
    const mk = (binderId, chipId, quantity, batchId, reason) => ({
      type: 'ASSEMBLY', chip_id: chipId, quantity,
      from: { kind: 'external', id: null }, to: { kind: 'binder', id: binderId }, binder_id: binderId,
      tournament_id: null, session_id: null, user_id: null, user_name: 'Migração G2',
      reason, reverses: null, batch_id: batchId, meta: { migration: MARK },
      createdAt: now, __v: 0,
    });

    // 1) composição atual de cada fichário ativo
    const binders = await db.collection('chipcases').find({ deleted_at: null }).toArray();
    const chipDocs = new Map((await db.collection('chipmodels').find({}).toArray()).map((c) => [sid(c._id), c]));
    const inBinders = new Map(); // chipId -> Σ nos fichários
    for (const b of binders) {
      const batchId = b._id; // um lote por fichário (o id do fichário serve de batch_id)
      const byChip = new Map();
      for (const l of b.chips || []) {
        if (!l.chip_id || !chipDocs.has(sid(l.chip_id)) || !(l.quantity > 0)) continue;
        byChip.set(sid(l.chip_id), (byChip.get(sid(l.chip_id)) || 0) + Math.floor(l.quantity));
      }
      for (const [chipId, q] of byChip) {
        docs.push(mk(b._id, chipDocs.get(chipId)._id, q, batchId, `Saldo de abertura — composição do fichário "${b.name}" antes do G2`));
        inBinders.set(chipId, (inBinders.get(chipId) || 0) + q);
      }
    }

    // 2) sobra do ledger v1 que não está em nenhum fichário → LEGADO
    const v1 = await db.collection('inventoryledgers').aggregate([
      { $match: { type: { $nin: RESERVATION } } },
      { $group: { _id: '$chip_id', q: { $sum: '$quantity' } } },
    ]).toArray();
    const leftovers = v1.map((r) => ({ chip: chipDocs.get(sid(r._id)), q: Math.max(0, r.q) - (inBinders.get(sid(r._id)) || 0) }))
      .filter((r) => r.chip && !r.chip.deleted_at && r.q > 0);
    if (leftovers.length) {
      let legacy = await db.collection('chipcases').findOne({ code: LEGACY_CODE, deleted_at: null });
      if (!legacy) {
        const { insertedId } = await db.collection('chipcases').insertOne({
          name: 'LEGADO (estoque sem fichário)', code: LEGACY_CODE, status: 'available', model_id: null, chips: [],
          allocations: [], deleted_at: null, createdAt: now, updatedAt: now, __v: 0,
        });
        legacy = { _id: insertedId, name: 'LEGADO (estoque sem fichário)' };
      }
      for (const r of leftovers) {
        docs.push(mk(legacy._id, r.chip._id, r.q, legacy._id, 'Estoque do ledger v1 que não estava em nenhum fichário — redistribuir'));
      }
    }

    if (docs.length) await movements.insertMany(docs);

    // 3) v1 de estoque vira histórico congelado
    await db.collection('inventoryledgers').updateMany({ type: { $nin: RESERVATION } }, { $set: { legacy: true } });

    // 4) caches derivados
    await rebuildCaches(db);
  },

  async down(db) {
    // Remove os movimentos de migração e o fichário LEGADO (se vazio de outros movimentos), desfaz a flag
    // e reconstrói os caches. Movimentos posteriores à migração NÃO são tocados (nem podem ser: imutáveis
    // no app) — se existirem, prefira restaurar o backup.
    const movements = db.collection('movements');
    await movements.deleteMany({ 'meta.migration': MARK });
    const legacy = await db.collection('chipcases').findOne({ code: LEGACY_CODE });
    if (legacy && !(await movements.countDocuments({ binder_id: legacy._id }))) {
      await db.collection('chipcases').deleteOne({ _id: legacy._id });
    }
    await db.collection('inventoryledgers').updateMany({ legacy: true }, { $unset: { legacy: '' } });
    await rebuildCaches(db);
  },

  _internals: { rebuildCaches },
};
