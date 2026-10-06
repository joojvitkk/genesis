import { locale } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiGet } from '../lib/api';
import CustomSelect from './CustomSelect';
import { TYPE_LABEL } from './DashboardPanels';

const n = (v) => (v ?? 0).toLocaleString(locale());
const KINDS = [{ value: 'binder_id', label: 'Fichário' }, { value: 'chip_id', label: 'Ficha' }, { value: 'tournament_id', label: 'Torneio' }];
const PLACE = { binder: 'Fichário', lost: 'Divergência', play: 'No Salão' };

/**
 * Histórico de saldo (spec §15): para a ficha, o fichário ou o torneio escolhido, cada movimento com o seu EFEITO no saldo
 * e o saldo depois dele — reconstruído dos movimentos no servidor (GET /audit/history).
 */
export default function BalanceHistory() {
  const [kind, setKind] = useState('binder_id');
  const [options, setOptions] = useState({ binder_id: [], chip_id: [], tournament_id: [] });
  const [targetId, setTargetId] = useState('');
  const [chipId, setChipId] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const list = (r) => (Array.isArray(r) ? r : r?.data || []);
    Promise.all([apiGet('/binders').catch(() => []), apiGet('/chips').catch(() => []), apiGet('/tournaments').catch(() => [])]).then(([b, c, t]) => setOptions({
      binder_id: list(b).map((x) => ({ value: x._id, label: x.name })),
      chip_id: list(c).map((x) => ({ value: x._id, label: x.name })),
      tournament_id: list(t).map((x) => ({ value: x._id, label: x.name })),
    }));
  }, []);

  useEffect(() => {
    if (!targetId) { setData(null); return undefined; }
    let alive = true;
    apiGet('/audit/history', { [kind]: targetId, ...(kind === 'binder_id' && chipId ? { chip_id: chipId } : {}), page, limit: 50 })
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => { if (alive && e.status !== 401) { setData(null); setError(e.message); } });
    return () => { alive = false; };
  }, [kind, targetId, chipId, page]);

  const pickKind = (v) => { setKind(v); setTargetId(''); setChipId(''); setPage(1); };

  return (
    <div className="space-y-5">
      <p className="text-sm text-fg-muted">Escolha uma ficha, um fichário ou um torneio: cada movimento aparece com o efeito no saldo e o saldo depois dele. Tudo calculado dos movimentos — nada é editado.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <CustomSelect options={KINDS} value={kind} onChange={pickKind} />
        <CustomSelect options={options[kind]} value={targetId} onChange={(v) => { setTargetId(v); setPage(1); }} placeholder="Escolha…" />
        {kind === 'binder_id' && targetId && (
          <CustomSelect options={[{ value: '', label: 'Todas as fichas' }, ...options.chip_id]} value={chipId} onChange={(v) => { setChipId(v); setPage(1); }} placeholder="Ficha" />
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p>}
      {data && (
        <div data-testid="balance-history" className="card overflow-hidden">
          {data.rows.length === 0 ? <p className="p-10 text-center text-sm italic text-fg-subtle">Nenhum movimento.</p> : (
            <ul className="divide-y divide-line-soft">
              {data.rows.map((m) => (
                <li key={m._id} data-movement={m._id} className={`flex flex-wrap items-center justify-between gap-3 p-4 text-sm ${m.reversed_by ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="font-bold text-fg">
                      <span className={m.reversed_by ? 'line-through' : ''}>{TYPE_LABEL[m.type] || m.type} · {m.chip_id?.name || 'Ficha'}</span>
                      {m.reversed_by && <span className="ml-2 rounded-full bg-raised px-2 py-0.5 text-xs font-bold text-fg-muted">estornado</span>}
                    </p>
                    <p className="truncate text-xs text-fg-subtle" title={m.reason}>{m.reason || '—'} · {new Date(m.createdAt).toLocaleString(locale())} · {m.user_name}</p>
                    {m.reversed_by && <p className="text-xs text-purple-500">Estornado por {m.reversed_by.user_name}: {m.reversed_by.reason}</p>}
                  </div>
                  <div className="space-y-0.5 text-right">
                    {m.effects.map((e, i) => (
                      <p key={i} data-effect className="text-xs tabular-nums">
                        <span className="text-fg-subtle">{PLACE[e.location.kind]}</span>{' '}
                        <span className={`font-bold ${e.delta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{e.delta >= 0 ? '+' : '−'}{n(Math.abs(e.delta))}</span>{' '}
                        <span className="text-fg-muted">→ saldo {n(e.balance_after)}</span>
                      </p>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between bg-sunken p-4">
            <span className="text-xs font-bold uppercase tracking-wide text-fg-subtle">{data.pagination.total} movimentos · {data.entity.name}</span>
            <div className="flex items-center gap-2">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior" className="rounded-lg border border-line bg-surface p-2 disabled:opacity-30 dark:bg-zinc-800"><ChevronLeft size={18} /></button>
              <span className="rounded-lg border border-line bg-surface px-4 py-1.5 text-sm font-bold dark:bg-zinc-800">{page} / {data.pagination.pages}</span>
              <button disabled={page >= data.pagination.pages} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página" className="rounded-lg border border-line bg-surface p-2 disabled:opacity-30 dark:bg-zinc-800"><ChevronRight size={18} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
