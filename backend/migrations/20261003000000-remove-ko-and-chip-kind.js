// Decisão de produto: NÃO existe ficha KO nem "tipo" de ficha — a ficha só tem valor nominal e cor.
//   chipmodels.kind             → archive_chip_legacy, depois $unset; o índice antigo (valor, cor, tipo) é trocado por (valor, cor)
//   tournaments.ko_chip_id      → archive_tournament_legacy, depois $unset
// Se uma ficha KO ATIVA colide com outra ficha ativa de mesmo valor e cor, a KO é DESATIVADA (nada é apagado).
// Movimentos KO_SETTLE (se existirem) permanecem: o livro-razão é imutável. Idempotente; `down` restaura os campos.
async function dropIndexIfExists(coll, name) {
  try { await coll.dropIndex(name); } catch (e) { if (!/index not found|ns not found/i.test(e.message)) throw e; }
}

module.exports = {
  async up(db) {
    const chips = db.collection('chipmodels');
    await dropIndexIfExists(chips, 'chip_identity_active');

    // fichas KO ativas que colidiriam com uma ficha comum (mesmo valor e cor) ficam inativas
    const active = await chips.find({ active: { $ne: false } }).toArray();
    const seen = new Map();
    for (const c of [...active].sort((a, b) => (a.kind === 'KO') - (b.kind === 'KO'))) { // as comuns primeiro
      const k = `${c.value}|${c.color ?? ''}`;
      if (seen.has(k)) await chips.updateOne({ _id: c._id }, { $set: { active: false } });
      else seen.set(k, c._id);
    }

    for (const c of await chips.find({ kind: { $exists: true } }).toArray()) {
      await db.collection('archive_chip_legacy').updateOne({ chip_id: c._id }, { $setOnInsert: { archived_at: new Date() }, $set: { kind: c.kind } }, { upsert: true });
    }
    await chips.updateMany({ kind: { $exists: true } }, { $unset: { kind: '' } });

    // o índice novo (valor, cor) só pode nascer DEPOIS de resolver as colisões
    await chips.createIndex({ value: 1, color: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'chip_value_color_active' });

    for (const t of await db.collection('tournaments').find({ ko_chip_id: { $exists: true } }).toArray()) {
      await db.collection('archive_tournament_legacy').updateOne({ tournament_id: t._id }, { $setOnInsert: { archived_at: new Date() }, $set: { ko_chip_id: t.ko_chip_id } }, { upsert: true });
    }
    await db.collection('tournaments').updateMany({ ko_chip_id: { $exists: true } }, { $unset: { ko_chip_id: '' } });
  },

  async down(db) {
    for (const a of await db.collection('archive_chip_legacy').find({ kind: { $exists: true } }).toArray()) {
      await db.collection('chipmodels').updateOne({ _id: a.chip_id }, { $set: { kind: a.kind } });
    }
    for (const a of await db.collection('archive_tournament_legacy').find({ ko_chip_id: { $exists: true } }).toArray()) {
      await db.collection('tournaments').updateOne({ _id: a.tournament_id }, { $set: { ko_chip_id: a.ko_chip_id } });
    }
  },
};
