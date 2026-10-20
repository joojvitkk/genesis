import { locale } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { Target, Plus, Pencil, Trash2 } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import ColorPicker from '../components/ColorPicker';
import KoPanel from '../components/KoPanel';

const fmt = (n) => (n ?? 0).toLocaleString(locale());
const emptyForm = { name: '', color: '#dc2626', quantity: '', notes: '' };

/**
 * Fichas KO (Simulação 3.0 §5): estoque FÍSICO de fichas KO, separado das denominações de jogo — cor/tipo e quantidade.
 * Envio, retorno, conferência e justificativa de diferenças são lançados por torneio KO (os mesmos controles da aba Material).
 * Sem pagamentos, resgates ou relatórios monetários.
 */
export default function FichasKO() {
  const { showAlert, showConfirm } = useAlert();
  const role = getStoredUser()?.role;
  const isAdmin = role === 'admin';
  const canOperate = can(role, 'estoque', 'operate');
  const [chips, setChips] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [form, setForm] = useState(null);       // null = fechado; { _id?, ... }
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [k, t] = await Promise.all([apiGet('/ko-chips'), apiGet('/tournaments')]);
      setChips(k);
      setTournaments(t.filter((x) => x.is_ko));
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar as fichas KO', 'error'); } finally { setLoading(false); }
  }, [showAlert]);
  useEffect(() => { load(); }, [load]);

  const save = async (e) => {
    e.preventDefault();
    const body = { name: form.name.trim(), color: form.color, quantity: Number(form.quantity || 0), notes: form.notes || undefined };
    try {
      if (form._id) await apiPut(`/ko-chips/${form._id}`, body); else await apiPost('/ko-chips', body);
      showAlert('Ficha KO salva!', 'success');
      setForm(null);
      load();
    } catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro ao salvar', 'error'); }
  };
  const remove = async (c) => {
    if (!(await showConfirm(`Excluir a ficha KO "${c.name}"?`))) return;
    try { await apiDelete(`/ko-chips/${c._id}`); load(); } catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro ao excluir', 'error'); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><Target className="text-brand-fg" size={22} /> Fichas KO</h1>
          <p className="page-sub">Estoque físico de fichas KO, separado das fichas de jogo. Sem valores em dinheiro.</p>
        </div>
        {isAdmin && <button onClick={() => setForm({ ...emptyForm })} className="btn btn-primary"><Plus size={14} /> Nova ficha KO</button>}
      </header>

      {loading ? <div className="py-20 text-center text-fg-subtle animate-pulse">Carregando…</div> : (
        <>
          <section className="card p-0 overflow-hidden" data-testid="ko-stock">
            <div className="border-b border-line-soft p-5"><h2 className="font-bold uppercase tracking-tight text-fg">Estoque</h2></div>
            {chips.length === 0 ? <p className="p-10 text-center text-sm italic text-fg-subtle">Nenhuma ficha KO cadastrada.{isAdmin ? '' : ' O administrador cadastra as fichas KO.'}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead><tr className="text-xs uppercase tracking-wide text-fg-subtle">
                    {['Cor / tipo', 'Quantidade física', 'Fora do estoque', 'Disponível', ''].map((h, i) => <th key={h || 'a'} className={`px-4 py-3 font-bold ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-line-soft">
                    {chips.map((c) => (
                      <tr key={c._id}>
                        <td className="px-4 py-3 font-bold text-fg"><span className="mr-2 inline-block h-3 w-3 rounded-full border border-line align-middle" style={{ backgroundColor: c.color }} />{c.name}{c.notes ? <span className="ml-2 text-xs font-normal text-fg-subtle">{c.notes}</span> : null}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt(c.quantity)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-fg-muted">{fmt(c.stock?.out)}</td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-fg">{fmt(c.stock?.available)}</td>
                        <td className="px-4 py-3 text-right">
                          {isAdmin && (
                            <span className="inline-flex gap-1">
                              <button aria-label={`Editar ${c.name}`} title="Editar" onClick={() => setForm({ _id: c._id, name: c.name, color: c.color, quantity: String(c.quantity), notes: c.notes || '' })} className="btn btn-ghost btn-icon"><Pencil size={15} /></button>
                              <button aria-label={`Excluir ${c.name}`} title="Excluir" onClick={() => remove(c)} className="btn btn-ghost btn-icon"><Trash2 size={15} /></button>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <h2 className="text-lg font-bold text-fg">Torneios KO</h2>
          {tournaments.length === 0 ? <p className="text-sm italic text-fg-subtle">Nenhum torneio KO. Marque “É KO?” ao criar o torneio.</p> : tournaments.map((t) => (
            <div key={t._id} className="space-y-2">
              <p className="text-sm font-bold text-fg-muted">{t.name}</p>
              <KoPanel tournamentId={t._id} canOperate={canOperate} />
            </div>
          ))}
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => setForm(null)}>
          <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="card max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto p-6 shadow-2xl">
            <h3 className="text-lg font-bold">{form._id ? 'Editar ficha KO' : 'Nova ficha KO'}</h3>
            <div><label className="label" htmlFor="ko-name">Cor / tipo</label><input id="ko-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input w-full" placeholder="Ex.: KO vermelha" /></div>
            <div><label className="label">Cor</label><ColorPicker value={form.color} onChange={(color) => setForm({ ...form, color })} /></div>
            <div><label className="label" htmlFor="ko-qty">Quantidade física</label><input id="ko-qty" type="number" min="0" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="input w-full" /></div>
            <div><label className="label" htmlFor="ko-notes">Observação</label><input id="ko-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="input w-full" /></div>
            <div className="flex gap-2"><button type="button" onClick={() => setForm(null)} className="btn btn-secondary flex-1">Cancelar</button><button type="submit" className="btn btn-primary flex-1">Salvar</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
