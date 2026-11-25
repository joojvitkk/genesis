// Tipo "Dia Único" (SINGLE): torneio com uma só sessão classificatória passa a Dia Único (fichas próprias, sem classificados).
// Idempotente; não mexe em torneios com mais de uma sessão nem em sessões de continuação/final.
module.exports = {
  async up(db) {
    const sessions = db.collection('tournamentsessions');
    const groups = await sessions.aggregate([
      { $match: { deleted_at: null } },
      { $group: { _id: '$tournament_id', n: { $sum: 1 }, ids: { $push: '$_id' }, types: { $push: '$type' } } },
      { $match: { n: 1 } },
    ]).toArray();
    for (const g of groups) {
      if (g.types[0] === 'QUALIFIER') await sessions.updateOne({ _id: g.ids[0] }, { $set: { type: 'SINGLE' } });
    }
  },
  async down(db) {
    await db.collection('tournamentsessions').updateMany({ type: 'SINGLE' }, { $set: { type: 'QUALIFIER' } });
  },
};
