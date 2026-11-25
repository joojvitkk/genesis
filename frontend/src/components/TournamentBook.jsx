import { locale } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiGet } from '../lib/api';
import { socket } from '../lib/socket';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const ACTION_LABEL = { buy_in: 'Buy-in', optional_buy_in: 'Buy-in opcional', re_entry: 'Reentrada', add_on: 'Add-on' };
const TRADE_LABEL = { CHIP_RACE: 'Chip Race', COLOR_UP: 'Color Up' };
const SUMMARY = 'summary';
const dash = (v) => (v == null || v === 0 ? '—' : fmt(v));

/**
 * Livro do torneio: UMA ABA POR SESSÃO, como linha do tempo. Linhas = denominações; colunas na ordem dos acontecimentos:
 * Em jogo (ou Herdado) → Saiu/Entrou de cada troca → Descarte → Saldo em jogo → Contado e Diferença. Só leitura; CSV e PDF saem por aba.
 */
export default function TournamentBook({ tournamentId, refreshKey }) {
  const [book, setBook] = useState(null);
  const [closing, setClosing] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('');

  const load = useCallback(() => apiGet(`/tournaments/${tournamentId}/book`).then((b) => { setBook(b); setError(null); }).catch((e) => { if (e.status !== 401) setError(e.message || 'Erro ao carregar o livro'); }), [tournamentId]);
  useEffect(() => { load(); apiGet(`/tournaments/${tournamentId}/closing`).then(setClosing).catch(() => setClosing(null)); }, [load, tournamentId, refreshKey]);
  useEffect(() => {
    const on = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tournamentId)) load(); };
    socket.on('materialChanged', on);
    return () => socket.off('materialChanged', on);
  }, [tournamentId, load]);

  const sessions = useMemo(() => book?.sessions || [], [book]);
  const current = tab === SUMMARY ? null : (sessions.find((x) => x.session_id === tab) || sessions[0]);

  /** Colunas da linha do tempo de uma sessão: [{ key, label, group, value(chipId) }] */
  const columns = (sess) => {
    const cols = [{ key: 'start', label: sess.inherits ? 'Herdado' : 'Em jogo', value: (id) => sess.by_chip[id]?.expected }];
    for (const tr of sess.trades || []) {
      const name = `${TRADE_LABEL[tr.type] || tr.type} ${tr.n}`;
      cols.push({ key: `out${tr.n}`, label: `${name} · Saiu`, trade: tr, side: 'out', value: (id) => tr.outs[id] });
      cols.push({ key: `in${tr.n}`, label: `${name} · Entrou`, trade: tr, side: 'in', value: (id) => tr.ins[id] });
    }
    if (Object.values(sess.by_chip).some((c) => c.discarded)) cols.push({ key: 'disc', label: 'Descarte', value: (id) => sess.by_chip[id]?.discarded });
    cols.push({ key: 'bal', label: 'Saldo em jogo', strong: true, value: (id) => sess.by_chip[id]?.in_play });
    if (sess.has_count) {
      cols.push({ key: 'cnt', label: 'Contado', value: (id) => sess.by_chip[id]?.counted ?? sess.by_chip[id]?.in_play });
      cols.push({ key: 'dif', label: 'Diferença', diff: true, value: (id) => { const c = sess.by_chip[id]; return c ? (c.counted ?? c.in_play) - c.in_play : 0; } });
    }
    return cols;
  };
  const valueRow = (cols, chips) => cols.map((c) => chips.reduce((t, ch) => t + (c.value(ch._id) || 0) * (ch.value || 0), 0));
  const breakageRow = (cols) => cols.map((c) => (c.side === 'in' ? c.trade.breakage : null));
  const usedChips = (sess) => book.chips.filter((ch) => { const c = sess.by_chip[ch._id]; return c && (c.expected || c.out || c.in || c.discarded || c.in_play || c.counted); });

  const exportCsv = () => {
    const lines = [];
    if (current) {
      const cols = columns(current); const chips = usedChips(current);
      lines.push(['Denominação', ...cols.map((c) => c.label)]);
      for (const ch of chips) lines.push([ch.value, ...cols.map((c) => c.value(ch._id) ?? 0)]);
      lines.push(['Valor nominal', ...valueRow(cols, chips)]);
      lines.push(['Quebra', ...breakageRow(cols).map((v) => v ?? '')]);
    } else {
      const cl = book.totals.closing;
      lines.push(['Conta de fechamento', 'Valor nominal']);
      lines.push(['Ações × montagem', cl.delivered], ['Quebra acumulada', cl.breakage], ['Descartes', -cl.discarded], ['Trocas da fase final', cl.final_trades], ['Saldo final', cl.balance]);
    }
    const csv = lines.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `livro-${book.tournament.name}-${current ? current.name : 'resumo'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <p role="alert" className="p-8 text-sm font-bold text-danger">{error}</p>;
  if (!book) return <p className="p-8 text-sm text-fg-subtle">Carregando…</p>;
  if (!sessions.length) return <p className="p-8 text-sm italic text-fg-subtle">O torneio ainda não tem sessões.</p>;

  const timeline = (sess) => {
    const cols = columns(sess); const chips = usedChips(sess);
    const values = valueRow(cols, chips); const quebra = breakageRow(cols);
    const actions = Object.entries(sess.actions || {});
    const counted = sess.has_count ? (sess.totals.diff === 0 ? '✓' : fmt(sess.totals.diff)) : '—';
    return (
      <div className="space-y-4" data-testid="book-session">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="book-top">
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Ações</p><p className="text-sm font-bold">{actions.length ? actions.map(([k, n]) => `${ACTION_LABEL[k] || k} ${fmt(n)}`).join(' · ') : '—'}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">{sess.inherits ? 'Herdado' : 'Entrou em jogo'}</p><p className="text-lg font-bold tabular-nums">{fmt(sess.totals.expected)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Quebra</p><p className="text-lg font-bold tabular-nums">{fmt(sess.breakage)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Saldo</p><p className="text-lg font-bold tabular-nums">{fmt(sess.totals.in_play)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Contagem</p><p className="text-lg font-bold tabular-nums">{counted}</p></div>
        </div>
        <div className="overflow-x-auto">
          <table className="table-dense w-full text-sm">
            <thead><tr><th className="text-left">Denominação</th>{cols.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-line-soft">
              {chips.map((ch) => (
                <tr key={ch._id}>
                  <td className="font-bold"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: ch.color }} />{fmt(ch.value)}</td>
                  {cols.map((c) => { const v = c.value(ch._id); return <td key={c.key} className={`text-right tabular-nums ${c.strong ? 'font-bold' : ''} ${c.diff && v ? 'text-danger' : ''}`}>{dash(v)}</td>; })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold"><td>Valor nominal</td>{values.map((v, i) => <td key={cols[i].key} className="text-right tabular-nums">{fmt(v)}</td>)}</tr>
              {sess.trades?.length > 0 && <tr className="text-xs"><td>Quebra</td>{quebra.map((v, i) => <td key={cols[i].key} className="text-right tabular-nums">{v == null ? '' : fmt(v)}</td>)}</tr>}
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const summary = () => {
    const cl = book.totals.closing;
    return (
      <div className="space-y-4" data-testid="book-summary">
        <div className="overflow-x-auto">
          <table className="table-dense w-full max-w-xl text-sm">
            <tbody className="divide-y divide-line-soft">
              <tr><td>Ações × montagem</td><td className="text-right tabular-nums">{fmt(cl.delivered)}</td></tr>
              <tr><td>+ Quebra acumulada</td><td className="text-right tabular-nums">{fmt(cl.breakage)}</td></tr>
              <tr><td>− Descartes</td><td className="text-right tabular-nums">{fmt(cl.discarded)}</td></tr>
              <tr><td>± Trocas da fase final</td><td className="text-right tabular-nums">{fmt(cl.final_trades)}</td></tr>
              <tr className="font-bold"><td>= Saldo final</td><td className="text-right tabular-nums" data-testid="book-balance">{fmt(cl.balance)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Ações</p><p className="text-lg font-bold tabular-nums">{fmt(book.totals.actions)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Em jogo</p><p className="text-lg font-bold tabular-nums">{fmt(book.totals.in_play)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Quebra</p><p className="text-lg font-bold tabular-nums">{fmt(book.totals.breakage)}</p></div>
          <div><p className="text-xs font-bold uppercase text-fg-subtle">Descartes</p><p className="text-lg font-bold tabular-nums">{fmt(book.totals.discarded)}</p></div>
        </div>
        {closing && <ClosingBlock closing={closing} />}
      </div>
    );
  };

  return (
    <div className="space-y-4 p-4 md:p-8" data-testid="tournament-book">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-bold">Livro do torneio</h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportCsv} className="btn btn-secondary"><Download size={14} /> CSV</button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary"><Printer size={14} /> PDF</button>
        </div>
      </div>
      <div className="no-print flex flex-wrap gap-2" role="tablist" aria-label="Sessões do livro">
        {sessions.map((x) => (
          <button key={x.session_id} role="tab" type="button" aria-selected={current?.session_id === x.session_id} onClick={() => setTab(x.session_id)}
            className={`btn btn-sm ${current?.session_id === x.session_id ? 'btn-primary' : 'btn-secondary'}`}>{x.name}</button>
        ))}
        <button role="tab" type="button" aria-selected={!current} onClick={() => setTab(SUMMARY)} className={`btn btn-sm ${!current ? 'btn-primary' : 'btn-secondary'}`}>Resumo</button>
      </div>
      <div className="print-book-title hidden"><h2 className="text-xl font-bold">{book.tournament.name} · {current ? current.name : 'Resumo'}</h2></div>
      <div className="card p-4">{current ? timeline(current) : summary()}</div>
    </div>
  );
}

const STATUS = {
  closes: ['badge badge-ok', 'A conta fecha'],
  does_not_close: ['badge badge-danger', 'A conta não fecha'],
  awaiting_count: ['badge badge-warn', 'Aguardando a contagem final'],
};

/** Fechamento: entregue + trocas − descartes ± ocorrências = contagem final, por denominação e em valor nominal. */
function ClosingBlock({ closing }) {
  const [cls, label] = STATUS[closing.status] || STATUS.awaiting_count;
  return (
    <section className="card space-y-3 p-4" data-testid="closing">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-bold">Fechamento do torneio</h3>
        <span className={cls}>{label}</span>
        {closing.open_occurrences > 0 && <span className="badge badge-warn">{closing.open_occurrences} ocorrência(s) sem justificativa</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="table-dense w-full text-sm">
          <thead><tr><th className="text-left">Denominação</th><th className="text-right">Entregue</th><th className="text-right">Trocas</th><th className="text-right">Descartes</th><th className="text-right">Ocorrências</th><th className="text-right">Esperado</th><th className="text-right">Contagem final</th><th className="text-right">Diferença</th></tr></thead>
          <tbody className="divide-y divide-line-soft">
            {closing.rows.map((r) => (
              <tr key={r.chip._id}>
                <td className="font-bold">{fmt(r.chip.value)}</td>
                <td className="text-right tabular-nums">{fmt(r.delivered)}</td><td className="text-right tabular-nums">{fmt(r.trades)}</td>
                <td className="text-right tabular-nums">{fmt(-r.discarded)}</td><td className="text-right tabular-nums">{fmt(r.occurrences)}</td>
                <td className="text-right tabular-nums">{fmt(r.expected)}</td><td className="text-right tabular-nums">{r.counted == null ? '—' : fmt(r.counted)}</td>
                <td className={`text-right font-bold tabular-nums ${r.diff ? 'text-red-600' : ''}`}>{r.diff == null ? '—' : fmt(r.diff)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr className="font-bold"><td>Valor nominal</td><td className="text-right tabular-nums">{fmt(closing.totals.delivered)}</td><td className="text-right tabular-nums">{fmt(closing.totals.trades)}</td><td className="text-right tabular-nums">{fmt(-closing.totals.discarded)}</td><td className="text-right tabular-nums">{fmt(closing.totals.occurrences)}</td><td className="text-right tabular-nums">{fmt(closing.totals.expected)}</td><td className="text-right tabular-nums">{closing.totals.counted == null ? '—' : fmt(closing.totals.counted)}</td><td className="text-right tabular-nums">{closing.totals.diff == null ? '—' : fmt(closing.totals.diff)}</td></tr></tfoot>
        </table>
      </div>
      {closing.divergences.length > 0 && (
        <p className="text-xs text-fg-muted">Diferenças nas contagens: {closing.divergences.map((d) => `${d.session} · ${fmt(d.value)} (${d.diff > 0 ? '+' : ''}${fmt(d.diff)})`).join(' · ')}</p>
      )}
      <p className="text-xs text-fg-muted">Fichários: {closing.binders.all_returned ? 'todas as fichas voltaram.' : `ainda há fichas em jogo (${fmt(closing.binders.still_out.reduce((t, x) => t + x.quantity, 0))}).`}</p>
    </section>
  );
}
