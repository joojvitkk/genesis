import { locale } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { apiGet } from '../lib/api';
import { socket } from '../lib/socket';
import CustomSelect from './CustomSelect';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const SECTIONS = [
  ['expected', 'Esperado', 'Ações × montagem do stack, antes de trocas e descartes.'],
  ['out', 'Trocas · saiu', 'Fichas que saíram do jogo em Chip Race / Color Up.'],
  ['in', 'Trocas · entrou', 'Fichas que entraram no jogo em Chip Race / Color Up.'],
  ['discarded', 'Descartes', 'Stacks descartados e devolvidos ao fichário.'],
  ['in_play', 'Em jogo (Chip Count)', 'O que as entradas já entregaram aos jogadores, com trocas e descartes.'],
  ['counted', 'Contado no fim do dia', 'Sacos dos jogadores contados na conferência de fim de dia.'],
  ['diff', 'Diferença', 'Contado − Chip Count. Inclui a quebra das trocas; só a parte física vira ocorrência.'],
];

/** Livro do torneio: planilha só de leitura (denominações × sessões), com exportação em CSV e PDF (impressão A4 deitado). */
export default function TournamentBook({ tournamentId, refreshKey }) {
  const [book, setBook] = useState(null);
  const [closing, setClosing] = useState(null);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(''); // celular: uma sessão por vez

  const load = useCallback(() => apiGet(`/tournaments/${tournamentId}/book`).then((b) => { setBook(b); setError(null); }).catch((e) => { if (e.status !== 401) setError(e.message || 'Erro ao carregar o livro'); }), [tournamentId]);
  useEffect(() => { load(); apiGet(`/tournaments/${tournamentId}/closing`).then(setClosing).catch(() => setClosing(null)); }, [load, tournamentId, refreshKey]);
  useEffect(() => {
    const on = (p) => { if (!p?.tournament_id || String(p.tournament_id) === String(tournamentId)) load(); };
    socket.on('materialChanged', on);
    return () => socket.off('materialChanged', on);
  }, [tournamentId, load]);

  const sessions = useMemo(() => book?.sessions || [], [book]);
  const current = sessions.find((s) => s.session_id === sessionId) || sessions[0];

  const cellValue = (s, id, f) => {
    const c = s.by_chip[id];
    if (!c) return null;
    if ((f === 'counted' || f === 'diff') && !s.has_count) return null;
    return f === 'counted' ? c.counted ?? c.in_play : f === 'diff' ? (c.counted ?? c.in_play) - c.in_play : c[f];
  };

  const exportCsv = () => {
    const head = ['Seção', 'Denominação', ...sessions.map((s) => s.name), 'Total'];
    const lines = [head];
    lines.push(['Ações', '', ...sessions.map((s) => s.total_actions), book.totals.actions]);
    for (const [f, label] of SECTIONS) {
      for (const chip of book.chips) {
        const vals = sessions.map((s) => cellValue(s, chip._id, f));
        lines.push([label, chip.value, ...vals.map((v) => v ?? ''), vals.some((v) => v != null) ? vals.reduce((a, v) => a + (v || 0), 0) : '']);
      }
      lines.push([`${label} (valor nominal)`, '', ...sessions.map((s) => s.totals[f] ?? ''), book.totals[f] ?? '']);
    }
    lines.push(['Quebra das trocas (valor nominal)', '', ...sessions.map((s) => s.breakage), book.totals.breakage]);
    const csv = lines.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `livro-${book.tournament.name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (error) return <p role="alert" className="p-8 text-sm font-bold text-red-600">{error}</p>;
  if (!book) return <p className="p-8 text-sm text-fg-subtle">Carregando…</p>;
  if (!sessions.length) return <p className="p-8 text-sm italic text-fg-subtle">O torneio ainda não tem sessões.</p>;

  const shown = (s) => (s ? [s] : sessions);
  const mobileSessions = shown(current);

  const table = (cols, cls) => (
    <div className={`overflow-x-auto ${cls}`}>
      <table className="table-dense w-full text-sm">
        <thead>
          <tr><th className="text-left">Denominação</th>{cols.map((s) => <th key={s.session_id} className="text-right">{s.name}</th>)}{cols.length > 1 && <th className="text-right">Total</th>}</tr>
          <tr className="text-xs text-fg-subtle"><th className="text-left font-normal">Ações</th>{cols.map((s) => <th key={s.session_id} className="text-right font-normal">{fmt(s.total_actions)}</th>)}{cols.length > 1 && <th className="text-right font-normal">{fmt(book.totals.actions)}</th>}</tr>
        </thead>
        {SECTIONS.map(([f, label, hint]) => (
          <tbody key={f} className="divide-y divide-line-soft">
            <tr><th colSpan={cols.length + 2} className="pt-4 text-left text-xs uppercase tracking-wide text-fg-subtle" title={hint}>{label} <span className="normal-case">· {hint}</span></th></tr>
            {book.chips.map((chip) => {
              const vals = cols.map((s) => cellValue(s, chip._id, f));
              if (vals.every((v) => v == null)) return null;
              return (
                <tr key={chip._id}>
                  <td className="font-bold"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: chip.color }} />{fmt(chip.value)}</td>
                  {vals.map((v, i) => <td key={cols[i].session_id} className={`text-right tabular-nums ${f === 'diff' && v ? (v < 0 ? 'text-red-600' : 'text-amber-600') : ''}`}>{v == null ? '—' : fmt(v)}</td>)}
                  {cols.length > 1 && <td className="text-right font-bold tabular-nums">{fmt(vals.reduce((a, v) => a + (v || 0), 0))}</td>}
                </tr>
              );
            })}
            <tr className="font-bold"><td>Total (valor nominal)</td>{cols.map((s) => <td key={s.session_id} className="text-right tabular-nums">{s.totals[f] == null ? '—' : fmt(s.totals[f])}</td>)}{cols.length > 1 && <td className="text-right tabular-nums">{fmt(book.totals[f])}</td>}</tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="font-bold"><td title="A quebra matemática das trocas explica a diferença em valor; não é perda.">Quebra das trocas (valor nominal)</td>{cols.map((s) => <td key={s.session_id} className="text-right tabular-nums">{fmt(s.breakage)}</td>)}{cols.length > 1 && <td className="text-right tabular-nums">{fmt(book.totals.breakage)}</td>}</tr>
          <tr className="text-xs text-fg-subtle"><td>Contagem de fim de dia</td>{cols.map((s) => <td key={s.session_id} className="text-right">{s.has_count ? `${new Date(s.counted_at).toLocaleString(locale())}` : 'não feita'}</td>)}{cols.length > 1 && <td />}</tr>
        </tfoot>
      </table>
    </div>
  );

  return (
    <div className="space-y-4 p-4 md:p-8" data-testid="tournament-book">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold">Livro do torneio</h3>
          <p className="text-xs text-fg-muted">Só leitura. Valores em quantidade de fichas e em valor nominal.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportCsv} className="btn btn-secondary"><Download size={14} /> CSV</button>
          <button type="button" onClick={() => window.print()} className="btn btn-secondary"><Printer size={14} /> PDF</button>
        </div>
      </div>
      <div className="print-book-title hidden"><h2 className="text-xl font-bold">{book.tournament.name} · Livro do torneio</h2></div>
      {sessions.length > 1 && (
        <div className="no-print max-w-xs md:hidden">
          <CustomSelect options={sessions.map((s) => ({ value: s.session_id, label: s.name }))} value={current.session_id} onChange={setSessionId} />
        </div>
      )}
      <div className="card p-4 md:hidden no-print">{table(mobileSessions, '')}</div>
      <div className="card hidden p-4 md:block print:block">{table(sessions, '')}</div>
      {closing && <ClosingBlock closing={closing} />}
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
      <p className="text-xs text-fg-muted">Entregue (ações × montagem) + trocas − descartes ± ocorrências = contagem final. Em valor nominal das fichas.</p>
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
