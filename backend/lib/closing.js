// Fechamento do torneio (Material E), em quantidade por denominação e em valor NOMINAL das fichas:
//
//   entregue (ações × montagem) + trocas (entrou − saiu) − descartes ± ocorrências (sobras e faltas) = contagem final
//
// A conta "fecha" quando, em todas as denominações, o que se esperava (já com as ocorrências abertas nas conferências)
// é igual à contagem final. Quando não fecha, aponta a denominação e as sessões onde a contagem divergiu.
// A quebra matemática das trocas já está nas trocas (entrou − saiu): em valor, é a diferença que a explica.
const { Occurrence, Allocation, Binder } = require('../models');
const { bookOf } = require('./book');
const mv = require('./movements');

async function closingOf(tournamentId) {
  const book = await bookOf(tournamentId);
  const sessions = book.sessions;
  const value = new Map(book.chips.map((c) => [c._id, c.value || 0]));

  const delivered = {}; const trades = {}; const discarded = {};
  for (const s of sessions) {
    for (const [id, c] of Object.entries(s.by_chip)) {
      if (s.type === 'QUALIFIER') delivered[id] = (delivered[id] || 0) + c.expected;
      trades[id] = (trades[id] || 0) + c.in - c.out;
      discarded[id] = (discarded[id] || 0) + c.discarded;
    }
  }

  // ocorrências ativas das conferências do torneio: sobra (+) e falta (−, menos o que foi recuperado)
  const occ = {};
  const occs = await Occurrence.find({ tournament_id: tournamentId, status: { $ne: 'voided' }, source: 'count' }).lean();
  for (const o of occs) {
    const id = String(o.chip_id);
    occ[id] = (occ[id] || 0) + (o.kind === 'SURPLUS' ? o.quantity : -(o.quantity - (o.recovered_quantity || 0)));
  }

  // contagem final = a da última sessão (Dia Final, se houver) que tem contagem de fim de dia
  const last = [...sessions].reverse().find((s) => s.has_count) || null;
  const lastSession = sessions[sessions.length - 1] || null;
  const finalCounted = last && lastSession && last.session_id === lastSession.session_id ? last : null;

  const ids = [...new Set([...Object.keys(delivered), ...Object.keys(trades), ...Object.keys(discarded), ...Object.keys(occ), ...Object.keys(finalCounted?.by_chip || {})])];
  const rows = ids.map((id) => {
    const expected = (delivered[id] || 0) + (trades[id] || 0) - (discarded[id] || 0) + (occ[id] || 0);
    const counted = finalCounted ? (finalCounted.by_chip[id]?.counted ?? finalCounted.by_chip[id]?.in_play ?? 0) : null;
    return {
      chip: book.chips.find((c) => c._id === id) || { _id: id },
      delivered: delivered[id] || 0, trades: trades[id] || 0, discarded: discarded[id] || 0, occurrences: occ[id] || 0,
      expected, counted, diff: counted == null ? null : counted - expected,
    };
  }).sort((a, b) => (a.chip.value || 0) - (b.chip.value || 0));

  const nominal = (f) => rows.reduce((t, r) => t + (r[f] || 0) * (value.get(String(r.chip._id)) || 0), 0);
  const totals = { delivered: nominal('delivered'), trades: nominal('trades'), discarded: nominal('discarded'), occurrences: nominal('occurrences'), expected: nominal('expected'), counted: finalCounted ? nominal('counted') : null };
  totals.diff = totals.counted == null ? null : totals.counted - totals.expected;

  // onde a contagem divergiu do Chip Count: por sessão e denominação
  const divergences = [];
  for (const s of sessions) for (const [id, c] of Object.entries(s.by_chip)) if (s.has_count && c.diff) divergences.push({ session_id: s.session_id, session: s.name, chip_id: id, value: value.get(id), diff: c.diff });

  // fichários vinculados: o que ainda está em jogo (não voltou) por denominação
  const hall = await mv.playBalances({ tournament_id: tournamentId });
  const stillOut = hall.filter((h) => h.quantity > 0).map((h) => ({ chip_id: String(h.chip_id), quantity: h.quantity, value: (value.get(String(h.chip_id)) || 0) * h.quantity }));
  const links = await Allocation.find({ tournament_id: tournamentId, open: true }).populate('binder_id', 'name code').lean();

  const openOccurrences = occs.filter((o) => !['recovered', 'closed'].includes(o.status) && !o.justification).length;
  const status = !finalCounted ? 'awaiting_count' : rows.every((r) => r.diff === 0) ? 'closes' : 'does_not_close';
  return {
    tournament: book.tournament, status, open_occurrences: openOccurrences, rows, totals, divergences,
    sessions: sessions.map((s) => ({ session_id: s.session_id, name: s.name, actions: s.total_actions, expected: s.totals.expected, in_play: s.totals.in_play, counted: s.totals.counted, breakage: s.breakage, discarded: s.totals.discarded, has_count: s.has_count })),
    binders: { linked: links.map((l) => ({ _id: l.binder_id?._id, name: l.binder_id?.name })), still_out: stillOut, all_returned: stillOut.length === 0 },
  };
}

module.exports = { closingOf };
