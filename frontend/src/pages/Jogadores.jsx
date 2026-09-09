import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, UserPlus, Search, Edit2, Trash2, X, Save, Phone, Mail, IdCard, Trophy } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useModalDismiss } from '../hooks/useModalDismiss';

const EMPTY = { name: '', document: '', phone: '', email: '', notes: '' };

export default function Jogadores() {
  const { showAlert, showConfirm } = useAlert();
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);   // { editing?, form }
  const [detail, setDetail] = useState(null); // { player, entries, eliminations }

  useModalDismiss(!!modal, () => setModal(null));
  useModalDismiss(!!detail, () => setDetail(null));

  const fetchPlayers = async (term = search) => {
    setLoading(true);
    try {
      setPlayers(await apiGet('/players', { search: term, limit: 100 }));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar jogadores', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const h = setTimeout(() => fetchPlayers(search), 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const save = async (e) => {
    e.preventDefault();
    const { editing, form } = modal;
    if (!form.name.trim()) return showAlert('Nome é obrigatório.', 'error');
    try {
      if (editing) await apiPut(`/players/${editing._id}`, form);
      else await apiPost('/players', form);
      showAlert(editing ? 'Jogador atualizado!' : 'Jogador cadastrado!', 'success');
      setModal(null);
      fetchPlayers();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao salvar', 'error');
    }
  };

  const remove = async (p) => {
    if (!(await showConfirm(`Remover ${p.name}?`))) return;
    try {
      await apiDelete(`/players/${p._id}`);
      showAlert('Jogador removido', 'success');
      fetchPlayers();
    } catch (err) {
      if (err.status !== 401) showAlert(err.message || 'Erro ao remover', 'error');
    }
  };

  const openDetail = async (p) => {
    try { setDetail(await apiGet(`/players/${p._id}`)); }
    catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro', 'error'); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter text-gray-900 dark:text-white md:text-4xl">Jogadores</h1>
          <p className="text-gray-500 dark:text-gray-400">Cadastro e histórico dos participantes.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <Search size={18} className="text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, documento…"
              className="w-56 bg-transparent text-sm font-bold outline-none dark:text-white"
            />
          </div>
          <button
            onClick={() => setModal({ form: { ...EMPTY } })}
            className="flex items-center gap-2 rounded-2xl bg-genesis-red px-5 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-red-500/20 hover:bg-red-700"
          >
            <UserPlus size={16} /> Novo
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="h-32 animate-pulse rounded-3xl bg-gray-100 dark:bg-zinc-800" />)}
        </div>
      ) : players.length === 0 ? (
        <p className="rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400 dark:border-zinc-800">
          Nenhum jogador {search ? 'encontrado' : 'cadastrado'}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {players.map((p) => (
            <motion.div
              key={p._id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="group rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-[#111111]"
            >
              <div className="flex items-start justify-between">
                <button onClick={() => openDetail(p)} className="min-w-0 text-left">
                  <h3 className="truncate text-lg font-black text-gray-900 dark:text-white">{p.name}</h3>
                  {p.document && <p className="text-xs font-bold text-gray-400">{p.document}</p>}
                </button>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => setModal({ editing: p, form: { ...EMPTY, ...p } })} className="rounded-lg p-2 text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10"><Edit2 size={15} /></button>
                  <button onClick={() => remove(p)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10"><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="mt-3 space-y-1 text-xs font-medium text-gray-500">
                {p.phone && <p className="flex items-center gap-1.5"><Phone size={11} /> {p.phone}</p>}
                {p.email && <p className="flex items-center gap-1.5"><Mail size={11} /> {p.email}</p>}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Modal cadastro/edição */}
      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.form
              onSubmit={save}
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md space-y-4 rounded-[32px] border border-gray-200 bg-white p-7 shadow-2xl dark:border-zinc-800 dark:bg-[#111111]"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">
                  {modal.editing ? 'Editar jogador' : 'Novo jogador'}
                </h2>
                <button type="button" onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>
              {[
                { k: 'name', label: 'Nome', icon: Users, required: true },
                { k: 'document', label: 'Documento (CPF/RG)', icon: IdCard },
                { k: 'phone', label: 'Telefone', icon: Phone },
                { k: 'email', label: 'E-mail', icon: Mail, type: 'email' },
              ].map(({ k, label, required, type }) => (
                <div key={k}>
                  <label className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</label>
                  <input
                    type={type || 'text'}
                    required={required}
                    value={modal.form[k] || ''}
                    onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, [k]: e.target.value } }))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-genesis-red dark:border-zinc-800 dark:bg-zinc-900"
                  />
                </div>
              ))}
              <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-genesis-red py-3.5 text-xs font-black uppercase tracking-widest text-white hover:bg-red-700">
                <Save size={15} /> {modal.editing ? 'Salvar' : 'Cadastrar'}
              </button>
            </motion.form>
          </div>
        )}
      </AnimatePresence>

      {/* Modal detalhe / histórico */}
      <AnimatePresence>
        {detail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDetail(null)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg space-y-5 rounded-[32px] border border-gray-200 bg-white p-7 shadow-2xl dark:border-zinc-800 dark:bg-[#111111]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight text-gray-900 dark:text-white">{detail.player.name}</h2>
                  {detail.player.document && <p className="text-xs font-bold text-gray-400">{detail.player.document}</p>}
                </div>
                <button type="button" onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>

              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Participações ({detail.entries.length})</p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {detail.entries.length === 0 && <p className="text-sm text-gray-400">Nenhuma ainda.</p>}
                  {detail.entries.map((e) => (
                    <div key={e._id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-sm dark:bg-zinc-900">
                      <span className="font-bold text-gray-700 dark:text-gray-200">{e.tournament_id?.name || 'Torneio'}</span>
                      <span className="text-xs font-black uppercase text-gray-400">{e.type}</span>
                    </div>
                  ))}
                </div>
              </div>

              {detail.eliminations.length > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Colocações</p>
                  <div className="space-y-1.5">
                    {detail.eliminations.map((el) => (
                      <div key={el._id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2 text-sm dark:bg-zinc-900">
                        <span className="font-bold text-gray-700 dark:text-gray-200">{el.tournament_id?.name || 'Torneio'}</span>
                        <span className="flex items-center gap-1.5 text-xs font-black text-genesis-red">
                          <Trophy size={12} /> {el.position}º
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
