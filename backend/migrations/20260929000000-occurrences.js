// G8 — perdas lançadas ANTES das ocorrências (movimentos LOSS sem `meta.occurrence_id`) ganham uma Ocorrência
// `legacy`, para não ficarem invisíveis nas divergências. Não cria nem altera movimentos (imutáveis): o vínculo é
// `legacy_movement_id`. Perdas já estornadas são ignoradas. A severidade usa o semáforo PADRÃO (faixas por valor; KO = vermelho).
// Idempotente (índice único por `legacy_movement_id`), com `down`.
const BANDS = [{ up_to: 500, level: 'GREEN' }, { up_to: 1000, level: 'YELLOW' }, { up_to: null, level: 'RED' }]; // = lib/settings DEFAULTS

const severityOf = (chip) => {
  if (chip?.kind === 'KO') return { level: 'RED', reason: 'ko' };
  const value = Number(chip?.value) || 0;
  const band = BANDS.find((b) => b.up_to === null || value <= b.up_to);
  return { level: band ? band.level : 'RED', reason: 'band' };
};

module.exports = {
  async up(db) {
    const occurrences = db.collection('occurrences');
    await occurrences.createIndex({ legacy_movement_id: 1 }, { unique: true, partialFilterExpression: { legacy_movement_id: { $type: 'objectId' } }, name: 'occurrence_legacy_once' });

    const reversed = new Set((await db.collection('movements').find({ type: 'REVERSAL' }).project({ reverses: 1 }).toArray()).map((r) => String(r.reverses)));
    const chips = new Map((await db.collection('chipmodels').find({}).project({ value: 1, kind: 1 }).toArray()).map((c) => [String(c._id), c]));
    const losses = await db.collection('movements').find({ type: 'LOSS', 'meta.occurrence_id': { $exists: false } }).sort({ createdAt: 1 }).toArray();

    for (const m of losses) {
      if (reversed.has(String(m._id))) continue;
      if (await occurrences.countDocuments({ legacy_movement_id: m._id })) continue;
      const sev = severityOf(chips.get(String(m.chip_id)));
      const count = m.meta?.count;
      const fromPlay = m.from?.kind === 'play';
      await occurrences.insertOne({
        kind: 'LOSS', scope: fromPlay ? 'tournament' : 'binder', chip_id: m.chip_id,
        binder_id: fromPlay ? null : (m.binder_id || m.from?.id || null), tournament_id: fromPlay ? m.from.id : null, session_id: m.session_id || null,
        expected: count?.expected ?? null, counted: count?.counted ?? null,
        diff: -m.quantity, quantity: m.quantity,
        severity: sev.level, severity_reason: sev.reason,
        status: m.reason ? 'justified' : 'open', justification: m.reason || undefined,
        source: 'legacy', legacy_movement_id: m._id, movement_batch_id: m.batch_id,
        recovered_quantity: 0, user_id: m.user_id || null, user_name: m.user_name || 'Sistema',
        history: [{ at: m.createdAt || new Date(), action: 'opened', user_id: m.user_id || null, user_name: m.user_name || 'Sistema', quantity: m.quantity, note: 'Perda registrada antes do módulo de ocorrências (migração G8)', batch_id: m.batch_id }],
        createdAt: m.createdAt || new Date(), updatedAt: new Date(), __v: 0,
      });
    }
  },

  async down(db) {
    await db.collection('occurrences').deleteMany({ source: 'legacy' });
  },
};
