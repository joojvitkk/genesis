// P2 — inicializa os campos financeiros nos torneios existentes.

module.exports = {
  async up(db) {
    await db.collection('tournaments').updateMany(
      { buy_in: { $exists: false } },
      {
        $set: {
          buy_in: 0, rake: 0, addon_value: 0, addon_chips: 0,
          bounty_value: 0, payout_template_id: null, finalized_at: null,
        },
      }
    );
  },

  async down(db) {
    await db.collection('tournaments').updateMany({}, {
      $unset: {
        buy_in: '', rake: '', addon_value: '', addon_chips: '',
        bounty_value: '', payout_template_id: '', finalized_at: '',
      },
    });
  },
};
