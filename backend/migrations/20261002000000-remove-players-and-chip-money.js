// Decisões de produto pós-G11:
//   (1) FICHA só tem VALOR NOMINAL — jamais valor monetário (`monetary_value` sai das fichas);
//   (2) NÃO há cadastro de jogadores: a identidade nas mesas e eliminações passa a ser a ENTRADA ("Entrada #n").
//
// Nada é perdido: o que sai é ARQUIVADO antes (`archive_*`) e só então removido; `players` NÃO é tocada.
//   chipmodels.monetary_value          → archive_chip_legacy
//   players                            → archive_players (cópia)
//   tournamententries.player_*         → archive_entry_players; ganha `number` (1..n por torneio) e o torneio ganha `entry_seq`
//   seats.player_id                    → seat.entry_id (a entrada mais recente do jogador na sessão); sem entrada → arquivado e removido
//   eliminations.player_id/eliminated_by/bounty_awarded → archive_elimination_players; ganha `entry_id`
// Idempotente. `down` restaura os campos a partir dos arquivos.
const sid = (x) => String(x);

async function dropIndexIfExists(coll, name) {
  try { await coll.dropIndex(name); } catch (e) { if (!/index not found|ns not found/i.test(e.message)) throw e; }
}

module.exports = {
  async up(db) {
    // (1) fichas
    const chips = db.collection('chipmodels');
    for (const c of await chips.find({ monetary_value: { $exists: true } }).toArray()) {
      await db.collection('archive_chip_legacy').updateOne({ chip_id: c._id }, { $setOnInsert: { archived_at: new Date() }, $set: { monetary_value: c.monetary_value } }, { upsert: true });
    }
    await chips.updateMany({ monetary_value: { $exists: true } }, { $unset: { monetary_value: '' } });

    // (2) jogadores
    if (await db.listCollections({ name: 'players' }).hasNext()) {
      for (const p of await db.collection('players').find({}).toArray()) {
        if (!(await db.collection('archive_players').countDocuments({ _id: p._id }))) await db.collection('archive_players').insertOne(p);
      }
    }

    const entries = db.collection('tournamententries');
    const byTournament = new Map(); // tournament -> entradas por timestamp
    for (const e of await entries.find({}).sort({ timestamp: 1, _id: 1 }).toArray()) {
      const k = sid(e.tournament_id);
      byTournament.set(k, [...(byTournament.get(k) || []), e]);
    }
    const playerOf = new Map(); // entry_id -> player_id (ANTES de remover)
    for (const [tid, list] of byTournament) {
      let n = 0;
      for (const e of list) {
        n += 1;
        if (e.player_id !== undefined || e.player_name !== undefined) {
          playerOf.set(sid(e._id), e.player_id ? sid(e.player_id) : null);
          if (!(await db.collection('archive_entry_players').countDocuments({ entry_id: e._id }))) {
            await db.collection('archive_entry_players').insertOne({ entry_id: e._id, player_id: e.player_id ?? null, player_name: e.player_name ?? null, archived_at: new Date() });
          }
        }
        await entries.updateOne({ _id: e._id }, { $set: { number: e.number ?? n }, $unset: { player_id: '', player_name: '' } });
      }
      await db.collection('tournaments').updateOne({ _id: list[0].tournament_id }, { $max: { entry_seq: n } });
    }
    // mapa jogador → entradas (ordem), a partir do arquivo (idempotente: vale numa 2ª rodada também)
    const archived = await db.collection('archive_entry_players').find({ player_id: { $ne: null } }).toArray();
    const entryDocs = new Map((await entries.find({}).toArray()).map((e) => [sid(e._id), e]));
    const entriesOfPlayer = new Map(); // "tournament|player" -> [entry]
    for (const a of archived) {
      const e = entryDocs.get(sid(a.entry_id));
      if (!e) continue;
      const k = `${sid(e.tournament_id)}|${sid(a.player_id)}`;
      entriesOfPlayer.set(k, [...(entriesOfPlayer.get(k) || []), e]);
    }
    for (const list of entriesOfPlayer.values()) list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp) || sid(a._id).localeCompare(sid(b._id)));

    // assentos
    const seats = db.collection('seats');
    await dropIndexIfExists(seats, 'tournament_id_1_session_id_1_player_id_1'); // o índice antigo (por jogador) bloquearia os novos
    for (const seat of await seats.find({ player_id: { $exists: true } }).toArray()) {
      const list = (entriesOfPlayer.get(`${sid(seat.tournament_id)}|${sid(seat.player_id)}`) || [])
        .filter((e) => e.type !== 'add-on' && e.status !== 'cancelled' && sid(e.session_id ?? '') === sid(seat.session_id ?? ''));
      const entry = list.at(-1);
      if (entry) await seats.updateOne({ _id: seat._id }, { $set: { entry_id: entry._id }, $unset: { player_id: '' } });
      else {
        await db.collection('archive_seats_legacy').insertOne({ ...seat, archived_at: new Date() });
        await seats.deleteOne({ _id: seat._id });
      }
    }
    // eliminações
    const elims = db.collection('eliminations');
    const used = new Map(); // "tournament|player" -> quantas já mapeadas
    for (const el of await elims.find({ player_id: { $exists: true } }).sort({ at: 1, _id: 1 }).toArray()) {
      const k = `${sid(el.tournament_id)}|${sid(el.player_id)}`;
      const list = entriesOfPlayer.get(k) || [];
      const i = used.get(k) || 0;
      used.set(k, i + 1);
      const entry = list[Math.min(i, list.length - 1)];
      await db.collection('archive_elimination_players').insertOne({ elimination_id: el._id, player_id: el.player_id, eliminated_by: el.eliminated_by ?? null, bounty_awarded: el.bounty_awarded ?? 0, archived_at: new Date() });
      await elims.updateOne({ _id: el._id }, { ...(entry ? { $set: { entry_id: entry._id } } : {}), $unset: { player_id: '', eliminated_by: '', bounty_awarded: '' } });
    }
    await dropIndexIfExists(entries, 'tournament_id_1_player_id_1');
  },

  async down(db) {
    for (const a of await db.collection('archive_chip_legacy').find({ monetary_value: { $exists: true } }).toArray()) {
      await db.collection('chipmodels').updateOne({ _id: a.chip_id }, { $set: { monetary_value: a.monetary_value } });
    }
    for (const a of await db.collection('archive_entry_players').find({}).toArray()) {
      await db.collection('tournamententries').updateOne({ _id: a.entry_id }, { $set: { player_id: a.player_id, player_name: a.player_name } });
    }
    for (const a of await db.collection('archive_elimination_players').find({}).toArray()) {
      await db.collection('eliminations').updateOne({ _id: a.elimination_id }, { $set: { player_id: a.player_id, eliminated_by: a.eliminated_by, bounty_awarded: a.bounty_awarded } });
    }
  },
};
