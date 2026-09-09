// P1 — inicializa os campos do relógio nos torneios existentes.

module.exports = {
  async up(db) {
    await db.collection('tournaments').updateMany(
      { clock_status: { $exists: false } },
      {
        $set: {
          clock_status: 'stopped',
          level_started_at: null,
          paused_at: null,
          clock_adjust_seconds: 0,
        },
      }
    );
  },

  async down(db) {
    await db.collection('tournaments').updateMany({}, {
      $unset: { clock_status: '', level_started_at: '', paused_at: '', clock_adjust_seconds: '' },
    });
  },
};
