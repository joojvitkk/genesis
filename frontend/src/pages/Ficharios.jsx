import { useState, useEffect } from 'react';
import { Briefcase, Plus, Trash2, X, Link2, PackageCheck, PackagePlus, Pencil, Archive, ArchiveRestore } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import CustomSelect from '../components/CustomSelect';

export default function Ficharios() {
  const { showAlert, showConfirm, showPrompt } = useAlert();
  // Criar/editar/excluir fichário é cadastro estrutural: só admin (o backend também barra).
  const role = getStoredUser()?.role;
  const isAdmin = role === 'admin';
  const canMove = can(role, 'estoque', 'operate'); // admin: entrada/saída/perda; material: só perda
  const [cases, setCases] = useState([]);
  const [availableChips, setAvailableChips] = useState([]);
  const [loading, setLoading] = useState(true);

  // O CONTEÚDO do fichário não é digitado: é derivado das movimentações (montagem, retiradas, conferências).

  // Montagem (admin): lança ASSEMBLY no fichário
  const [assembleCase, setAssembleCase] = useState(null);
  const [assembleRows, setAssembleRows] = useState([{ chip_id: '', quantity: '' }]);
  const [moveType, setMoveType] = useState('entrada');
  const [assembleReason, setAssembleReason] = useState(''); // montagem é administrativa: exige motivo (G11)

  // Cadastro (admin): fichário único com composição inicial (vira o saldo inicial e UM lançamento no livro-razão)
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', code: '' });
  const [createRows, setCreateRows] = useState([{ chip_id: '', quantity: '' }]);
  const openCreate = () => { setCreateForm({ name: '', code: '' }); setCreateRows([{ chip_id: '', quantity: '' }]); setCreateOpen(true); };
  const updateCreateRow = (i, field, value) => setCreateRows(rows => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  const submitCreate = async () => {
    if (!createForm.name.trim()) return showAlert('Informe o nome do fichário.', 'error');
    const items = createRows.filter(r => r.chip_id || r.quantity);
    if (items.some(r => !r.chip_id || !(Number(r.quantity) >= 1) || !Number.isInteger(Number(r.quantity)))) {
      return showAlert('Cada linha da composição precisa de uma ficha e de uma quantidade inteira maior que zero.', 'error');
    }
    try {
      await apiPost('/binders', {
        name: createForm.name.trim(), code: createForm.code.trim() || undefined,
        composition: items.map(r => ({ chip_id: r.chip_id, quantity: Number(r.quantity) })),
      });
      showAlert('Fichário cadastrado com o saldo inicial.', 'success');
      setCreateOpen(false);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao cadastrar fichário', 'error');
    }
  };

  // Conferência física
  const [countCase, setCountCase] = useState(null);
  const [countValues, setCountValues] = useState({});
  const [countReason, setCountReason] = useState('');

  // Edição (nome e código) e arquivamento. Fichário com histórico não se exclui: arquiva (some das seleções, histórico permanece).
  const [showArchived, setShowArchived] = useState(false);
  const [editCase, setEditCase] = useState(null);
  const [editForm, setEditForm] = useState({ name: '', code: '' });
  const openEdit = (c) => { setEditCase(c); setEditForm({ name: c.name || '', code: c.code || '' }); };
  const submitEdit = async () => {
    if (!editForm.name.trim()) return showAlert('Informe o nome do fichário.', 'error');
    try {
      await apiPut(`/binders/${editCase._id}`, { name: editForm.name.trim(), code: editForm.code.trim() });
      showAlert('Fichário atualizado.', 'success');
      setEditCase(null);
      await fetchInitialData();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao editar fichário', 'error'); }
  };
  const archive = async (c) => {
    const reason = await showPrompt(`Arquivar "${c.name}"? Ele some das seleções operacionais, mas o histórico e o Livro Razão permanecem. Motivo (opcional):`, { title: 'Arquivar fichário', confirmLabel: 'Arquivar' });
    if (reason === null || reason === undefined) return;
    try {
      await apiPost(`/binders/${c._id}/archive`, { reason });
      showAlert('Fichário arquivado.', 'success');
      await fetchInitialData();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao arquivar fichário', 'error'); }
  };
  const unarchive = async (c) => {
    try {
      await apiPost(`/binders/${c._id}/unarchive`, {});
      showAlert('Fichário reativado.', 'success');
      await fetchInitialData();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao reativar fichário', 'error'); }
  };
  const remove = async (c) => {
    if (!(await showConfirm(`Excluir "${c.name}" de vez? Só é possível porque ele não tem nenhuma movimentação.`))) return;
    try {
      await apiDelete(`/binders/${c._id}`);
      showAlert('Fichário excluído.', 'success');
      await fetchInitialData();
    } catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao excluir fichário', 'error'); }
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
      const [casesData, chipsData] = await Promise.all([apiGet('/binders', { archived: showArchived ? 'true' : undefined }), apiGet('/chips')]);
      setCases(casesData);
      setAvailableChips(chipsData);
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichários', 'error');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchInitialData(); }, [showArchived]);

  // ── MONTAGEM (ASSEMBLY) ──────────────────────────────────────
  const openAssemble = (c) => {
    setAssembleCase(c);
    setAssembleRows([{ chip_id: '', quantity: '' }]);
    setAssembleReason('');
    setMoveType(isAdmin ? 'entrada' : 'quebra');
  };
  const updateAssembleRow = (i, field, value) => setAssembleRows(rows => rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const submitAssemble = async () => {
    const items = assembleRows.filter(r => r.chip_id || r.quantity);
    if (!items.length || items.some(r => !r.chip_id || !(Number(r.quantity) >= 1) || !Number.isInteger(Number(r.quantity)))) {
      return showAlert('Cada linha precisa de uma ficha e de uma quantidade inteira maior que zero.', 'error');
    }
    if (!assembleReason.trim()) return showAlert('Informe o motivo (ex.: compra do lote, reposição).', 'error');
    const body = { items: items.map(r => ({ chip_id: r.chip_id, quantity: Number(r.quantity) })), reason: assembleReason.trim() };
    try {
      if (moveType === 'entrada') {
        const res = await apiPost(`/binders/${assembleCase._id}/assemble`, body);
        showAlert(`Fichas adicionadas (${res.movements} lançamento(s)).`, 'success');
      } else {
        const type = moveType === 'saida' ? 'WITHDRAWAL' : 'LOSS';
        for (const it of body.items) await apiPost('/movements', { type, binder_id: assembleCase._id, chip_id: it.chip_id, quantity: it.quantity, reason: body.reason });
        showAlert('Movimentação registrada no Livro Razão.', 'success');
      }
      setAssembleCase(null);
      await fetchInitialData();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao montar fichário', 'error');
    }
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
    if (c.archived) return <span className="badge badge-neutral">Arquivado</span>;
    if (c.status === 'maintenance') return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-500">Manutenção</span>;
    if (allocs.length >= 2) return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-500">Compartilhado ({allocs.length})</span>;
    if (allocs.length === 1) {
      const name = allocs[0]?.tournament_name;
      return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 truncate max-w-[150px]" title={name}>Em Uso: {name}</span>;
    }
    return <span className="px-3 py-1 rounded-full text-xs font-bold tracking-wider bg-emerald-100 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">Disponível</span>;
  };

  // animations
  const containerAnim = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } };
  const cardAnim = { hidden: { opacity: 0, scale: 0.95, y: 20 }, show: { opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } } };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="page-title">Fichários físicos</h1>
          <p className="page-sub">Cada fichário é uma unidade física única, com nome e composição própria. Mostra só quantidades físicas por denominação. A composição informada no cadastro vira o saldo inicial; depois, o saldo só muda por movimentação.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowArchived((v) => !v)} className="btn btn-secondary" aria-pressed={showArchived}>
            <Archive size={16} /> {showArchived ? 'Ver ativos' : 'Ver arquivados'}
          </button>
          {isAdmin && !showArchived && (
            <button onClick={openCreate} className="btn btn-primary flex items-center">
              <Plus size={16} /> Novo fichário
            </button>
          )}
        </div>
      </motion.div>

      {loading ? (
        <div className="text-center py-20 text-fg-subtle animate-pulse">Carregando fichários...</div>
      ) : cases.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-12 text-center border-2 border-dashed border-line rounded-3xl text-fg-subtle">
          {showArchived ? 'Nenhum fichário arquivado.' : 'Nenhum fichário cadastrado no sistema.'}
        </motion.div>
      ) : (
        <motion.div variants={containerAnim} initial="hidden" animate="show" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cases.map((c) => {
            const totalChips = c.chips.reduce((acc, curr) => acc + (curr.quantity || 0), 0);
            const allocs = c.allocations || [];

            return (
              <motion.div key={c._id} variants={cardAnim} className="card hover: transition-all flex flex-col overflow-hidden">
                <div className="p-6 border-b border-line-soft flex flex-wrap justify-between items-start gap-3 bg-sunken">
                  <div className="min-w-0 basis-full">
                    <h3 className="font-bold text-xl text-fg flex items-center gap-2 mb-2">
                      <Briefcase className="text-brand-fg shrink-0" size={20} />
                      <span className="truncate">{c.name}</span>
                    </h3>
                    {getStatusBadge(c)}
                    {c.code && <p className="mt-2 text-xs text-fg-muted"><span className="font-mono px-1.5 py-0.5 rounded bg-raised">{c.code}</span></p>}
                    {/* Show all allocations if shared */}
                    {allocs.length >= 2 && (
                      <div className="mt-2 space-y-1">
                        {allocs.map((al, i) => (
                          <p key={i} className="text-xs text-fg-muted flex items-center gap-1">
                            <Link2 size={10} className="text-purple-400" /> {al.tournament_name}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {isAdmin && !c.archived && <button onClick={() => openEdit(c)} title="Editar fichário" aria-label="Editar fichário" className="btn btn-ghost btn-icon"><Pencil size={16} /></button>}
                    {canMove && !c.archived && (
                      <button onClick={() => openAssemble(c)} title="Adicionar / movimentar fichas" aria-label="Adicionar fichas" className="btn btn-ghost btn-icon"><PackagePlus size={16} /></button>
                    )}
                    {!c.archived && c.chips.length > 0 && (
                      <button onClick={() => setCountCase(c)} title="Conferência física" aria-label="Conferência física" className="btn btn-ghost btn-icon"><PackageCheck size={16} /></button>
                    )}
                    {isAdmin && !c.archived && <button onClick={() => archive(c)} title="Arquivar fichário" aria-label="Arquivar fichário" className="btn btn-ghost btn-icon"><Archive size={16} /></button>}
                    {isAdmin && c.archived && <button onClick={() => unarchive(c)} title="Reativar fichário" aria-label="Reativar fichário" className="btn btn-ghost btn-icon"><ArchiveRestore size={16} /></button>}
                    {isAdmin && !c.archived && c.chips.length === 0 && <button onClick={() => remove(c)} title="Excluir (sem histórico)" aria-label="Excluir fichário" className="btn btn-ghost btn-icon"><Trash2 size={16} /></button>}
                  </div>
                </div>

                <div className="p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <p className="text-xs uppercase font-bold tracking-wide text-fg-subtle mb-4 border-b border-line-soft pb-2">Conteúdo do Fichário</p>
                    {c.chips.length === 0 ? (
                      <p className="text-sm text-fg-subtle italic">Fichário vazio.</p>
                    ) : (
                      <ul className="space-y-3 mb-6">
                        {c.chips.map((item, idx) => item.chip_id && (
                          <li key={idx} className="flex justify-between items-center text-sm font-medium">
                            <div className="flex items-center gap-2">
                              <div className="w-4 h-4 rounded-full border border-line" style={{ backgroundColor: item.chip_id.color || 'transparent' }}></div>
                              <span className="text-fg">{item.chip_id.name}</span>
                            </div>
                            <span className="font-bold text-fg">{item.quantity.toLocaleString()} un.</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="pt-4 border-t border-line-soft flex justify-between items-center">
                    <div>
                      <p className="text-xs text-fg-muted">Total Fichas</p>
                      <p className="font-bold text-fg text-lg">{totalChips.toLocaleString()}</p>
                    </div>
                    {c.archived && <span className="badge badge-neutral">Arquivado</span>}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Cadastro de fichário (único) com composição inicial */}
      <AnimatePresence>
        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCreateOpen(false)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="card relative w-full max-h-[92vh] overflow-y-auto max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line-soft p-6">
                <h2 className="flex items-center gap-2 text-xl font-bold text-fg"><Briefcase size={20} className="text-brand-fg" /> Novo fichário</h2>
                <button type="button" onClick={() => setCreateOpen(false)} aria-label="Fechar" className="text-fg-subtle hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-4 p-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input aria-label="Nome do fichário" placeholder="Nome (ex.: Drogon)" value={createForm.name} onChange={(e) => setCreateForm(f => ({ ...f, name: e.target.value }))} className="card px-3 py-2 text-sm" />
                  <input aria-label="Código" placeholder="Código" value={createForm.code} onChange={(e) => setCreateForm(f => ({ ...f, code: e.target.value }))} className="card px-3 py-2 text-sm" />
                </div>
                <p className="text-xs text-fg-muted">Composição inicial por denominação. Ela gera o saldo inicial e um único lançamento no livro-razão (sem etapa de montagem). Depois do cadastro o saldo só muda por movimentação.</p>
                <div className="space-y-3">
                  {createRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 rounded-xl border border-line bg-sunken p-3 dark:bg-sunken">
                      <CustomSelect options={chipOptions()} value={row.chip_id} onChange={(v) => updateCreateRow(i, 'chip_id', v)} placeholder="Selecione a ficha..." />
                      <input type="number" min="1" step="1" placeholder="Qtd" aria-label="Quantidade" value={row.quantity} onChange={(e) => updateCreateRow(i, 'quantity', e.target.value)} className="card w-full px-2 py-2 text-center text-sm" />
                      <button type="button" onClick={() => setCreateRows(rows => (rows.length > 1 ? rows.filter((_, idx) => idx !== i) : [{ chip_id: '', quantity: '' }]))} className="p-2 text-fg-subtle hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setCreateRows(rows => [...rows, { chip_id: '', quantity: '' }])} className="flex items-center gap-1 text-sm font-bold text-brand-fg hover:text-red-700"><Plus size={14} /> Adicionar ficha</button>
                </div>
              </div>
              <div className="flex gap-3 border-t border-line-soft p-4">
                <button onClick={() => setCreateOpen(false)} className="flex-1 rounded-xl bg-raised py-3 text-xs font-bold text-fg-muted dark:bg-zinc-800">Cancelar</button>
                <button onClick={submitCreate} className="flex-1 rounded-xl bg-brand py-3 text-xs font-bold text-white hover:bg-brand-hover">Cadastrar fichário</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Conferência física */}
      <AnimatePresence>
        {countCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCountCase(null)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="card relative w-full max-h-[92vh] overflow-y-auto max-w-md shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line-soft p-6">
                <h2 className="flex items-center gap-2 text-xl font-bold text-fg">
                  <PackageCheck size={20} className="text-brand-fg" /> Conferir "{countCase.name}"
                </h2>
                <button type="button" onClick={() => setCountCase(null)} className="text-fg-subtle hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-3 p-6">
                <p className="text-xs font-medium text-fg-muted">Informe quantas fichas de cada denominação você contou. Falta vira perda (divergência) e sobra vira ajuste no livro-razão — nada é sobrescrito.</p>
                {countCase.chips.filter((c) => c.chip_id).map((c) => {
                  const id = c.chip_id._id || c.chip_id;
                  const counted = countValues[id];
                  const diff = (Number(counted) || 0) - c.quantity;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <div className="flex flex-1 items-center gap-2">
                        <span className="h-4 w-4 rounded-full" style={{ backgroundColor: c.chip_id.color }} />
                        <span className="text-sm font-bold text-fg dark:text-gray-100">Ficha {c.chip_id.value}</span>
                        <span className="text-xs text-fg-subtle">esperado {c.quantity}</span>
                      </div>
                      <input
                        type="number" min="0"
                        value={counted ?? ''}
                        onChange={(e) => setCountValues((v) => ({ ...v, [id]: e.target.value }))}
                        className="input w-24 text-right"
                      />
                      <span className={`w-12 text-right text-xs font-bold tabular-nums ${diff === 0 ? 'text-gray-300' : diff < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
                        {diff > 0 ? '+' : ''}{diff || ''}
                      </span>
                    </div>
                  );
                })}
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-fg-subtle">Justificativa (obrigatória para diferenças de severidade alta)</label>
                  <input
                    type="text" value={countReason} onChange={(e) => setCountReason(e.target.value)} placeholder="Ex.: contagem do fim do turno"
                    className="input w-full"
                  />
                </div>
              </div>
              <div className="flex gap-3 border-t border-line-soft p-4">
                <button onClick={() => setCountCase(null)} className="flex-1 rounded-xl bg-raised py-3 text-xs font-bold text-fg-muted dark:bg-zinc-800">Cancelar</button>
                <button onClick={submitCount} className="flex-1 rounded-xl bg-brand py-3 text-xs font-bold text-white hover:bg-brand-hover">Registrar conferência</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Montagem (ASSEMBLY) */}
      <AnimatePresence>
        {assembleCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAssembleCase(null)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="card relative w-full max-h-[92vh] overflow-y-auto max-w-lg shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-line-soft p-6">
                <h2 className="flex items-center gap-2 text-xl font-bold text-fg">
                  <PackagePlus size={20} className="text-brand-fg" /> Movimentar fichas · "{assembleCase.name}"
                </h2>
                <button type="button" onClick={() => setAssembleCase(null)} className="text-fg-subtle hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-4 p-6">
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de movimentação">
                  {[['entrada', 'Adicionar', true], ['saida', 'Saída', true], ['quebra', 'Perda', false]].filter(([, , adm]) => isAdmin || !adm).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={moveType === v} onClick={() => setMoveType(v)} className={`btn btn-sm ${moveType === v ? 'btn-primary' : 'btn-secondary'}`}>{label}</button>
                  ))}
                </div>
                <p className="text-xs text-fg-muted">Entrada de fichas neste fichário. Cada lançamento entra no livro-razão (com o motivo) e pode ser estornada; o saldo inicial do cadastro não é reescrito.</p>
                <div className="space-y-3">
                  {assembleRows.map((row, i) => (
                    <div key={i} className="grid grid-cols-[1fr_100px_auto] items-center gap-2 rounded-xl border border-line bg-sunken p-3 dark:bg-sunken">
                      <CustomSelect options={chipOptions()} value={row.chip_id} onChange={(v) => updateAssembleRow(i, 'chip_id', v)} placeholder="Selecione a ficha..." />
                      <input
                        type="number" min="1" step="1" placeholder="Qtd" value={row.quantity} onChange={(e) => updateAssembleRow(i, 'quantity', e.target.value)}
                        className="card w-full px-2 py-2 text-center text-sm text-gray-900 focus:border-genesis-red focus:outline-none dark:text-white"
                      />
                      <button type="button" onClick={() => setAssembleRows(rows => rows.filter((_, idx) => idx !== i))} className="p-2 text-fg-subtle hover:text-red-500"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setAssembleRows(rows => [...rows, { chip_id: '', quantity: '' }])} className="flex items-center gap-1 text-sm font-bold text-brand-fg hover:text-red-700">
                    <Plus size={14} /> Adicionar ficha
                  </button>
                  <input
                    type="text" value={assembleReason} onChange={(e) => setAssembleReason(e.target.value)} placeholder="Motivo (obrigatório)" aria-label="Motivo do lançamento"
                    className="card mt-2 w-full px-3 py-2 text-sm text-gray-900 focus:border-genesis-red focus:outline-none dark:text-white"
                  />
                </div>
              </div>
              <div className="flex gap-3 border-t border-line-soft p-4">
                <button onClick={() => setAssembleCase(null)} className="flex-1 rounded-xl bg-raised py-3 text-xs font-bold text-fg-muted dark:bg-zinc-800">Cancelar</button>
                <button onClick={submitAssemble} className="flex-1 rounded-xl bg-brand py-3 text-xs font-bold text-white hover:bg-brand-hover">Adicionar fichas</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Editar fichário (nome e código) */}
      <AnimatePresence>
        {editCase && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Editar fichário">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditCase(null)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="card relative w-full max-w-md shadow-2xl">
              <div className="flex items-center justify-between border-b border-line-soft pb-4">
                <h2 className="flex items-center gap-2 text-xl font-bold text-fg"><Pencil size={20} className="text-brand-fg" /> Editar fichário</h2>
                <button type="button" onClick={() => setEditCase(null)} aria-label="Fechar" className="text-fg-subtle hover:text-fg"><X /></button>
              </div>
              <div className="space-y-3 py-4">
                <input aria-label="Nome do fichário" placeholder="Nome" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className="input w-full" />
                <input aria-label="Código" placeholder="Código (opcional)" value={editForm.code} onChange={(e) => setEditForm((f) => ({ ...f, code: e.target.value }))} className="input w-full" />
                <p className="text-xs text-fg-muted">O conteúdo não é editado aqui: só muda por movimentação (adicionar fichas, conferência).</p>
              </div>
              <div className="flex gap-3 border-t border-line-soft pt-4">
                <button onClick={() => setEditCase(null)} className="btn btn-secondary flex-1">Cancelar</button>
                <button onClick={submitEdit} className="btn btn-primary flex-1">Salvar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}