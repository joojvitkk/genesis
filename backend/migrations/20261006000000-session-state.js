// Simulação 2.1 §4: o estado em execução (relógio, nível, ativos, caches) passa do torneio para a SESSÃO.
// Compatível com dados existentes: cada sessão herda o estado do torneio; o ajuste de ativos (`active_offset`) vai
// para a primeira sessão ainda aberta (as demais nascem zeradas); sessões chamadas "Final" viram type FINAL;
// eliminações ganham `session_id` (da entrada eliminada). Idempotente (só preenche o que ainda não migrou).
module.exports = {
  async up(db) {
    const sessions = db.collection('tournamentsessions');
    for (const t of await db.collection('tournaments').find({}).toArray()) {
      const list = await sessions.find({ tournament_id: t._id }).sort({ order: 1, createdAt: 1 }).toArray();
      const first = list.find((s) => s.status !== 'finished') || list[0];
      for (const s of list) {
        if (s.clock_status !== undefined && s.type !== undefined) continue; // já migrada
        const type = /final/i.test(s.name || '') ? 'FINAL' : 'QUALIFIER';
        const live = s.status === 'running' || list.length === 1;
        const entryQ = { tournament_id: t._id, session_id: s._id, status: { $ne: 'cancelled' } };
        const [initial, reentries, eliminated] = await Promise.all([
          db.collection('tournamententries').countDocuments({ ...entryQ, type: 'buy-in' }),
          db.collection('tournamententries').countDocuments({ ...entryQ, type: 're-entry' }),
          db.collection('eliminations').countDocuments({ tournament_id: t._id, status: { $ne: 'cancelled' }, position: { $gt: 1 }, session_id: s._id }),
        ]);
        const offset = String(s._id) === String(first?._id) ? (t.active_offset || 0) : 0;
        await sessions.updateOne({ _id: s._id }, { $set: {
          type,
          clock_status: live ? (t.clock_status || 'stopped') : 'stopped',
          current_level: live ? (t.current_level || 0) : 0,
          level_started_at: live ? (t.level_started_at || null) : null,
          paused_at: live ? (t.paused_at || null) : null,
          clock_adjust_seconds: live ? (t.clock_adjust_seconds || 0) : 0,
          active_offset: offset,
          entries_initial: initial, entries_reentries: reentries,
          actual_players: Math.max(0, initial + reentries - eliminated + offset),
          chips_value_in_play: null,
          qualified_count: s.status === 'finished' && type === 'QUALIFIER' ? Math.max(0, initial + reentries - eliminated + offset) : null,
          qualified_log: [],
        } });
      }
    }
    // eliminações: sessão = a da entrada eliminada
    for (const e of await db.collection('eliminations').find({ session_id: { $exists: false } }).toArray()) {
      const entry = await db.collection('tournamententries').findOne({ _id: e.entry_id });
      await db.collection('eliminations').updateOne({ _id: e._id }, { $set: { session_id: entry?.session_id || null } });
    }
  },

  async down(db) {
    await db.collection('tournamentsessions').updateMany({}, { $unset: {
      type: '', clock_status: '', current_level: '', level_started_at: '', paused_at: '', clock_adjust_seconds: '', active_offset: '',
      actual_players: '', entries_initial: '', entries_reentries: '', chips_value_in_play: '', qualified_count: '', qualified_log: '',
    } });
    await db.collection('eliminations').updateMany({}, { $unset: { session_id: '' } });
  },
};
