// Material (contagem de fim de dia) e Salão (registro por nível, idempotência): coleções novas e seus índices.
// Seguro para dados existentes: só cria coleções/índices (idempotente). Sessões antigas ficam sem registro por nível
// ("sem histórico"): o relógio em andamento passa a ter o registro criado pelo reconcile.
module.exports = {
  async up(db) {
    const have = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ['sessioncounts', 'sessionlevellogs', 'idempotencykeys']) if (!have.has(name)) await db.createCollection(name);
    await db.collection('sessioncounts').createIndex({ tournament_id: 1, session_id: 1, status: 1, createdAt: -1 });
    await db.collection('sessionlevellogs').createIndex({ session_id: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'open' } });
    await db.collection('sessionlevellogs').createIndex({ session_id: 1, seq: 1 }, { unique: true });
    await db.collection('sessionlevellogs').createIndex({ tournament_id: 1, session_id: 1 });
    await db.collection('idempotencykeys').createIndex({ user_id: 1, key: 1 }, { unique: true });
    await db.collection('idempotencykeys').createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
  },
  async down() { /* mantém os dados: coleções e índices novos são inofensivos */ },
};
