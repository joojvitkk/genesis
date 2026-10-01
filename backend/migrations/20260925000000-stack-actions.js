// G3 — Modelos de Stack por ação.
//
//  1. StackModel: a composição antiga `[{ chip_id, quantity }]` vira a coluna `buy_in`
//     (`[{ chip_id, quantities: { buy_in: quantity } }]`), com as colunas padrão (buy-in padrão,
//     buy-in opcional, reentrada). O `total_value` gravado sai: agora é derivado.
//  2. TournamentEntry: recebe a `action` derivada do tipo (buy-in→buy_in, re-entry→re_entry, add-on→add_on).
//     O `stack_model_id` antigo da entrada é mantido e continua honrado no cálculo.
//  3. Tournament: `stack_models` = [] (o `stack_model_id` existente segue como modelo padrão).
//     `chips_value_in_play` fica nulo até a próxima entrada/edição recalculá-lo (o relógio cai no
//     cálculo antigo enquanto isso).
//
// Idempotente: só toca o que ainda está no formato antigo.

const DEFAULT_ACTIONS = [
  { key: 'buy_in', label: 'Buy-in padrão' },
  { key: 'optional_buy_in', label: 'Buy-in opcional' },
  { key: 're_entry', label: 'Reentrada' },
];
const ACTION_BY_TYPE = { 'buy-in': 'buy_in', 're-entry': 're_entry', 'add-on': 'add_on' };

module.exports = {
  async up(db) {
    const stacks = db.collection('stackmodels');
    for (const s of await stacks.find({}).toArray()) {
      const legacy = (s.composition || []).some((l) => l.quantities === undefined);
      if (!legacy && Array.isArray(s.actions) && s.actions.length && s.total_value === undefined) continue;
      const composition = (s.composition || []).map((l) => (
        l.quantities !== undefined ? { chip_id: l.chip_id, quantities: l.quantities } : { chip_id: l.chip_id, quantities: l.quantity > 0 ? { buy_in: l.quantity } : {} }
      ));
      await stacks.updateOne(
        { _id: s._id },
        {
          $set: { composition, actions: Array.isArray(s.actions) && s.actions.length ? s.actions : DEFAULT_ACTIONS },
          $unset: { total_value: '' },
        },
      );
    }

    for (const [type, action] of Object.entries(ACTION_BY_TYPE)) {
      await db.collection('tournamententries').updateMany(
        { type, $or: [{ action: { $exists: false } }, { action: null }] },
        { $set: { action } },
      );
    }

    await db.collection('tournaments').updateMany({ stack_models: { $exists: false } }, { $set: { stack_models: [] } });
  },

  async down(db) {
    // volta ao formato de uma coluna só (usa `buy_in`); as demais colunas se perdem — prefira o backup.
    for (const s of await db.collection('stackmodels').find({}).toArray()) {
      const composition = (s.composition || [])
        .map((l) => ({ chip_id: l.chip_id, quantity: (l.quantities || {}).buy_in || 0 }))
        .filter((l) => l.quantity > 0);
      await db.collection('stackmodels').updateOne({ _id: s._id }, { $set: { composition }, $unset: { actions: '' } });
    }
    await db.collection('tournamententries').updateMany({}, { $unset: { action: '' } });
    await db.collection('tournaments').updateMany({}, { $unset: { stack_models: '', chips_value_in_play: '' } });
  },
};
