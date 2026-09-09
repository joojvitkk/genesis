// P4 — define seats_per_table nos torneios existentes.

module.exports = {
  async up(db) {
    await db.collection('tournaments').updateMany(
      { seats_per_table: { $exists: false } },
      { $set: { seats_per_table: 9 } }
    );
  },
  async down(db) {
    await db.collection('tournaments').updateMany({}, { $unset: { seats_per_table: '' } });
  },
};
