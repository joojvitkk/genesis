// "Jogadores estimados" saiu do produto: o campo é arquivado (nada se perde) e removido do torneio.
module.exports = {
  async up(db) {
    for (const t of await db.collection('tournaments').find({ estimated_players: { $exists: true } }).toArray()) {
      await db.collection('archive_tournament_legacy').updateOne({ tournament_id: t._id }, { $setOnInsert: { archived_at: new Date() }, $set: { estimated_players: t.estimated_players } }, { upsert: true });
    }
    await db.collection('tournaments').updateMany({ estimated_players: { $exists: true } }, { $unset: { estimated_players: '' } });
  },
  async down(db) {
    for (const a of await db.collection('archive_tournament_legacy').find({ estimated_players: { $exists: true } }).toArray()) {
      await db.collection('tournaments').updateOne({ _id: a.tournament_id }, { $set: { estimated_players: a.estimated_players } });
    }
  },
};
