import { locale } from '../lib/i18n';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, Plus, Trash2, X, Calculator, Edit2 } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import CustomSelect from '../components/CustomSelect';

const DEFAULT_ACTIONS = [
  { key: 'buy_in', label: 'Buy-in padrão' },
  { key: 'optional_buy_in', label: 'Buy-in opcional' },
  { key: 're_entry', label: 'Reentrada' },
];
const EMPTY_FORM = { name: '', notes: '', actions: DEFAULT_ACTIONS, rows: [{ chip_id: '', quantities: {} }] };
const chipId = (l) => l.chip_id?._id || l.chip_id;
const fmt = (n) => (n ?? 0).toLocaleString(locale());

// chave estável (snake_case) a partir do rótulo digitado: "Buy-in VIP" → "buy_in_vip"
const slugKey = (label) => label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'a_$1').slice(0, 40);

// Modelo de stack = grade FICHA × AÇÃO: quantas fichas de cada denominação uma entrada recebe em cada
// tipo de ação. Os totais e a necessidade de fichas são calculados NO SERVIDOR; aqui só exibimos.
export default function ModelosStack() {
  const { showAlert, showConfirm } = useAlert();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [stacks, setStacks] = useState([]);
  const [chips, setChips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [newAction, setNewAction] = useState('');

  // simulação de necessidade
  const [calc, setCalc] = useState(null); // { stack, counts, result }

  const fetchData = async () => {
    try {
      const [s, c] = await Promise.all([apiGet('/stacks'), apiGet('/chips?active=true')]);
      setStacks(s);
      setChips(c);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar modelos de stack', 'error');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchData(); }, []);

  const chipById = useMemo(() => new Map(chips.map((c) => [c._id, c])), [chips]);

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setNewAction(''); setIsModalOpen(true); };
  const openEdit = (s) => {
    setEditing(s);
    setForm({
      name: s.name, notes: s.notes || '', actions: s.actions.map((a) => ({ ...a })),
      rows: s.composition.map((l) => ({ chip_id: chipId(l), quantities: { ...(l.quantities || {}) } })),
    });
    setNewAction('');
    setIsModalOpen(true);
  };

  const setQty = (i, key, value) => setForm((f) => ({
    ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, quantities: { ...r.quantities, [key]: value } } : r)),
  }));
  const setChip = (i, id) => setForm((f) => ({ ...f, rows: f.rows.map((r, idx) => (idx === i ? { ...r, chip_id: id } : r)) }));

  const addAction = () => {
    const label = newAction.trim();
    const key = slugKey(label);
    if (!label || !key) return;
    if (form.actions.some((a) => a.key === key)) return showAlert('Já existe uma coluna com esse nome.', 'error');
    setForm((f) => ({ ...f, actions: [...f.actions, { key, label }] }));
    setNewAction('');
  };
  const removeAction = (key) => {
    if (form.actions.length <= 1) return;
    setForm((f) => ({
      ...f, actions: f.actions.filter((a) => a.key !== key),
      rows: f.rows.map((r) => { const q = { ...r.quantities }; delete q[key]; return { ...r, quantities: q }; }),
    }));
  };

  // fichas ativas (ou inativas que já estavam no modelo), sem repetir
  const optionsFor = (rowIndex) => {
    const taken = new Set(form.rows.filter((_, i) => i !== rowIndex).map((r) => r.chip_id));
    const original = new Set((editing?.composition || []).map(chipId));
    return chips
      .filter((c) => (c.active !== false || original.has(c._id)) && !taken.has(c._id))
      .map((c) => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}` }));
  };

  // PRÉVIA do valor de cada coluna (informativa — o servidor recalcula ao salvar)
  const previewTotal = (key) => form.rows.reduce((a, r) => a + (Number(r.quantities[key]) || 0) * (chipById.get(r.chip_id)?.value || 0), 0);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert('Informe o nome do modelo.', 'error');
    const rows = form.rows.filter((r) => r.chip_id);
    if (!rows.length) return showAlert('Adicione ao menos uma ficha.', 'error');
    const payload = {
      name: form.name.trim(), notes: form.notes, actions: form.actions,
      composition: rows.map((r) => ({
        chip_id: r.chip_id,
        quantities: Object.fromEntries(Object.entries(r.quantities).map(([k, v]) => [k, Number(v) || 0])),
      })),
    };
    try {
      if (editing) await apiPut(`/stacks/${editing._id}`, payload);
      else await apiPost('/stacks', payload);
      showAlert(editing ? 'Modelo atualizado!' : 'Modelo de stack salvo!', 'success');
      setIsModalOpen(false);
      fetchData();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao salvar modelo', 'error');
    }
  };

  const handleDelete = async (s) => {
    if (!(await showConfirm(`Remover o modelo "${s.name}"?`))) return;
    try {
      await apiDelete(`/stacks/${s._id}`);
      showAlert('Modelo removido', 'success');
      fetchData();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao remover modelo', 'error');
    }
  };

  // ── simulação: "informe as ações → o servidor calcula a necessidade" ────────
  const openCalc = (stack) => setCalc({ stack, counts: {}, result: null });
  const runCalc = async () => {
    const counts = Object.fromEntries(Object.entries(calc.counts).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0));
    if (!Object.keys(counts).length) return showAlert('Informe a quantidade de ao menos uma ação.', 'error');
    try {
      const result = await apiPost(`/stacks/${calc.stack._id}/needs`, { counts });
      setCalc((c) => ({ ...c, result }));
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao calcular', 'error');
    }
  };

  const inputCls = 'w-full bg-sunken border border-line rounded-2xl px-5 py-3 text-sm focus:ring-2 focus:ring-brand outline-none transition-all font-bold';

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Modelos de Stack</h1>
          <p className="page-sub">Quantas fichas cada entrada recebe em cada tipo de ação (buy-in, opcional, reentrada…)</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="btn btn-primary flex items-center">
            <Plus size={20} /> Novo Modelo
          </button>
        )}
      </header>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-pulse">
          {[1, 2].map((i) => <div key={i} className="h-64 bg-raised rounded-3xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {stacks.map((stack) => (
            <motion.div key={stack._id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="card p-6 overflow-hidden">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-3 bg-brand-soft text-brand-fg rounded-2xl shrink-0"><Layers size={20} /></div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-fg truncate">{stack.name}</h3>
                    {stack.notes && <p className="text-xs text-fg-subtle truncate">{stack.notes}</p>}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openCalc(stack)} title="Simular necessidade de fichas" className="p-2 rounded-xl border border-line text-fg-subtle hover:text-emerald-500"><Calculator size={16} /></button>
                  {isAdmin && <button onClick={() => openEdit(stack)} title="Editar" className="p-2 rounded-xl border border-line text-fg-subtle hover:text-blue-500"><Edit2 size={16} /></button>}
                  {isAdmin && <button onClick={() => handleDelete(stack)} title="Excluir" className="p-2 rounded-xl border border-line text-fg-subtle hover:text-red-500"><Trash2 size={16} /></button>}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-fg-subtle">
                      <th className="text-left py-2 pr-3 font-bold">Ficha</th>
                      {stack.actions.map((a) => <th key={a.key} className="text-right py-2 px-2 font-bold whitespace-nowrap">{a.label}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {stack.composition.map((l) => (
                      <tr key={chipId(l)}>
                        <td className="py-2 pr-3">
                          <span className="inline-flex items-center gap-2 font-bold text-fg">
                            <span className="w-3 h-3 rounded-full border border-line" style={{ backgroundColor: l.chip_id?.color }} />
                            {fmt(l.chip_id?.value)}
                          </span>
                        </td>
                        {stack.actions.map((a) => (
                          <td key={a.key} className="text-right py-2 px-2 font-bold tabular-nums text-fg-muted">
                            {l.quantities?.[a.key] ? l.quantities[a.key] : <span className="text-gray-300 dark:text-zinc-700">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line">
                      <td className="py-2 pr-3 text-xs uppercase tracking-wide font-bold text-fg-subtle">Valor do stack</td>
                      {stack.actions.map((a) => <td key={a.key} className="text-right py-2 px-2 font-bold text-emerald-600 dark:text-emerald-500 tabular-nums">{fmt(stack.totals?.[a.key])}</td>)}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </motion.div>
          ))}
          {stacks.length === 0 && (
            <div className="col-span-full py-20 text-center text-fg-subtle font-medium italic">
              Nenhum modelo de stack criado.{isAdmin ? '' : ' Peça ao administrador para cadastrar.'}
            </div>
          )}
        </div>
      )}

      {/* Criar / editar */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div initial={{ y: 50, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 50, opacity: 0 }} className="card relative w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
              <form onSubmit={handleSave} className="flex flex-col min-h-0">
                <div className="p-6 border-b border-line-soft flex justify-between items-center shrink-0">
                  <div>
                    <h2 className="text-2xl font-bold text-fg">{editing ? 'Editar modelo' : 'Novo modelo de stack'}</h2>
                    <p className="text-fg-muted text-sm font-medium">Fichas que UMA entrada recebe, por ação. O valor de cada coluna é calculado automaticamente.</p>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-fg-subtle hover:text-gray-600"><X /></button>
                </div>

                <div className="p-6 overflow-y-auto space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Nome do modelo</label>
                      <input required type="text" placeholder="Ex: Warm Up" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Observações (opcional)</label>
                      <input type="text" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} />
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="text-xs uppercase tracking-wide text-fg-subtle">
                          <th className="text-left py-2 pr-3 font-bold w-56">Ficha</th>
                          {form.actions.map((a) => (
                            <th key={a.key} className="py-2 px-1 font-bold text-center whitespace-nowrap">
                              {a.label}
                              {form.actions.length > 1 && (
                                <button type="button" onClick={() => removeAction(a.key)} title="Remover coluna" className="ml-1 text-gray-300 hover:text-red-500 align-middle"><X size={11} /></button>
                              )}
                            </th>
                          ))}
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {form.rows.map((row, i) => (
                          <tr key={i}>
                            <td className="py-1.5 pr-3"><CustomSelect options={optionsFor(i)} value={row.chip_id} onChange={(v) => setChip(i, v)} placeholder="Ficha..." /></td>
                            {form.actions.map((a) => (
                              <td key={a.key} className="py-1.5 px-1">
                                <input
                                  type="number" min="0" step="1" value={row.quantities[a.key] ?? ''} placeholder="0"
                                  onChange={(e) => setQty(i, a.key, e.target.value)}
                                  className="input w-full min-w-[64px] text-center"
                                />
                              </td>
                            ))}
                            <td className="py-1.5 pl-1"><button type="button" onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, idx) => idx !== i) }))} className="p-1.5 text-fg-subtle hover:text-red-500"><Trash2 size={15} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-line">
                          <td className="py-2 pr-3 text-xs uppercase tracking-wide font-bold text-fg-subtle">Valor do stack (prévia)</td>
                          {form.actions.map((a) => <td key={a.key} className="text-center py-2 font-bold text-emerald-600 dark:text-emerald-500 tabular-nums">{fmt(previewTotal(a.key))}</td>)}
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, { chip_id: '', quantities: {} }] }))} className="text-sm font-bold text-brand-fg hover:text-red-700 flex items-center gap-1"><Plus size={14} /> Adicionar ficha</button>
                    <span className="text-gray-300">|</span>
                    <input
                      type="text" value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder="Nova coluna (ex.: Add-on)"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAction(); } }}
                      className="input"
                    />
                    <button type="button" onClick={addAction} className="text-sm font-bold text-brand-fg hover:text-red-700">Adicionar coluna</button>
                  </div>
                  <p className="text-xs text-fg-subtle">
                    Para o add-on usar fichas, crie uma coluna chamada <b>Add-on</b>. Reentrada e Add-on são ações fixas; as demais colunas são variantes de buy-in.
                  </p>
                </div>

                <div className="p-6 border-t border-line-soft shrink-0">
                  <button type="submit" className="w-full py-4 bg-brand text-white font-bold rounded-2xl hover:bg-brand-hover active:scale-95 transition-all text-sm">Salvar modelo</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Simulação de necessidade (calculada no servidor) */}
      <AnimatePresence>
        {calc && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCalc(null)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card relative w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl">
              <div className="p-6 border-b border-line-soft flex justify-between items-center">
                <h2 className="flex items-center gap-2 text-xl font-bold text-fg"><Calculator className="text-brand-fg" size={20} /> Quantas fichas preciso?</h2>
                <button onClick={() => setCalc(null)} className="text-fg-subtle hover:text-gray-600"><X /></button>
              </div>
              <div className="p-6 space-y-4">
                <p className="text-xs text-fg-muted">Informe só a <b>quantidade de ações</b> de "{calc.stack.name}". O sistema calcula as fichas por denominação.</p>
                <div className="grid grid-cols-2 gap-3">
                  {calc.stack.actions.map((a) => (
                    <div key={a.key}>
                      <label className="text-xs font-bold text-fg-subtle uppercase tracking-wide block mb-1">{a.label}</label>
                      <input
                        type="number" min="0" step="1" placeholder="0" value={calc.counts[a.key] ?? ''}
                        onChange={(e) => setCalc((c) => ({ ...c, counts: { ...c.counts, [a.key]: e.target.value }, result: null }))}
                        className="input w-full"
                      />
                    </div>
                  ))}
                </div>
                <button onClick={runCalc} className="w-full py-3 bg-brand text-white font-bold rounded-xl hover:bg-brand-hover text-xs">Calcular</button>

                {calc.result && (
                  <div className="space-y-2 pt-2">
                    {calc.result.rows.map((r) => (
                      <div key={r.chip._id} className="flex items-center justify-between rounded-xl bg-sunken px-4 py-2.5 text-sm">
                        <span className="flex items-center gap-2 font-bold text-fg">
                          <span className="w-3 h-3 rounded-full border border-line" style={{ backgroundColor: r.chip.color }} /> Ficha {fmt(r.chip.value)}
                        </span>
                        <span className="font-bold tabular-nums text-fg">{fmt(r.quantity)} <span className="text-xs font-bold text-fg-subtle">un.</span></span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-line pt-3 text-sm font-bold">
                      <span className="text-fg-muted">Total ({fmt(calc.result.totals.quantity)} fichas)</span>
                      <span className="text-emerald-600 dark:text-emerald-500 tabular-nums">valor {fmt(calc.result.totals.value)}</span>
                    </div>
                    {calc.result.uncovered.length > 0 && (
                      <p className="text-xs text-amber-600">Sem fichas definidas para: {calc.result.uncovered.map((u) => u.label).join(', ')}.</p>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
