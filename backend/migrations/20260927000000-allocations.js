// G5 — Alocação parcial: converte o modelo antigo (Tournament.allocated_cases = fichário INTEIRO, com reserva só
// ao iniciar) em `Allocation` (por denominação e quantidade, reserva desde a criação).
//
//  1. Para cada torneio ainda aberto com `allocated_cases`, cria uma Allocation por fichário (modo "binder") com o
//     saldo atual do fichário. Torneios em andamento primeiro (a reserva deles já existia); depois os agendados.
//     Se o mesmo fichário estava em mais de um torneio (o modelo antigo permitia), a quantidade de cada ficha é
//     limitada ao que ainda está LIVRE — o que não couber é descartado e registrado no log da migração.
//  2. Torneios encerrados mantêm o `allocated_cases` antigo como histórico (não geram Allocation).
//  3. Todo o ledger v1 (inclusive as reservas 'alocacao'/'retorno') vira histórico (`legacy: true`).
//  4. Reconstrói os campos derivados: Binder.allocations/status, Tournament.allocated_cases, reservado/disponível da ficha.
//
// Idempotente: pula torneios que já têm alocação aberta. As criadas levam `migrated: true`.
const RESERVATION = ['alocacao', 'retorno'];
const RUNNING = ['running', 'paused'];
const CLOSED = ['finished', 'finalized'];
const sid = (x) => String(x);

async function balancesByBinderChip(db) {
  const movements = db.collection('movements');
  const side = (s) => movements.aggregate([
    { $match: { [`${s}.kind`]: 'binder' } },
    { $group: { _id: { id: `$${s}.id`, chip: '$chip_id' }, q: { $sum: '$quantity' } } },
  ]).toArray();
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
  const allocs = await db.collection('allocations').find({ open: true }).toArray();
  const tournaments = new Map((await db.collection('tournaments').find({}).project({ name: 1, status: 1, deleted_at: 1 }).toArray()).map((t) => [sid(t._id), t]));

  // fichários
  const byBinder = new Map();
  for (const a of allocs) { const k = sid(a.binder_id); (byBinder.get(k) || byBinder.set(k, []).get(k)).push(a); }
  for (const b of await db.collection('chipcases').find({}).project({ status: 1 }).toArray()) {
    const open = (byBinder.get(sid(b._id)) || []).sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt));
    const name = (a) => tournaments.get(sid(a.tournament_id))?.name;
    await db.collection('chipcases').updateOne({ _id: b._id }, {
      $set: {
        allocations: open.map((a) => ({ tournament_id: a.tournament_id, tournament_name: name(a), chip_ids: a.chips.map((c) => c.chip_id) })),
        allocated_to_tournament: open[0] ? sid(open[0].tournament_id) : null,
        allocated_to_tournament_name: open[0] ? name(open[0]) : null,
        status: b.status === 'maintenance' ? 'maintenance' : open.length ? 'allocated' : 'available',
      },
    });
  }
  // torneios abertos: allocated_cases = fichários com alocação aberta (encerrados guardam o histórico antigo)
  const byTournament = new Map();
  for (const a of allocs) { const k = sid(a.tournament_id); (byTournament.get(k) || byTournament.set(k, []).get(k)).push(a.binder_id); }
  for (const t of tournaments.values()) {
    if (CLOSED.includes(t.status) || t.deleted_at) continue; // encerrados/excluídos guardam o histórico antigo
    await db.collection('tournaments').updateOne({ _id: t._id }, { $set: { allocated_cases: byTournament.get(sid(t._id)) || [] } });
  }
  // fichas: reservado = Σ alocações abertas
  const reserved = new Map();
  for (const a of allocs) for (const c of a.chips) reserved.set(sid(c.chip_id), (reserved.get(sid(c.chip_id)) || 0) + c.quantity);
  for (const c of await db.collection('chipmodels').find({}).project({ total_quantity: 1 }).toArray()) {
    const res = reserved.get(sid(c._id)) || 0;
    await db.collection('chipmodels').updateOne({ _id: c._id }, { $set: { reserved_quantity: res, available_quantity: (c.total_quantity || 0) - res } });
  }
}

