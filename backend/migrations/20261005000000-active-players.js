// BUG-04/05 (Relatório fase 1): inscrições e jogadores ATIVOS passam a ser números distintos.
// `actual_players` deixa de ser um contador editável/incrementado por várias telas e vira o cache de
// ativos = (buy-ins + reentradas) − eliminações. O valor anterior é arquivado (nada se perde).
module.exports = {
  async up(db) {
    const live = { status: { $ne: 'cancelled' } };
    for (const t of await db.collection('tournaments').find({}).toArray()) {
      const q = { tournament_id: t._id, ...live };
      const [initial, reentries, eliminated] = await Promise.all([
        db.collection('tournamententries').countDocuments({ ...q, type: 'buy-in' }),
        db.collection('tournamententries').countDocuments({ ...q, type: 're-entry' }),
        db.collection('eliminations').countDocuments({ ...q, position: { $gt: 1 } }),
      ]);
      await db.collection('archive_tournament_legacy').updateOne(
        { tournament_id: t._id },
        { $setOnInsert: { archived_at: new Date() }, $set: { actual_players_before_active: t.actual_players ?? 0 } },
        { upsert: true },
      );
      await db.collection('tournaments').updateOne({ _id: t._id }, { $set: {
        entries_initial: initial, entries_reentries: reentries, active_offset: 0, actual_players: Math.max(0, initial + reentries - eliminated),
      } });
    }
  },

  async down(db) {
    for (const a of await db.collection('archive_tournament_legacy').find({ actual_players_before_active: { $exists: true } }).toArray()) {
      await db.collection('tournaments').updateOne({ _id: a.tournament_id }, { $set: { actual_players: a.actual_players_before_active }, $unset: { entries_initial: '', entries_reentries: '', active_offset: '' } });
    }
  },
};
