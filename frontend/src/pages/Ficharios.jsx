import { useState, useEffect } from 'react';
import { Briefcase, Plus, Trash2, Edit2, X, AlertCircle, Link2, PackageCheck, PackagePlus, Boxes, Grid3x3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import CustomSelect from '../components/CustomSelect';
import AllocationMatrix from '../components/AllocationMatrix';

export default function Ficharios() {
  const { showAlert, showConfirm } = useAlert();
  // Criar/editar/excluir fichário é cadastro estrutural: só admin (o backend também barra).
  const isAdmin = getStoredUser()?.role === 'admin';
  const [cases, setCases] = useState([]);
  const [availableChips, setAvailableChips] = useState([]);
  const [binderModels, setBinderModels] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState(null);
  // O CONTEÚDO do fichário não é digitado: é derivado das movimentações (montagem, retiradas, conferências).
  const [form, setForm] = useState({ name: '', code: '', model_id: '', assemble_now: true });

  // Montagem (admin): lança ASSEMBLY no fichário
  const [assembleCase, setAssembleCase] = useState(null);
  const [assembleRows, setAssembleRows] = useState([{ chip_id: '', quantity: '' }]);
  const [assembleReason, setAssembleReason] = useState(''); // montagem é administrativa: exige motivo (G11)

  // Multi-allocation modal state
  const [isAllocModalOpen, setIsAllocModalOpen] = useState(false);
  const [allocatingCase, setAllocatingCase] = useState(null);

  // Conferência física
  const [countCase, setCountCase] = useState(null);
  const [countValues, setCountValues] = useState({});
  const [countReason, setCountReason] = useState('');

  // Disponibilidade: matriz ficha × torneio (saldo, alocado a quem, livre) — vinda do servidor
  const [matrixBinder, setMatrixBinder] = useState(null);
  const [matrix, setMatrix] = useState(null);
  const openMatrix = async (c) => {
    setMatrixBinder(c);
    setMatrix(null);
    try { setMatrix(await apiGet('/allocations/matrix', { binder_id: c._id })); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar a disponibilidade', 'error'); setMatrixBinder(null); }
  };

  useEffect(() => {
    if (countCase) {
      const init = {};
      countCase.chips.forEach((c) => { if (c.chip_id) init[c.chip_id._id || c.chip_id] = c.quantity; });
      setCountValues(init);
      setCountReason('');
    }
  }, [countCase]);

  const submitCount = async () => {
    const counts = Object.entries(countValues).map(([chip_id, counted]) => ({ chip_id, counted: Number(counted) || 0 }));
    try {
      const res = await apiPost(`/binders/${countCase._id}/count`, { counts, reason: countReason.trim() });
      const nDiff = res.diffs.length;
      showAlert(nDiff === 0 ? 'Conferência OK — sem diferenças.' : `Conferência registrada: ${nDiff} ocorrência(s) aberta(s) (veja em Ocorrências).`, nDiff === 0 ? 'success' : 'info');
      setCountCase(null);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao registrar conferência', 'error');
    }
  };

  const fetchInitialData = async () => {
    try {
      const [casesData, chipsData, modelsData] = await Promise.all([apiGet('/binders'), apiGet('/chips'), apiGet('/binder-models')]);
      setCases(casesData);
      setAvailableChips(chipsData);
      setBinderModels(modelsData);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichários', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInitialData(); }, []);

  // ── SAVE CASE ────────────────────────────────────────────────
  const handleSaveCase = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert('Informe o nome do fichário.', 'error');

    const payload = { name: form.name.trim(), code: form.code.trim(), model_id: form.model_id || null };
    try {
      if (editingCase) {
        await apiPut(`/binders/${editingCase._id}`, payload);
        showAlert('Fichário salvo com sucesso!', 'success');
      } else {
        const created = await apiPost('/binders', payload);
        if (form.model_id && form.assemble_now) {
          await apiPost(`/binders/${created._id}/assemble`, { from_model: true });
          showAlert('Fichário criado e montado a partir do modelo!', 'success');
        } else {
          showAlert('Fichário criado (vazio). Use "Montar" para lançar as fichas.', 'success');
        }
      }
      setIsModalOpen(false);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar fichário', 'error');
    }
  };

  // ── MONTAGEM (ASSEMBLY) ──────────────────────────────────────
  const openAssemble = (c) => {
    setAssembleCase(c);
    setAssembleRows([{ chip_id: '', quantity: '' }]);
    setAssembleReason('');
  };
  const updateAssembleRow = (i, field, value) => setAssembleRows(rows => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const submitAssemble = async (fromModel) => {
    let body;
    if (fromModel) body = { from_model: true };
    else {
      const items = assembleRows.filter(r => r.chip_id || r.quantity);
      if (!items.length || items.some(r => !r.chip_id || !(Number(r.quantity) >= 1) || !Number.isInteger(Number(r.quantity)))) {
        return showAlert('Cada linha precisa de uma ficha e de uma quantidade inteira maior que zero.', 'error');
      }
      if (!assembleReason.trim()) return showAlert('Informe o motivo da montagem (ex.: compra do lote, reposição).', 'error');
      body = { items: items.map(r => ({ chip_id: r.chip_id, quantity: Number(r.quantity) })), reason: assembleReason.trim() };
    }
    try {
      const res = await apiPost(`/binders/${assembleCase._id}/assemble`, body);
      showAlert(`Montagem registrada (${res.movements} lançamento(s)).`, 'success');
      setAssembleCase(null);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao montar fichário', 'error');
    }
  };

  const handleDeleteCase = async (id) => {
    const confirmed = await showConfirm('Tem certeza que deseja excluir este fichário?');
    if (!confirmed) return;
    try {
      await apiDelete(`/binders/${id}`);
      showAlert('Fichário excluído', 'success');
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao excluir fichário', 'error');
    }
  };

  const openCreateModal = () => {
    setEditingCase(null);
    setForm({ name: '', code: '', model_id: '', assemble_now: true });
    setIsModalOpen(true);
  };

  const openEditModal = (c) => {
    setEditingCase(c);
    setForm({ name: c.name, code: c.code || '', model_id: c.model_id?._id || c.model_id || '', assemble_now: false });
    setIsModalOpen(true);
  };

  const selectModel = (modelId) => {
    const model = binderModels.find((m) => m._id === modelId);
    setForm({ ...form, model_id: modelId || '', name: !editingCase && model && !form.name ? model.name : form.name });
  };

  const chipOptions = () => availableChips
    .filter((c) => c.active !== false)
    .map((c) => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}` }));

  // ── Allocations label ────────────────────────────────────────
  const getAllocLabel = (c) => {
    const allocs = c.allocations || [];
    if (allocs.length === 0) return null;
    if (allocs.length === 1) return `Em Uso: ${allocs[0].tournament_name}`;
    return `Compartilhado (${allocs.length} torneios)`;
  };

  const getStatusBadge = (c) => {
    const allocs = c.allocations || [];
    if (c.status === 'maintenance') return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-500">Manutenção</span>;
    if (allocs.length >= 2) return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-500">Compartilhado ({allocs.length})</span>;
    if (allocs.length === 1) {
      const name = allocs[0]?.tournament_name;
      return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 truncate max-w-[150px]" title={name}>Em Uso: {name}</span>;
    }
    return <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Disponível</span>;
  };

  // animations
  const containerAnim = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const cardAnim = { hidden: { opacity: 0, scale: 0.95, y: 20 }, show: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } } };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Fichários físicos</h1>
          <p className="text-gray-500 dark:text-gray-400">Cada fichário é uma unidade real, criada a partir de um modelo. O estoque fica separado por fichário.</p>
        </div>
        {isAdmin && (
          <button onClick={openCreateModal} className="w-full md:w-auto px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
            <Plus size={18} /> Novo Fichário
          </button>
        )}
      </motion.div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando fichários...</div>
      ) : cases.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-12 text-center border-2 border-dashed border-gray-200 dark:border-zinc-800 rounded-3xl text-gray-400">
          Nenhum fichário cadastrado no sistema.
        </motion.div>
      ) : (
        <motion.div variants={containerAnim} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((c) => {
            const totalChips = c.chips.reduce((acc, curr) => acc + (curr.quantity || 0), 0);
            const totalValue = c.chips.reduce((acc, curr) => acc + ((curr.quantity || 0) * (curr.chip_id ? curr.chip_id.value : 0)), 0);
            const allocs = c.allocations || [];

            return (
              <motion.div key={c._id} variants={cardAnim} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl shadow-lg hover:shadow-xl transition-all overflow-hidden flex flex-col">
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-start bg-gray-50 dark:bg-[#111111]">
                  <div className="min-w-0 flex-1 mr-3">
                    <h3 className="font-bold text-xl text-gray-900 dark:text-white flex items-center gap-2 mb-2">
                      <Briefcase className="text-genesis-red shrink-0" size={20} />
                      <span className="truncate">{c.name}</span>
                    </h3>
                    {getStatusBadge(c)}
                    {(c.model_id?.name || c.code) && (
                      <p className="mt-2 text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                        {c.model_id?.name && <span className="inline-flex items-center gap-1"><Boxes size={11} className="text-genesis-red" /> Modelo {c.model_id.name}</span>}
                        {c.code && <span className="font-mono px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800">{c.code}</span>}
                      </p>
                    )}
                    {/* Show all allocations if shared */}
                    {allocs.length >= 2 && (
                      <div className="mt-2 space-y-1">
                        {allocs.map((al, i) => (
                          <p key={i} className="text-xs text-gray-500 flex items-center gap-1">
                            <Link2 size={10} className="text-purple-400" /> {al.tournament_name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => openMatrix(c)} title="Disponibilidade por torneio" className="p-2 text-gray-400 hover:text-purple-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Grid3x3 size={16} /></button>
                    {isAdmin && (
                      <button onClick={() => openAssemble(c)} title="Montar / adicionar fichas" className="p-2 text-gray-400 hover:text-emerald-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><PackagePlus size={16} /></button>
                    )}
                    {c.chips.length > 0 && (
                      <button onClick={() => setCountCase(c)} title="Conferência física" className="p-2 text-gray-400 hover:text-genesis-red bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><PackageCheck size={16} /></button>
                    )}
                    {isAdmin && <button onClick={() => openEditModal(c)} title="Editar" className="p-2 text-gray-400 hover:text-blue-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Edit2 size={16} /></button>}
                    {isAdmin && c.status !== 'allocated' && allocs.length === 0 && (
                      <button onClick={() => handleDeleteCase(c._id)} className="p-2 text-gray-400 hover:text-red-500 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-lg transition-colors shadow-sm"><Trash2 size={16} /></button>
                    )}
                  </div>
                </div>

                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs uppercase font-bold tracking-widest text-gray-400 mb-4 border-b border-gray-100 dark:border-zinc-800/50 pb-2">Conteúdo do Fichário</p>
                    {c.chips.length === 0 ? (
                      <p className="text-sm text-gray-400 italic">Fichário vazio.</p>
                    ) : (
                      <ul className="space-y-3 mb-6">
                        {c.chips.map((item, idx) => item.chip_id && (
                          <li key={idx} className="flex justify-between items-center text-sm font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border border-gray-200 dark:border-zinc-700 shadow-sm" style={{ backgroundColor: item.chip_id.color || 'transparent' }}></div>
                              <span className="text-gray-700 dark:text-gray-300">{item.chip_id.name}</span>
                            </div>
                            <span className="font-bold text-gray-900 dark:text-white">{item.quantity.toLocaleString()} un.</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pt-4 border-t border-gray-100 dark:border-zinc-800/50 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-500">Total Fichas</p>
                      <p className="font-black text-gray-900 dark:text-white text-lg">{totalChips.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Valor em Jogo (MGS)</p>
                      <p className="font-black text-emerald-600 dark:text-emerald-500 text-lg">{totalValue.toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ── Modal Criar/Editar ──────────────────────────────────── */}
      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={() => setIsModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div
                initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }} transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-xl shadow-2xl flex flex-col relative my-8"
              >
                {/* Header */}
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] shrink-0 rounded-t-3xl">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                    <Briefcase className="text-genesis-red" size={20} />
                    {editingCase ? 'Editar Fichário' : 'Novo Fichário'}
                  </h2>
                  <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Identificação do fichário</label>
                      <input
                        type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                        className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white"
                        required placeholder="Ex: LISA 1"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Código</label>
                      <input
                        type="text" value={form.code} onChange={e => setForm({ ...form, code: e.target.value })}
                        className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white"
                        placeholder="Opcional"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300 flex items-center gap-2"><Boxes size={14} /> Modelo de fichário</label>
                    <CustomSelect
                      options={[{ value: '', label: 'Sem modelo (fichário avulso)' }, ...binderModels.map(m => ({ value: m._id, label: m.name }))]}
                      value={form.model_id}
                      onChange={selectModel}
                      placeholder="Selecione o modelo..."
                    />
                    <p className="mt-2 text-xs text-gray-500">
                      {editingCase
                        ? 'O modelo é a montagem padrão; alterá-lo aqui não recompõe o conteúdo.'
                        : 'Ao escolher um modelo, o conteúdo abaixo é preenchido com a montagem padrão. Vários fichários podem seguir o mesmo modelo.'}
                    </p>
                  </div>

                  {!editingCase && form.model_id && (
                    <label className="flex items-start gap-3 p-4 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-[#111111] cursor-pointer">
                      <input type="checkbox" checked={form.assemble_now} onChange={e => setForm({ ...form, assemble_now: e.target.checked })} className="mt-1 accent-red-600" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        <b>Montar agora</b> com a composição do modelo.
                        <span className="block text-xs text-gray-500 mt-0.5">Lança as fichas do modelo no fichário (uma movimentação de montagem, com histórico e estorno).</span>
                      </span>
                    </label>
                  )}
                  <p className="text-xs text-gray-500">
                    O conteúdo do fichário não é digitado: ele vem das movimentações (montagem, retiradas, perdas e conferências).
                  </p>

                  {editingCase?.status === 'allocated' && (
                    <div className="p-4 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl flex gap-3 text-amber-700 dark:text-amber-500 text-sm font-medium">
                      <AlertCircle className="shrink-0 mt-0.5" size={18} />
                      <p>Este fichário está atualmente alocado no torneio <b>{(editingCase.allocations || []).map((a) => a.tournament_name).join(', ')}</b>. Edite as quantidades com cuidado.</p>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] shrink-0 rounded-b-3xl">
                  <button onClick={handleSaveCase} className="w-full py-4 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg">
                    Salvar Fichário
                  </button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conferência física */}
      <AnimatePresence>
        {countCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCountCase(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md rounded-[32px] border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]"
            >
              <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
                <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
                  <PackageCheck size={20} className="text-genesis-red" /> Conferir "{countCase.name}"
                </h2>
                <button type="button" onClick={() => setCountCase(null)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-3 p-6">
                <p className="text-xs font-medium text-gray-500">Informe quantas fichas de cada denominação você contou. Falta vira perda (divergência) e sobra vira ajuste no livro-razão — nada é sobrescrito.</p>
                {countCase.chips.filter((c) => c.chip_id).map((c) => {
                  const id = c.chip_id._id || c.chip_id;
                  const counted = countValues[id];
                  const diff = (Number(counted) || 0) - c.quantity;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <div className="flex flex-1 items-center gap-2">
                        <span className="h-4 w-4 rounded-full" style={{ backgroundColor: c.chip_id.color }} />
                        <span className="text-sm font-bold text-gray-800 dark:text-gray-100">Ficha {c.chip_id.value}</span>
                        <span className="text-xs text-gray-400">esperado {c.quantity}</span>
                      </div>
                      <input
                        type="number" min="0"
                        value={counted ?? ''}
                        onChange={(e) => setCountValues((v) => ({ ...v, [id]: e.target.value }))}
                        className="w-24 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900"
                      />
                      <span className={`w-12 text-right text-xs font-black tabular-nums ${diff === 0 ? 'text-gray-300' : diff < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {diff > 0 ? '+' : ''}{diff || ''}
                      </span>
                    </div>
                  );
                })}
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-400">Justificativa (obrigatória para diferenças de severidade alta)</label>
                  <input
                    type="text" value={countReason} onChange={(e) => setCountReason(e.target.value)} placeholder="Ex.: contagem do fim do turno"
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              </div>
              <div className="flex gap-3 border-t border-gray-100 p-4 dark:border-zinc-800">
                <button onClick={() => setCountCase(null)} className="flex-1 rounded-xl bg-gray-100 py-3 text-xs font-black uppercase text-gray-600 dark:bg-zinc-800 dark:text-gray-300">Cancelar</button>
                <button onClick={submitCount} className="flex-1 rounded-xl bg-genesis-red py-3 text-xs font-black uppercase text-white hover:bg-red-700">Registrar conferência</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Montagem (ASSEMBLY) */}
      <AnimatePresence>
        {assembleCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAssembleCase(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg rounded-[32px] border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]"
            >
              <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
                <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
                  <PackagePlus size={20} className="text-genesis-red" /> Montar "{assembleCase.name}"
                </h2>
                <button type="button" onClick={() => setAssembleCase(null)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-4 p-6">
                {assembleCase.model_id?.name && (
                  <button
                    type="button" onClick={() => submitAssemble(true)}
                    className="w-full rounded-xl border-2 border-dashed border-emerald-400 p-3 text-sm font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-500/10"
                  >
                    <Boxes size={14} className="mr-2 inline" /> Lançar a composição do modelo "{assembleCase.model_id.name}"
                  </button>
                )}
                <p className="text-xs text-gray-500">Ou lance fichas avulsas. Cada montagem entra no livro-razão e pode ser estornada.</p>
                <div className="space-y-3">
                  {assembleRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-zinc-700/50 dark:bg-[#0c0c0c]">
                      <CustomSelect options={chipOptions()} value={row.chip_id} onChange={(v) => updateAssembleRow(i, 'chip_id', v)} placeholder="Selecione a ficha..." />
                      <input
                        type="number" min="1" step="1" placeholder="Qtd" value={row.quantity} onChange={(e) => updateAssembleRow(i, 'quantity', e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-center text-sm text-gray-900 focus:border-genesis-red focus:outline-none dark:border-zinc-700 dark:bg-[#141414] dark:text-white"
                      />
                      <button type="button" onClick={() => setAssembleRows(rows => rows.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setAssembleRows(rows => [...rows, { chip_id: '', quantity: '' }])} className="flex items-center gap-1 text-sm font-bold text-genesis-red hover:text-red-700">
                    <Plus size={14} /> Adicionar ficha
                  </button>
                  <input
                    type="text" value={assembleReason} onChange={(e) => setAssembleReason(e.target.value)} placeholder="Motivo da montagem (obrigatório)" aria-label="Motivo da montagem"
                    className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-genesis-red focus:outline-none dark:border-zinc-700 dark:bg-[#141414] dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 border-t border-gray-100 p-4 dark:border-zinc-800">
                <button onClick={() => setAssembleCase(null)} className="flex-1 rounded-xl bg-gray-100 py-3 text-xs font-black uppercase text-gray-600 dark:bg-zinc-800 dark:text-gray-300">Cancelar</button>
                <button onClick={() => submitAssemble(false)} className="flex-1 rounded-xl bg-genesis-red py-3 text-xs font-black uppercase text-white hover:bg-red-700">Lançar montagem</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Disponibilidade: saldo × alocado por torneio × livre */}
      <AnimatePresence>
        {matrixBinder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMatrixBinder(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-[32px] border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]">
              <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
                <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
                  <Grid3x3 size={20} className="text-genesis-red" /> Disponibilidade — {matrixBinder.name}
                </h2>
                <button type="button" onClick={() => setMatrixBinder(null)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-3 p-6">
                <p className="text-xs text-gray-500">O mesmo fichário pode atender mais de um torneio, desde que a soma alocada de cada ficha não passe do saldo. <b>Livre</b> = saldo − alocado.</p>
                {matrix ? <AllocationMatrix matrix={matrix} /> : <p className="py-6 text-center text-gray-400 animate-pulse">Carregando…</p>}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}