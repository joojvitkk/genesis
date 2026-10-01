// G4 — Evento → Torneio → Sessões/Fases.
//
//  1. Seat: descarta os índices únicos antigos (por torneio) e cria os por SESSÃO — cada sessão tem as suas mesas.
//  2. Cada torneio ativo sem sessão ganha a sessão "Dia Único" (status conforme o torneio); as entradas
//     e os lugares (Seat) desse torneio passam a apontar para ela.
//  3. Torneios sem evento entram no evento "Legado".
//
// Idempotente: só toca o que ainda não tem sessão/evento. `meta`: as sessões criadas levam `migrated_g4: true`.
const OLD_SEAT_INDEXES = ['tournament_id_1_table_number_1_seat_number_1', 'tournament_id_1_player_id_1'];
const STATUS = { running: 'running', paused: 'running', finished: 'finished', finalized: 'finished' };

module.exports = {
  async up(db) {
    const seats = db.collection('seats');
    for (const name of OLD_SEAT_INDEXES) { try { await seats.dropIndex(name); } catch { /* já removido / coleção nova */ } }
    await seats.createIndex({ tournament_id: 1, session_id: 1, table_number: 1, seat_number: 1 }, { unique: true });
    await seats.createIndex({ tournament_id: 1, session_id: 1, player_id: 1 }, { unique: true });

    const now = new Date();
    const sessions = db.collection('tournamentsessions');
    const tournaments = await db.collection('tournaments').find({ deleted_at: null }).toArray();

    for (const t of tournaments) {
      const existing = await sessions.find({ tournament_id: t._id, deleted_at: null }).toArray();
      let target = existing.length === 1 ? existing[0]._id : null;
      if (!existing.length) {
        const status = STATUS[t.status] || 'scheduled';
        const { insertedId } = await sessions.insertOne({
          tournament_id: t._id, name: 'Dia Único', order: 1, starts_at: t.starts_at || t.date || null, status,
          started_at: status === 'scheduled' ? null : t.level_started_at || now,
          finished_at: status === 'finished' ? t.finalized_at || now : null,
          deleted_at: null, migrated_g4: true, createdAt: now, updatedAt: now, __v: 0,
        });
        target = insertedId;
      }
      if (target) { // 1 sessão: nada fica "sem sessão"
        await db.collection('tournamententries').updateMany({ tournament_id: t._id, session_id: null }, { $set: { session_id: target } });
        await seats.updateMany({ tournament_id: t._id, session_id: null }, { $set: { session_id: target } });
      }
    }

    // torneios sem evento → "Legado"
    const orphans = await db.collection('tournaments').countDocuments({ deleted_at: null, event_id: null });
    if (orphans) {
      const events = db.collection('events');
      let legacy = await events.findOne({ name: 'Legado', deleted_at: null });
      if (!legacy) {
        const { insertedId } = await events.insertOne({
          name: 'Legado', notes: 'Torneios anteriores ao cadastro de eventos.', start_date: null, end_date: null,
          deleted_at: null, migrated_g4: true, createdAt: now, updatedAt: now, __v: 0,
        });
        legacy = { _id: insertedId };
      }
      await db.collection('tournaments').updateMany({ deleted_at: null, event_id: null }, { $set: { event_id: legacy._id } });
    }
  },

  async down(db) {
    const sessions = db.collection('tournamentsessions');
    const migrated = await sessions.find({ migrated_g4: true }).toArray();
    const ids = migrated.map((s) => s._id);
    await db.collection('tournamententries').updateMany({ session_id: { $in: ids } }, { $set: { session_id: null } });
    await db.collection('seats').updateMany({ session_id: { $in: ids } }, { $set: { session_id: null } });
    await sessions.deleteMany({ migrated_g4: true });

    const legacy = await db.collection('events').findOne({ name: 'Legado', migrated_g4: true });
    if (legacy) {
      await db.collection('tournaments').updateMany({ event_id: legacy._id }, { $set: { event_id: null } });
      await db.collection('events').deleteOne({ _id: legacy._id });
    }
    const seats = db.collection('seats');
    for (const name of ['tournament_id_1_session_id_1_table_number_1_seat_number_1', 'tournament_id_1_session_id_1_player_id_1']) {
      try { await seats.dropIndex(name); } catch { /* ok */ }
    }
    await seats.createIndex({ tournament_id: 1, table_number: 1, seat_number: 1 }, { unique: true });
    await seats.createIndex({ tournament_id: 1, player_id: 1 }, { unique: true });
  },
};
