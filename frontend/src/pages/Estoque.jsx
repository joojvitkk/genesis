import { useState, useEffect } from 'react';
import { PackageOpen, Plus, Edit2, Power, ArrowRightLeft, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import CustomSelect from '../components/CustomSelect';
import ColorPicker from '../components/ColorPicker';

const EMPTY_CHIP_FORM = { value: '', color: '#ff0000' };

export default function Estoque() {
  const { showAlert, showConfirm } = useAlert();
  // Cadastros estruturais (ficha) são só do administrador — o backend também barra (403).
  const role = getStoredUser()?.role;
  const isAdmin = can(role, 'estoque', 'manage'); // cadastro de fichas e entradas/saídas: administrar
  // Movimentar: admin monta/retira/perde; material registra perda; salão só consulta (o backend também barra).
  const canMove = can(role, 'estoque', 'operate');
  const moveTypes = [
    { v: 'entrada', label: 'Entrada', cls: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-500', admin: true },
    { v: 'saida', label: 'Saída', cls: 'border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-500', admin: true },
    { v: 'quebra', label: 'Quebra/Perda', cls: 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500', admin: false },
  ].filter(o => isAdmin || !o.admin);
  const [binders, setBinders] = useState([]);
  const [chips, setChips] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isChipModalOpen, setIsChipModalOpen] = useState(false);
  const [isMoveModalOpen, setIsMoveModalOpen] = useState(false);
  const [editingChip, setEditingChip] = useState(null);

  // Forms states — a FICHA só tem valor NOMINAL, cor e tipo. Sem nome de modelo, quantidade nem valor monetário.
  const [chipForm, setChipForm] = useState(EMPTY_CHIP_FORM);
  const [moveForm, setMoveForm] = useState({ binder_id: '', chip_id: '', type: isAdmin ? 'entrada' : 'quebra', quantity: '', note: '' });

  const [balances, setBalances] = useState({}); // saldo derivado por ficha (GET /inventory/by-chip)

  const fetchChips = async () => {
    try {
      const [list, inv] = await Promise.all([apiGet('/chips'), apiGet('/inventory/by-chip').catch(() => ({ rows: [] }))]);
      setChips(list);
      setBalances(Object.fromEntries((inv.rows || []).map((r) => [r.chip._id, r])));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChips();
    // /binders exige a área "ficharios" (o salão não tem) — falha silenciosa
    apiGet('/binders').then(setBinders).catch(() => {});
  }, []);

  const handleSaveChip = async (e) => {
    e.preventDefault();
    const value = Number(chipForm.value);
    if (chipForm.value === '' || !Number.isFinite(value) || value < 0) return showAlert('Informe um valor nominal válido.', 'error');

    const payload = { value, color: chipForm.color }; // a ficha só tem valor NOMINAL e cor
    try {
      if (editingChip) await apiPut(`/chips/${editingChip._id}`, payload);
      else await apiPost('/chips', payload);
      setIsChipModalOpen(false);
      showAlert('Ficha salva com sucesso!', 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao salvar ficha', 'error');
    }
  };

  // Fichas não são excluídas: são desativadas (descontinuadas) sem perder o histórico.
  const handleToggleActive = async (chip) => {
    const activating = chip.active === false;
    const confirmed = await showConfirm(activating
      ? `Reativar a ${chip.name}?`
      : `Desativar a ${chip.name}? Ela deixa de aparecer nas novas composições, mas o histórico é mantido.`);
    if (!confirmed) return;
    try {
      await apiPut(`/chips/${chip._id}`, { active: activating });
      showAlert(activating ? 'Ficha reativada' : 'Ficha desativada', 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao atualizar ficha', 'error');
    }
  };

  // Toda movimentação é lançada num FICHÁRIO (ASSEMBLY / WITHDRAWAL / LOSS) e entra no livro-razão.
  const handleMoveStock = async (e) => {
    e.preventDefault();
    const qty = parseInt(moveForm.quantity, 10);
    if (!moveForm.binder_id) return showAlert('Selecione o fichário.', 'error');
    if (!moveForm.chip_id) return showAlert('Selecione uma ficha.', 'error');
    if (!Number.isFinite(qty) || qty <= 0) return showAlert('Informe uma quantidade positiva.', 'error');
    // toda movimentação administrativa (entrada, saída, perda) exige motivo (G11)
    if (!moveForm.note.trim()) return showAlert('Informe o motivo da movimentação.', 'error');

    const type = { entrada: 'ASSEMBLY', saida: 'WITHDRAWAL', quebra: 'LOSS' }[moveForm.type];
    try {
      await apiPost('/movements', {
        type, binder_id: moveForm.binder_id, chip_id: moveForm.chip_id, quantity: qty, reason: moveForm.note.trim(),
      });
      setIsMoveModalOpen(false);
      setMoveForm({ binder_id: '', chip_id: '', type: isAdmin ? 'entrada' : 'quebra', quantity: '', note: '' });
      showAlert('Movimentação registrada!', 'success');
      await fetchChips();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao movimentar estoque', 'error');
    }
  };

  const openEditModal = (chip) => {
    setEditingChip(chip);
    setChipForm({
      value: chip.value, color: chip.color || '#000000',
    });
    setIsChipModalOpen(true);
  };

  const openCreateModal = () => {
    setEditingChip(null);
    setChipForm(EMPTY_CHIP_FORM);
    setIsChipModalOpen(true);
  };

  const inputCls = 'w-full bg-sunken  border border-line rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-brand transition-all text-fg';

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="page-title">Fichas</h1>
          <p className="page-sub">
            Cadastro mestre: cada denominação é cadastrada uma única vez, só com valor nominal. A quantidade fica nos modelos de fichário e nos fichários.
          </p>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          {canMove && (
            <button onClick={() => setIsMoveModalOpen(true)} className="card flex-1 md:flex-none px-6 py-3 font-bold text-fg hover:border-brand dark:hover:border-brand transition-all flex justify-center items-center gap-2">
              <ArrowRightLeft size={18} />
              Movimentar
            </button>
          )}
          {isAdmin && (
            <button onClick={openCreateModal} className="btn btn-primary flex-1 md:flex-none flex justify-center items-center">
              <Plus size={18} />
              Nova Ficha
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-fg-subtle animate-pulse">Carregando fichas...</div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                  <th className="p-5 font-bold border-b border-line-soft">Ficha</th>
                  <th className="p-5 font-bold border-b border-line-soft">Valor</th>
                  <th className="p-5 font-bold border-b border-line-soft">Cor</th>
                  <th className="p-5 font-bold border-b border-line-soft text-right" title="Saldo nos fichários, derivado das movimentações">Em fichários</th>
                  <th className="p-5 font-bold border-b border-line-soft text-right" title="Separado para torneios (alocado − enviado)">Reservado</th>
                  <th className="p-5 font-bold border-b border-line-soft text-right">Livre</th>
                  <th className="p-5 font-bold border-b border-line-soft text-right" title="Enviadas ao Salão e ainda não devolvidas (inclui o que está nas mãos dos jogadores)">No Salão</th>
                  {isAdmin && <th className="p-5 font-bold border-b border-line-soft text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft text-sm md:text-base">
                <AnimatePresence>
                  {chips.map((chip) => (
                    <motion.tr
                      key={chip._id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: chip.active === false ? 0.5 : 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="hover:bg-sunken transition-colors group"
                    >
                      <td className="p-5 font-bold text-fg">
                        <div className="flex items-center gap-3 flex-wrap">
                          <PackageOpen size={18} className="text-brand-fg opacity-70" />
                          {chip.name}
                          {chip.active === false && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold tracking-wider bg-raised text-fg-muted">Inativa</span>
                          )}
                        </div>
                      </td>
                      <td className="p-5 font-bold text-fg">{chip.value.toLocaleString()}</td>
                      <td className="p-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full border border-line" style={{ backgroundColor: chip.color || 'transparent' }}></div>
                          <span className="font-mono text-xs uppercase text-fg-muted">{chip.color || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="p-5 text-right font-bold text-fg">{(balances[chip._id]?.in_binders || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-bold text-amber-600 dark:text-amber-500">{(balances[chip._id]?.reserved || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-bold text-emerald-600 dark:text-emerald-500">{(balances[chip._id]?.free || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-bold text-teal-600 dark:text-teal-400">{(balances[chip._id]?.in_play || 0).toLocaleString()}</td>
                      {isAdmin && (
                        <td className="p-5 text-right space-x-2">
                          <button onClick={() => openEditModal(chip)} title="Editar" className="p-2 text-fg-subtle hover:text-blue-500 bg-transparent hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"><Edit2 size={18} /></button>
                          <button onClick={() => handleToggleActive(chip)} title={chip.active === false ? 'Reativar' : 'Desativar'} className="p-2 text-fg-subtle hover:text-red-500 bg-transparent hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"><Power size={18} /></button>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {chips.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="p-12 text-center text-fg-subtle text-lg">Nenhuma ficha cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-fg-subtle border-t border-line-soft">
            Saldos derivados das movimentações: a quantidade pertence ao fichário. Reservado = separado para torneios; livre = em fichários − reservado.
          </p>
        </motion.div>
      )}

      {/* Modal Criar/Editar Ficha */}
      <AnimatePresence>
        {isChipModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsChipModalOpen(false)}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay)]"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="card w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-line-soft flex justify-between items-center bg-sunken">
                <h2 className="text-xl font-bold text-fg">{editingChip ? 'Editar Ficha' : 'Nova Ficha'}</h2>
                <button onClick={() => setIsChipModalOpen(false)} className="text-fg-subtle hover:text-brand-fg transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleSaveChip} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Valor nominal</label>
                  <input type="number" min="0" value={chipForm.value} onChange={e => setChipForm({ ...chipForm, value: e.target.value })} className={inputCls} required placeholder="Ex: 100" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Cor</label>
                  <ColorPicker value={chipForm.color} onChange={(color) => setChipForm({ ...chipForm, color })} />
                </div>
                <p className="text-xs text-fg-subtle">
                  A ficha é cadastrada uma única vez e reutilizada nos modelos de fichário. Nome do modelo e quantidades ficam no <b>Modelo de Fichário</b>.
                </p>
                <button type="submit" className="w-full py-4 rounded-xl font-bold bg-brand text-white hover:bg-brand-hover active:scale-95 transition-all mt-4">
                  Salvar Ficha
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal Movimentar Estoque */}
      <AnimatePresence>
        {isMoveModalOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 p-4 bg-[var(--overlay)] overflow-y-auto"
            onClick={() => setIsMoveModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="card w-full max-w-lg shadow-2xl flex flex-col relative my-8"
              >
                <div className="p-6 border-b border-line-soft flex justify-between items-center bg-sunken rounded-t-3xl">
                <h2 className="text-xl font-bold text-fg flex items-center gap-2"><ArrowRightLeft className="text-brand-fg"/> Movimentar Fichas</h2>
                <button onClick={() => setIsMoveModalOpen(false)} className="text-fg-subtle hover:text-brand-fg transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleMoveStock} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Tipo de Movimentação</label>
                  <div className={`grid gap-2 ${moveTypes.length === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    {moveTypes.map(o => (
                      <label key={o.v} className={`p-3 rounded-xl border cursor-pointer transition-all text-center text-xs font-bold ${moveForm.type === o.v ? o.cls : 'border-line text-fg-muted'}`}>
                        <input type="radio" name="type" value={o.v} checked={moveForm.type === o.v} onChange={() => setMoveForm({ ...moveForm, type: o.v })} className="hidden" />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Fichário</label>
                  <CustomSelect
                    options={binders.map(b => ({ value: b._id, label: b.code ? `${b.name} (${b.code})` : b.name }))}
                    value={moveForm.binder_id}
                    onChange={(val) => setMoveForm({ ...moveForm, binder_id: val })}
                    placeholder="Selecione o fichário..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Ficha</label>
                  <CustomSelect 
                    options={chips.filter(c => c.active !== false).map(c => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}` }))}
                    value={moveForm.chip_id}
                    onChange={(val) => setMoveForm({...moveForm, chip_id: val})}
                    placeholder="Selecione a ficha..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Quantidade (Apenas o número)</label>
                  <input type="number" min="1" value={moveForm.quantity} onChange={e => setMoveForm({...moveForm, quantity: e.target.value})} className="input w-full" required placeholder="Ex: 1500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-fg">Motivo (obrigatório)</label>
                  <input type="text" value={moveForm.note} onChange={e => setMoveForm({...moveForm, note: e.target.value})} className="input w-full" placeholder="Ex: compra fornecedor X / ficha danificada" />
                </div>

              <div className="p-6 border-t border-line-soft bg-sunken shrink-0 rounded-b-3xl">
                <button type="submit" className={`w-full py-4 rounded-xl font-bold text-white active:scale-95 transition-all  ${moveForm.type === 'entrada' ? 'bg-emerald-500 hover:bg-emerald-600 ' : moveForm.type === 'quebra' ? 'bg-amber-500 hover:bg-amber-600 ' : 'bg-red-500 hover:bg-red-600 '}`}>
                  Confirmar {moveForm.type === 'entrada' ? 'Entrada' : moveForm.type === 'quebra' ? 'Quebra/Perda' : 'Saída'}
                </button>
              </div>
              </form>
            </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
