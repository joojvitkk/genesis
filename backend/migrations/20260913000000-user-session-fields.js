// P5 — campos de segurança de sessão nos usuários existentes.

module.exports = {
  async up(db) {
    await db.collection('users').updateMany(
      { session_version: { $exists: false } },
      { $set: { session_version: 1, must_change_password: false } }
    );
  },
  async down(db) {
    await db.collection('users').updateMany({}, { $unset: { session_version: '', must_change_password: '' } });
  },
};
