import { useState, useEffect } from 'react';
import { PackageOpen, Plus, Edit2, Power, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { can } from '../config';
import ColorPicker from '../components/ColorPicker';

const EMPTY_CHIP_FORM = { value: '', color: '#ff0000' };

export default function Estoque() {
  const { showAlert, showConfirm } = useAlert();
  // Cadastros estruturais (ficha) são só do administrador — o backend também barra (403).
  const role = getStoredUser()?.role;
  const isAdmin = can(role, 'estoque', 'manage'); // cadastro de denominações: administrar
  const [chips, setChips] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [isChipModalOpen, setIsChipModalOpen] = useState(false);
  const [editingChip, setEditingChip] = useState(null);

  // Forms states — a FICHA só tem valor NOMINAL, cor e tipo. Sem nome de modelo, quantidade nem valor monetário.
  const [chipForm, setChipForm] = useState(EMPTY_CHIP_FORM);

  const fetchChips = async () => {
    try {
      setChips(await apiGet('/chips'));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar fichas', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChips();
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
            Cadastro mestre das denominações que o sistema reconhece: nome, valor nominal e cor. As quantidades pertencem a cada fichário — esta tela não soma estoque.
          </p>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
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
            <table className="w-full text-left border-collapse min-w-[480px]">
              <thead>
                <tr className="bg-sunken text-xs uppercase tracking-wide text-fg-muted">
                  <th className="p-5 font-bold border-b border-line-soft">Ficha</th>
                  <th className="p-5 font-bold border-b border-line-soft">Valor</th>
                  <th className="p-5 font-bold border-b border-line-soft">Cor</th>
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
                    <td colSpan={isAdmin ? 4 : 3} className="p-12 text-center text-fg-subtle text-lg">Nenhuma ficha cadastrada.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
                  A denominação é cadastrada uma única vez (ex.: uma ficha de 1.000.000 no futuro). As quantidades ficam em cada fichário.
                </p>
                <button type="submit" className="w-full py-4 rounded-xl font-bold bg-brand text-white hover:bg-brand-hover active:scale-95 transition-all mt-4">
                  Salvar Ficha
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
