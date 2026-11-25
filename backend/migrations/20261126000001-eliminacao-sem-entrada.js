// Eliminação sem entrada própria (fases herdadas) e fim da gravação de prêmios.
//  • o índice único "uma entrada só é eliminada uma vez" passa a ignorar eliminações sem entrada (entry_id nulo);
//  • remove `prize_awarded` das eliminações (o sistema não tem nada que envolva dinheiro).
// Idempotente e segura para os dados existentes.
module.exports = {
  async up(db) {
    const col = db.collection('eliminations');
    try { await col.dropIndex('elimination_entry_active_once'); } catch (e) { if (!/index not found|ns not found/i.test(String(e.message))) throw e; }
    await col.createIndex({ entry_id: 1 }, { unique: true, name: 'elimination_entry_active_once_v2', partialFilterExpression: { status: 'active', entry_id: { $type: 'objectId' } } });
    await col.updateMany({ prize_awarded: { $exists: true } }, { $unset: { prize_awarded: '' } });
  },
  async down(db) {
    const col = db.collection('eliminations');
    try { await col.dropIndex('elimination_entry_active_once_v2'); } catch { /* já removido */ }
    await col.createIndex({ entry_id: 1 }, { unique: true, name: 'elimination_entry_active_once', partialFilterExpression: { status: 'active' } });
  },
};
