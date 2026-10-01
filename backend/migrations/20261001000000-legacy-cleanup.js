// G11 — limpeza do legado. NADA é apagado sem cópia: o que o sistema deixou de usar é ARQUIVADO em coleções `archive_*`
// e só então removido dos documentos vivos.
//
//   inventoryledgers → archive_inventoryledgers        (ledger v1, histórico congelado)
//   chipraces        → archive_chipraces               (calculadora antiga; já virou Conversion `legacy` no G6)
//   chipmodels       : total/reserved/available/initial_quantity e legacy_name → archive_chip_legacy, depois $unset
//   chipcases        : chips, allocations, allocated_to_tournament(_name)      → archive_binder_legacy, depois $unset
//   tournaments      : allocated_cases, stack_composition                      → archive_tournament_legacy, depois $unset
//
// As coleções originais `inventoryledgers` e `chipraces` NÃO são tocadas (o admin pode descartá-las depois de conferir os
// arquivos). Idempotente (arquiva por `_id`/`source_id` uma única vez). `down` restaura os campos a partir dos arquivos.
const CHIP_FIELDS = ['total_quantity', 'reserved_quantity', 'available_quantity', 'initial_quantity', 'legacy_name'];
const BINDER_FIELDS = ['chips', 'allocations', 'allocated_to_tournament', 'allocated_to_tournament_name'];
const TOURNAMENT_FIELDS = ['allocated_cases', 'stack_composition'];

async function copyCollection(db, from, to) {
  if (!(await db.listCollections({ name: from }).hasNext())) return 0;
  const target = db.collection(to);
  let n = 0;
  for (const doc of await db.collection(from).find({}).toArray()) {
    if (await target.countDocuments({ _id: doc._id })) continue;
    await target.insertOne(doc);
    n += 1;
  }
  return n;
}

/** Arquiva os campos legados de cada documento e os remove do original. */
async function archiveFields(db, collection, archive, fields, key) {
  const has = { $or: fields.map((f) => ({ [f]: { $exists: true } })) };
  for (const doc of await db.collection(collection).find(has).toArray()) {
    if (!(await db.collection(archive).countDocuments({ [key]: doc._id }))) {
      const saved = Object.fromEntries(fields.filter((f) => doc[f] !== undefined).map((f) => [f, doc[f]]));
      await db.collection(archive).insertOne({ [key]: doc._id, ...saved, archived_at: new Date() });
    }
  }
  await db.collection(collection).updateMany(has, { $unset: Object.fromEntries(fields.map((f) => [f, ''])) });
}

module.exports = {
  async up(db) {
    await copyCollection(db, 'inventoryledgers', 'archive_inventoryledgers');
    await copyCollection(db, 'chipraces', 'archive_chipraces');
    await archiveFields(db, 'chipmodels', 'archive_chip_legacy', CHIP_FIELDS, 'chip_id');
    await archiveFields(db, 'chipcases', 'archive_binder_legacy', BINDER_FIELDS, 'binder_id');
    await archiveFields(db, 'tournaments', 'archive_tournament_legacy', TOURNAMENT_FIELDS, 'tournament_id');
  },

  async down(db) {
    for (const [collection, archive, key, fields] of [
      ['chipmodels', 'archive_chip_legacy', 'chip_id', CHIP_FIELDS],
      ['chipcases', 'archive_binder_legacy', 'binder_id', BINDER_FIELDS],
      ['tournaments', 'archive_tournament_legacy', 'tournament_id', TOURNAMENT_FIELDS],
    ]) {
      for (const a of await db.collection(archive).find({}).toArray()) {
        const set = Object.fromEntries(fields.filter((f) => a[f] !== undefined).map((f) => [f, a[f]]));
        if (Object.keys(set).length) await db.collection(collection).updateOne({ _id: a[key] }, { $set: set });
      }
    }
  },
};