module.exports = {
  async up(db) {
    const allocs = db.collection('allocations');
    await allocs.createIndex({ tournament_id: 1, binder_id: 1 }, { unique: true, partialFilterExpression: { open: true }, name: 'allocation_open_once' });

    const balances = await balancesByBinderChip(db);
    const held = new Map(); // "binder:chip" -> já alocado
    for (const a of await allocs.find({ open: true }).toArray()) for (const c of a.chips) held.set(`${a.binder_id}:${c.chip_id}`, (held.get(`${a.binder_id}:${c.chip_id}`) || 0) + c.quantity);

    const live = new Set((await db.collection('chipcases').find({ deleted_at: null }).project({ _id: 1 }).toArray()).map((b) => sid(b._id)));
    const tournaments = (await db.collection('tournaments').find({ deleted_at: null, allocated_cases: { $exists: true, $ne: [] } }).toArray())
      .filter((t) => !CLOSED.includes(t.status))
      .sort((a, b) => (RUNNING.includes(b.status) ? 1 : 0) - (RUNNING.includes(a.status) ? 1 : 0) || new Date(a.starts_at || a.date) - new Date(b.starts_at || b.date));

    const now = new Date();
    for (const t of tournaments) {
      if (await allocs.countDocuments({ tournament_id: t._id, open: true })) continue;
      for (const binderId of t.allocated_cases) {
        if (!live.has(sid(binderId))) { console.warn(`[G5] "${t.name}": fichário ${sid(binderId)} não existe mais — ignorado`); continue; }
        const chips = []; let dropped = 0;
        for (const r of balances.filter((x) => sid(x.binder) === sid(binderId) && x.q > 0)) {
          const k = `${binderId}:${r.chip}`;
          const q = Math.min(r.q, r.q - (held.get(k) || 0));
          if (q > 0) { chips.push({ chip_id: r.chip, quantity: q }); held.set(k, (held.get(k) || 0) + q); }
          if (q < r.q) dropped += r.q - Math.max(q, 0);
        }
        if (!chips.length) { console.warn(`[G5] "${t.name}": fichário ${sid(binderId)} sem saldo livre (já alocado a outro torneio) — vínculo descartado`); continue; }
        if (dropped) console.warn(`[G5] "${t.name}": fichário ${sid(binderId)} estava em mais de um torneio; ${dropped} ficha(s) já alocadas a outro foram descartadas desta alocação`);
        await allocs.insertOne({
          tournament_id: t._id, binder_id: binderId, mode: 'binder', chips,
          status: RUNNING.includes(t.status) ? 'active' : 'planned', open: true,
          note: `Migrada do modelo anterior (fichário inteiro)${dropped ? ` — ${dropped} ficha(s) descartadas por conflito` : ''}`,
          created_by: 'Migração G5', migrated: true, released_at: null, createdAt: now, updatedAt: now, __v: 0,
        });
      }
    }

    await db.collection('inventoryledgers').updateMany({}, { $set: { legacy: true } });
    await rebuildCaches(db);
  },

  async down(db) {
    await db.collection('allocations').deleteMany({ migrated: true });
    await db.collection('inventoryledgers').updateMany({ type: { $in: RESERVATION } }, { $unset: { legacy: '' } });
    await rebuildCaches(db);
    // volta a reserva das fichas para o que o ledger v1 diz
    const reserved = new Map((await db.collection('inventoryledgers').aggregate([
      { $match: { type: { $in: RESERVATION } } }, { $group: { _id: '$chip_id', q: { $sum: '$quantity' } } },
    ]).toArray()).map((r) => [sid(r._id), r.q]));
    for (const c of await db.collection('chipmodels').find({}).project({ total_quantity: 1 }).toArray()) {
      const res = reserved.get(sid(c._id)) || 0;
      await db.collection('chipmodels').updateOne({ _id: c._id }, { $set: { reserved_quantity: res, available_quantity: (c.total_quantity || 0) - res } });
    }
  },
};
