// Remove o índice único legado `username_1` da coleção `users`.
// O schema migrou de `username` para `email` e o índice órfão quebrava a
// criação de novos usuários (duplicate key em username: null).
// Substitui o antigo script backend/scripts/fix_user_indexes.js.

module.exports = {
  async up(db) {
    const users = db.collection('users');
    const indexes = await users.indexes();
    if (indexes.some((ix) => ix.name === 'username_1')) {
      await users.dropIndex('username_1');
      // eslint-disable-next-line no-console
      console.log('  dropped index users.username_1');
    }
    // Remove o campo residual, se existir
    await users.updateMany({ username: { $exists: true } }, { $unset: { username: '' } });
  },

  async down() {
    // Sem rollback: o índice legado não deve voltar.
  },
};
