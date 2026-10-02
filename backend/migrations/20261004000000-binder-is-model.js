// Decisão de produto: o Modelo de Fichário É o fichário (1 modelo = 1 fichário); não se geram várias unidades.
//   - todo modelo ativo sem fichário ganha o seu (vazio: o livro-razão é imutável, nada é montado aqui);
//   - modelo com VÁRIOS fichários: o primeiro (o de maior saldo/mais antigo) permanece; os demais VAZIOS são arquivados
//     (soft delete). Os que ainda têm fichas ficam intactos e são listados em `archive_binder_extra_units` para
//     o admin esvaziar/transferir — a migração não mexe em saldo.
// Idempotente. `down` não restaura nada (os fichários arquivados continuam recuperáveis pelo deleted_at).
module.exports = {
  async up(db) {
    const modelColl = (await db.listCollections({ name: 'bindermodels' }).toArray()).length ? db.collection('bindermodels') : db.collection('binder_models');
    const binders = db.collection('chipcases');
    const movements = db.collection('movements');
    const archive = db.collection('archive_binder_extra_units');

    const balanceOf = async (binderId) => {
      const [inn] = await movements.aggregate([{ $match: { 'to.kind': 'binder', 'to.id': binderId } }, { $group: { _id: null, n: { $sum: '$quantity' } } }]).toArray();
      const [out] = await movements.aggregate([{ $match: { 'from.kind': 'binder', 'from.id': binderId } }, { $group: { _id: null, n: { $sum: '$quantity' } } }]).toArray();
      return (inn?.n || 0) - (out?.n || 0);
    };

    for (const model of await modelColl.find({ deleted_at: null }).toArray()) {
      const units = await binders.find({ model_id: model._id, deleted_at: null }).sort({ createdAt: 1 }).toArray();
      if (!units.length) {
        const now = new Date();
        await binders.insertOne({ name: model.name, model_id: model._id, status: 'available', deleted_at: null, createdAt: now, updatedAt: now, __v: 0 });
        continue;
      }
      // mantém o que tem mais fichas (empate: o mais antigo)
      const withBal = await Promise.all(units.map(async (u) => ({ u, bal: await balanceOf(u._id) })));
      const keep = withBal.reduce((a, b) => (b.bal > a.bal ? b : a));
      await binders.updateOne({ _id: keep.u._id }, { $set: { name: model.name } });
      for (const { u, bal } of withBal) {
        if (u._id.equals(keep.u._id)) continue;
        if (bal === 0) await binders.updateOne({ _id: u._id }, { $set: { deleted_at: new Date() } });
        else await archive.updateOne({ binder_id: u._id }, { $setOnInsert: { model_id: model._id, balance: bal, flagged_at: new Date() } }, { upsert: true });
      }
    }
  },
  async down() { /* sem reversão: nada foi apagado de fato */ },
};
