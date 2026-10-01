// G6 — Chip Race / Color Up: a calculadora antiga (ChipRace, 1 ficha → 1 ficha, sem movimentação, editável)
// vira histórico em `Conversion` (`legacy: true`): sem movimentos, nunca altera saldo nem fichas em jogo.
// A coleção `chipraces` NÃO é tocada (segue lida por GET /chip-races). Idempotente (`legacy_id` único).
const sid = (x) => String(x);

module.exports = {
  async up(db) {
    const conversions = db.collection('conversions');
    await conversions.createIndex({ legacy_id: 1 }, { unique: true, partialFilterExpression: { legacy_id: { $type: 'objectId' } }, name: 'conversion_legacy_once' });

    const value = new Map((await db.collection('chipmodels').find({}).project({ value: 1 }).toArray()).map((c) => [sid(c._id), c.value || 0]));
    for (const r of await db.collection('chipraces').find({}).toArray()) {
      if (await conversions.countDocuments({ legacy_id: r._id })) continue;
      const valueOut = r.total_value ?? (r.from_quantity || 0) * (value.get(sid(r.from_chip)) || 0);
      const valueIn = (r.to_quantity || 0) * (value.get(sid(r.to_chip)) || 0);
      const cancelled = r.status === 'cancelled';
      await conversions.insertOne({
        tournament_id: r.tournament_id, session_id: null, type: r.type === 'color-up' ? 'COLOR_UP' : 'CHIP_RACE',
        outs: [{ chip_id: r.from_chip, quantity: r.from_quantity || 0 }], ins: [{ chip_id: r.to_chip, quantity: r.to_quantity || 0 }],
        value_out: valueOut, value_in: valueIn, math_breakage: valueIn - valueOut,
        binder_id: null, movement_batch_id: null,
        status: cancelled ? 'reversed' : 'active',
        note: 'Registro do modelo anterior (calculadora, sem movimentação de fichas)',
        user_name: 'Migração G6',
        reversed_at: cancelled ? r.updatedAt || new Date() : null,
        reverse_reason: cancelled ? 'Cancelado no modelo anterior (torneio excluído)' : undefined,
        legacy: true, legacy_id: r._id,
        legacy_meta: { active_tables: r.active_tables, num_players: r.num_players, chips_per_player: r.chips_per_player },
        createdAt: r.createdAt || new Date(), updatedAt: r.updatedAt || new Date(), __v: 0,
      });
    }
  },

  async down(db) {
    await db.collection('conversions').deleteMany({ legacy: true });
  },
};
