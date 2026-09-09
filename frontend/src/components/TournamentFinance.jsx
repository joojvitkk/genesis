import { useCallback, useEffect, useState } from 'react';
import { DollarSign, Save, Settings, Trophy, Skull, RotateCcw } from 'lucide-react';
import { apiGet, apiPut, apiPost, apiDelete } from '../lib/api';
import { useAlert } from '../contexts/AlertContext';
import PlayerSelect from './PlayerSelect';
import PayoutTemplatesModal from './PayoutTemplatesModal';

const brl = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function Field({ label, value, onChange, suffix }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</span>
      <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 focus-within:ring-2 focus-within:ring-genesis-red dark:border-zinc-800 dark:bg-zinc-900">
        <input
          type="number" min="0" value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent py-2.5 text-sm font-bold outline-none dark:text-white"
        />
        {suffix && <span className="text-xs font-bold text-gray-400">{suffix}</span>}
      </div>
    </label>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className="rounded-2xl bg-gray-50 p-4 dark:bg-zinc-900/60">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`text-lg font-black tabular-nums ${accent || 'text-gray-900 dark:text-white'}`}>{value}</p>
    </div>
  );
}

export default function TournamentFinance({ tournament, canEdit, onTournamentChange }) {
  const { showAlert, showConfirm } = useAlert();
  const tid = tournament._id;
  const [cfg, setCfg] = useState({
    buy_in: tournament.buy_in || 0, rake: tournament.rake || 0,
    addon_value: tournament.addon_value || 0, addon_chips: tournament.addon_chips || 0,
    bounty_value: tournament.bounty_value || 0, payout_template_id: tournament.payout_template_id || '',
  });
  const [templates, setTemplates] = useState([]);
  const [finance, setFinance] = useState(null);
  const [results, setResults] = useState([]);
  const [tplModal, setTplModal] = useState(false);
  const [elimTarget, setElimTarget] = useState(null); // player being eliminated
  const [elimBy, setElimBy] = useState(null);
  const [savingCfg, setSavingCfg] = useState(false);

  const finalized = tournament.status === 'finalized';

  const refresh = useCallback(async () => {
    try {
      const [fin, res, tpls] = await Promise.all([
        apiGet(`/tournaments/${tid}/finance`),
        apiGet(`/tournaments/${tid}/results`),
        apiGet('/payout-templates'),
      ]);
      setFinance(fin);
      setResults(res);
      setTemplates(tpls);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar financeiro', 'error');
    }
  }, [tid, showAlert]);

  useEffect(() => { refresh(); }, [refresh]);

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const payload = {
        buy_in: Number(cfg.buy_in) || 0, rake: Number(cfg.rake) || 0,
        addon_value: Number(cfg.addon_value) || 0, addon_chips: Number(cfg.addon_chips) || 0,
        bounty_value: Number(cfg.bounty_value) || 0,
        payout_template_id: cfg.payout_template_id || null,
      };
      const { tournament: updated } = await apiPut(`/tournaments/${tid}`, payload);
      showAlert('Configuração salva!', 'success');
      onTournamentChange?.(updated);
      refresh();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar', 'error');
    } finally {
      setSavingCfg(false);
    }
  };

  const doEliminate = async () => {
    if (!elimTarget) return;
    try {
      const fin = await apiPost(`/tournaments/${tid}/eliminations`, {
        player_id: elimTarget._id,
        eliminated_by: elimBy?._id || null,
      });
      setFinance(fin);
      setElimTarget(null); setElimBy(null);
      await refresh();
      if (fin.tournament?.status === 'finalized') {
        showAlert('Torneio finalizado!', 'success');
        onTournamentChange?.({ ...tournament, status: 'finalized' });
      }
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao registrar eliminação', 'error');
    }
  };

  const undoElim = async (elimId) => {
    if (!(await showConfirm('Desfazer esta eliminação? O jogador volta ao torneio.'))) return;
    try {
      setFinance(await apiDelete(`/tournaments/${tid}/eliminations/${elimId}`));
      await refresh();
      onTournamentChange?.({ ...tournament, status: 'running' });
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro', 'error');
    }
  };

  const s = finance?.summary;

  return (
    <div className="space-y-6">
      {/* Configuração */}
      <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-[#111111]">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-500">
            <DollarSign size={15} /> Configuração financeira
          </h3>
          <button onClick={() => setTplModal(true)} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-genesis-red">
            <Settings size={13} /> Templates
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Buy-in" value={cfg.buy_in} onChange={(v) => setCfg((c) => ({ ...c, buy_in: v }))} suffix="R$" />
          <Field label="Rake (fixo/entrada)" value={cfg.rake} onChange={(v) => setCfg((c) => ({ ...c, rake: v }))} suffix="R$" />
          <Field label="Bounty por KO" value={cfg.bounty_value} onChange={(v) => setCfg((c) => ({ ...c, bounty_value: v }))} suffix="R$" />
          <Field label="Add-on (valor)" value={cfg.addon_value} onChange={(v) => setCfg((c) => ({ ...c, addon_value: v }))} suffix="R$" />
          <Field label="Add-on (fichas)" value={cfg.addon_chips} onChange={(v) => setCfg((c) => ({ ...c, addon_chips: v }))} />
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Template de premiação</span>
            <select
              value={cfg.payout_template_id || ''}
              onChange={(e) => setCfg((c) => ({ ...c, payout_template_id: e.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold outline-none dark:border-zinc-800 dark:bg-zinc-900"
            >
              <option value="">— nenhum —</option>
              {templates.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        {canEdit && (
          <button onClick={saveCfg} disabled={savingCfg} className="mt-4 flex items-center gap-2 rounded-xl bg-genesis-red px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700 disabled:opacity-50">
            <Save size={14} /> Salvar configuração
          </button>
        )}
      </section>

      {/* Resumo */}
      {s && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Prize pool" value={brl(s.prize_pool)} accent="text-emerald-500" />
          <Stat label="Bounties (pool)" value={brl(s.bounty_pool)} accent="text-amber-500" />
          <Stat label="Rake arrecadado" value={brl(s.rake_collected)} accent="text-genesis-red" />
          <Stat label="Bruto" value={brl(s.gross)} />
          <Stat label="Buy-ins" value={s.buyins} />
          <Stat label="Re-entries" value={s.reentries} />
          <Stat label="Add-ons" value={s.addons} />
          <Stat label="Jogadores em jogo" value={finance.players_remaining} accent="text-blue-500" />
        </section>
      )}

      {/* Premiação calculada */}
      {finance?.payouts?.length > 0 && (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-[#111111]">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-500"><Trophy size={15} /> Premiação ({s.total_entries} inscritos)</h3>
          <div className="space-y-1.5">
            {finance.payouts.map((p) => (
              <div key={p.place} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5 dark:bg-zinc-900/60">
                <span className="font-black text-gray-700 dark:text-gray-200">{p.place}º lugar <span className="text-xs font-bold text-gray-400">({p.pct}%)</span></span>
                <span className="font-black tabular-nums text-emerald-600 dark:text-emerald-400">{brl(p.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {finance && finance.payouts.length === 0 && cfg.payout_template_id && (
        <p className="rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          O template não tem faixa para {s?.total_entries || 0} inscrito(s).
        </p>
      )}

      {/* Eliminações / Resultado */}
      <section className="rounded-3xl border border-gray-200 bg-white p-6 dark:border-zinc-800 dark:bg-[#111111]">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-500">
          {finalized ? <Trophy size={15} /> : <Skull size={15} />} {finalized ? 'Resultado final' : 'Eliminações'}
        </h3>

        {!finalized && canEdit && (
          <div className="mb-4 space-y-3 rounded-2xl bg-gray-50 p-4 dark:bg-zinc-900/60">
            <div>
              <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Quem foi eliminado</span>
              <PlayerSelect value={elimTarget} onChange={setElimTarget} placeholder="Jogador eliminado…" />
            </div>
            {tournament.bounty_value > 0 && (
              <div>
                <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-gray-400">Eliminado por (ganha o bounty)</span>
                <PlayerSelect value={elimBy} onChange={setElimBy} placeholder="Eliminador (opcional)…" />
              </div>
            )}
            <button
              onClick={doEliminate}
              disabled={!elimTarget}
              className="w-full rounded-xl bg-gray-900 py-3 text-xs font-black uppercase tracking-widest text-white hover:bg-genesis-red disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-genesis-red dark:hover:text-white"
            >
              Registrar eliminação
            </button>
          </div>
        )}

        <div className="space-y-1.5">
          {results.length === 0 && <p className="text-sm text-gray-400">Nenhuma eliminação registrada.</p>}
          {results.map((r) => (
            <div key={r.position} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-2.5 text-sm dark:bg-zinc-900/60">
              <span className="flex items-center gap-2">
                <span className={`font-black tabular-nums ${r.position === 1 ? 'text-genesis-red' : 'text-gray-400'}`}>{r.position}º</span>
                <span className="font-bold text-gray-800 dark:text-gray-100">{r.player?.name || '—'}</span>
              </span>
              <span className="flex items-center gap-3">
                {r.prize > 0 && <span className="font-black tabular-nums text-emerald-600 dark:text-emerald-400">{brl(r.prize)}</span>}
                {r.bounty_won > 0 && <span className="text-xs font-black text-amber-500">+{brl(r.bounty_won)} KO</span>}
                {!finalized && canEdit && (
                  <button onClick={() => undoElim(finance?.eliminations?.find((e) => e.position === r.position)?._id)} className="text-gray-300 hover:text-genesis-red" title="Desfazer">
                    <RotateCcw size={13} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      <PayoutTemplatesModal open={tplModal} onClose={() => setTplModal(false)} onChanged={refresh} />
    </div>
  );
}
