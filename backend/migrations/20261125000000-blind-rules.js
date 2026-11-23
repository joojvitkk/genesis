// Regras de duração dos blinds e registro das mudanças (Salão item 6): coleções novas e índices. Idempotente e segura para dados existentes.
module.exports = {
  async up(db) {
    const have = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ['blindrules', 'blindchanges']) if (!have.has(name)) await db.createCollection(name);
    await db.collection('blindrules').createIndex({ tournament_id: 1 });
    await db.collection('blindchanges').createIndex({ session_id: 1, at: -1 });
  },
  async down() { /* mantém os dados */ },
};
