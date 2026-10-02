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

  const inputCls = 'w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white';

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-extrabold mb-1 text-gray-900 dark:text-white">Fichas</h1>
          <p className="text-gray-500 dark:text-gray-400">
            Cadastro mestre: cada denominação é cadastrada uma única vez, só com valor nominal. A quantidade fica nos modelos de fichário e nos fichários.
          </p>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          {canMove && (
            <button onClick={() => setIsMoveModalOpen(true)} className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 text-gray-900 dark:text-white hover:border-genesis-red dark:hover:border-genesis-red transition-all flex justify-center items-center gap-2 shadow-sm">
              <ArrowRightLeft size={18} />
              Movimentar
            </button>
          )}
          {isAdmin && (
            <button onClick={openCreateModal} className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 transition-all flex justify-center items-center gap-2 shadow-lg shadow-red-500/20">
              <Plus size={18} />
              Nova Ficha
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400 animate-pulse">Carregando fichas...</div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-[#111111] text-xs uppercase tracking-widest text-gray-500 dark:text-gray-400">
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Ficha</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Valor</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50">Cor</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right" title="Saldo nos fichários, derivado das movimentações">Em fichários</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right" title="Separado para torneios (alocado − enviado)">Reservado</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Livre</th>
                  <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Em jogo</th>
                  {isAdmin && <th className="p-5 font-bold border-b border-gray-100 dark:border-zinc-800/50 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800/50 text-sm md:text-base">
                <AnimatePresence>
                  {chips.map((chip) => (
                    <motion.tr
                      key={chip._id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: chip.active === false ? 0.5 : 1 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="hover:bg-gray-50 dark:hover:bg-zinc-800/30 transition-colors group"
                    >
                      <td className="p-5 font-bold text-gray-900 dark:text-white">
                        <div className="flex items-center gap-3 flex-wrap">
                          <PackageOpen size={18} className="text-genesis-red opacity-70" />
                          {chip.name}
                          {chip.active === false && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-gray-400">Inativa</span>
                          )}
                        </div>
                      </td>
                      <td className="p-5 font-black text-gray-700 dark:text-gray-300">{chip.value.toLocaleString()}</td>
                      <td className="p-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full border border-gray-200 dark:border-zinc-700 shadow-sm" style={{ backgroundColor: chip.color || 'transparent' }}></div>
                          <span className="font-mono text-xs uppercase text-gray-500 dark:text-gray-400">{chip.color || 'N/A'}</span>
                        </div>
                      </td>
                      <td className="p-5 text-right font-bold text-gray-900 dark:text-white">{(balances[chip._id]?.in_binders || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-bold text-amber-600 dark:text-amber-500">{(balances[chip._id]?.reserved || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-black text-emerald-600 dark:text-emerald-500">{(balances[chip._id]?.free || 0).toLocaleString()}</td>
                      <td className="p-5 text-right font-bold text-teal-600 dark:text-teal-400">{(balances[chip._id]?.in_play || 0).toLocaleString()}</td>
                      {isAdmin && (
                        <td className="p-5 text-right space-x-2">
                          <button onClick={() => openEditModal(chip)} title="Editar" className="p-2 text-gray-400 hover:text-blue-500 bg-transparent hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"><Edit2 size={18} /></button>
                          <button onClick={() => handleToggleActive(chip)} title={chip.active === false ? 'Reativar' : 'Desativar'} className="p-2 text-gray-400 hover:text-red-500 bg-transparent hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"><Power size={18} /></button>
                        </td>
                      )}
                    </motion.tr>
                  ))}
                </AnimatePresence>
                {chips.length === 0 && (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="p-12 text-center text-gray-400 dark:text-gray-500 text-lg">Nenhuma ficha cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100 dark:border-zinc-800/50">
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
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
            >
              <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111]">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{editingChip ? 'Editar Ficha' : 'Nova Ficha'}</h2>
                <button onClick={() => setIsChipModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleSaveChip} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Valor nominal</label>
                  <input type="number" min="0" value={chipForm.value} onChange={e => setChipForm({ ...chipForm, value: e.target.value })} className={inputCls} required placeholder="Ex: 100" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Cor</label>
                  <ColorPicker value={chipForm.color} onChange={(color) => setChipForm({ ...chipForm, color })} />
                </div>
                <p className="text-xs text-gray-400">
                  A ficha é cadastrada uma única vez e reutilizada nos modelos de fichário. Nome do modelo e quantidades ficam no <b>Modelo de Fichário</b>.
                </p>
                <button type="submit" className="w-full py-4 rounded-xl font-bold bg-genesis-red text-white hover:bg-red-700 active:scale-95 transition-all shadow-lg mt-4">
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
            className="fixed inset-0 z-50 p-4 bg-black/60 backdrop-blur-sm overflow-y-auto"
            onClick={() => setIsMoveModalOpen(false)}
          >
            <div className="min-h-full flex items-center justify-center">
              <motion.div 
                initial={{ scale: 0.95, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.95, opacity: 0, y: 20 }}
                transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-800 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col relative my-8"
              >
                <div className="p-6 border-b border-gray-100 dark:border-zinc-800/50 flex justify-between items-center bg-gray-50 dark:bg-[#111111] rounded-t-3xl">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><ArrowRightLeft className="text-genesis-red"/> Movimentar Fichas</h2>
                <button onClick={() => setIsMoveModalOpen(false)} className="text-gray-400 hover:text-genesis-red transition-colors"><X size={24} /></button>
              </div>
              <form onSubmit={handleMoveStock} className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Tipo de Movimentação</label>
                  <div className={`grid gap-2 ${moveTypes.length === 3 ? 'grid-cols-3' : 'grid-cols-1'}`}>
                    {moveTypes.map(o => (
                      <label key={o.v} className={`p-3 rounded-xl border cursor-pointer transition-all text-center text-xs font-bold ${moveForm.type === o.v ? o.cls : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-gray-400'}`}>
                        <input type="radio" name="type" value={o.v} checked={moveForm.type === o.v} onChange={() => setMoveForm({ ...moveForm, type: o.v })} className="hidden" />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Fichário</label>
                  <CustomSelect
                    options={binders.map(b => ({ value: b._id, label: b.code ? `${b.name} (${b.code})` : b.name }))}
                    value={moveForm.binder_id}
                    onChange={(val) => setMoveForm({ ...moveForm, binder_id: val })}
                    placeholder="Selecione o fichário..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Ficha</label>
                  <CustomSelect 
                    options={chips.filter(c => c.active !== false).map(c => ({ value: c._id, label: `${c.name} · ${c.color || 's/ cor'}` }))}
                    value={moveForm.chip_id}
                    onChange={(val) => setMoveForm({...moveForm, chip_id: val})}
                    placeholder="Selecione a ficha..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Quantidade (Apenas o número)</label>
                  <input type="number" min="1" value={moveForm.quantity} onChange={e => setMoveForm({...moveForm, quantity: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" required placeholder="Ex: 1500" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Motivo (obrigatório)</label>
                  <input type="text" value={moveForm.note} onChange={e => setMoveForm({...moveForm, note: e.target.value})} className="w-full bg-gray-50 dark:bg-[#111111] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 focus:outline-none focus:border-genesis-red focus:ring-1 focus:ring-genesis-red transition-all text-gray-900 dark:text-white" placeholder="Ex: compra fornecedor X / ficha danificada" />
                </div>

              <div className="p-6 border-t border-gray-100 dark:border-zinc-800/50 bg-gray-50 dark:bg-[#111111] shrink-0 rounded-b-3xl">
                <button type="submit" className={`w-full py-4 rounded-xl font-bold text-white active:scale-95 transition-all shadow-lg ${moveForm.type === 'entrada' ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/30' : moveForm.type === 'quebra' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/30' : 'bg-red-500 hover:bg-red-600 shadow-red-500/30'}`}>
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
