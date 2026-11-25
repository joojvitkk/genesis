import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck, Printer } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import CustomSelect from '../components/CustomSelect';
import { fmtDateTime } from '../lib/trackingFormat';

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));
const STATUS = { scheduled: ['badge badge-info', 'Agendada'], running: ['badge badge-ok', 'Em andamento'], finished: ['badge', 'Encerrada'] };

/** Tracking Sheet: a lista dos Trackings de TODAS as sessões (em andamento e encerradas), com filtros e o PDF de cada um. */
export default function TrackingSheets() {
  const { showAlert } = useAlert();
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [filter, setFilter] = useState({ event_id: '', tournament_id: '', date: '', status: '' });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const q = Object.fromEntries(Object.entries(filter).filter(([, v]) => v));
      setRows(await apiGet('/tracking-sheets', q));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar os Trackings', 'error'); } finally { setLoading(false); }
  }, [filter, showAlert]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { apiGet('/events').then(setEvents).catch(() => {}); }, []);

  const [all, setAll] = useState([]); // torneios para o filtro (sem refiltrar quando o filtro de torneio muda)
  useEffect(() => { apiGet('/tournaments').then(setAll).catch(() => {}); }, []);
  const tournamentOptions = useMemo(() => all.filter((t) => !filter.event_id || String(t.event_id) === filter.event_id).map((t) => ({ value: t._id, label: t.name })), [all, filter.event_id]);
  const set = (k) => (v) => setFilter((f) => ({ ...f, [k]: v, ...(k === 'event_id' ? { tournament_id: '' } : {}) }));

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header><h1 className="page-title flex items-center gap-2"><ClipboardCheck className="text-brand-fg" size={22} /> Tracking Sheet</h1></header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4" data-testid="tracking-filters">
        <div><label className="label">Evento</label><CustomSelect aria-label="Evento" options={[{ value: '', label: 'Todos' }, ...events.map((e) => ({ value: e._id, label: e.name }))]} value={filter.event_id} onChange={set('event_id')} /></div>
        <div><label className="label">Torneio</label><CustomSelect aria-label="Torneio" options={[{ value: '', label: 'Todos' }, ...tournamentOptions]} value={filter.tournament_id} onChange={set('tournament_id')} /></div>
        <div><label className="label" htmlFor="ts-date">Data</label><input id="ts-date" type="date" value={filter.date} onChange={(e) => set('date')(e.target.value)} className="input" /></div>
        <div><label className="label">Situação</label><CustomSelect aria-label="Situação" options={[{ value: '', label: 'Todas' }, { value: 'running', label: 'Em andamento' }, { value: 'scheduled', label: 'Agendada' }, { value: 'finished', label: 'Encerrada' }]} value={filter.status} onChange={set('status')} /></div>
      </div>

      <div className="card overflow-x-auto p-4">
        {loading ? <p className="p-6 text-center text-sm text-fg-subtle">Carregando…</p> : rows.length === 0 ? <p className="p-6 text-center text-sm italic text-fg-subtle">Nenhum Tracking encontrado.</p> : (
          <table className="table-dense w-full text-sm" data-testid="tracking-list">
            <thead><tr><th className="text-left">Torneio</th><th className="text-left">Sessão</th><th className="text-left">Início</th><th className="text-left">Situação</th><th className="text-right">Inscritos</th><th className="text-right">Jogando</th><th className="text-right">Classificados</th><th /></tr></thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((r) => {
                const [cls, label] = STATUS[r.status] || STATUS.scheduled;
                return (
                  <tr key={r.session_id}>
                    <td className="font-bold">{r.tournament_number ? `#${String(r.tournament_number).padStart(2, '0')} ` : ''}{r.tournament_name}</td>
                    <td>{r.session_name}</td>
                    <td>{r.at ? fmtDateTime(r.at, r.timezone) : '—'}</td>
                    <td><span className={cls}>{label}</span></td>
                    <td className="text-right tabular-nums">{fmt(r.entries_total)}</td>
                    <td className="text-right tabular-nums">{fmt(r.playing)}</td>
                    <td className="text-right tabular-nums">{fmt(r.qualified_count)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link to={`/tracking-sessao/${r.tournament_id}/${r.session_id}`} className="btn btn-secondary btn-sm">Abrir</Link>{' '}
                      <Link to={`/tracking-sessao/${r.tournament_id}/${r.session_id}?imprimir=1`} className="btn btn-ghost btn-sm" aria-label={`PDF ${r.tournament_name} ${r.session_name}`}><Printer size={13} /> PDF</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
