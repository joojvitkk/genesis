import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarRange, Plus, Edit2, Trash2, X, MapPin, ChevronDown, Trophy } from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';

const EMPTY = { name: '', start_date: '', end_date: '', location: '', notes: '' };
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const fmtDay = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '');
const STATUS = { scheduled: 'Agendada', running: 'Em andamento', finished: 'Encerrada' };

// Evento → Torneio → Sessões/Fases. Ex.: KSOP Rio → #02 Warm Up → Dia 1A / Dia 1B / Dia Final.
export default function Eventos() {
  const { showAlert, showConfirm } = useAlert();
  const navigate = useNavigate();
  const isAdmin = getStoredUser()?.role === 'admin';
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState({});       // id -> detalhe (torneios + sessões)
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    try { setEvents(await apiGet('/events')); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao carregar eventos', 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (ev) => {
    if (open[ev._id]) return setOpen((o) => { const n = { ...o }; delete n[ev._id]; return n; });
    try { const detail = await apiGet(`/events/${ev._id}`); setOpen((o) => ({ ...o, [ev._id]: detail })); }
    catch (e) { if (e.status !== 401) showAlert(e.message || 'Erro ao abrir o evento', 'error'); }
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); setModal(true); };
  const openEdit = (ev) => {
    setEditing(ev);
    setForm({ name: ev.name, start_date: day(ev.start_date), end_date: day(ev.end_date), location: ev.location || '', notes: ev.notes || '' });
    setModal(true);
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return showAlert('Informe o nome do evento.', 'error');
    const payload = { ...form, name: form.name.trim(), start_date: form.start_date || null, end_date: form.end_date || null };
    try {
      if (editing) await apiPut(`/events/${editing._id}`, payload);
      else await apiPost('/events', payload);
      showAlert(editing ? 'Evento atualizado!' : 'Evento criado!', 'success');
      setModal(false);
      load();
    } catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro ao salvar evento', 'error'); }
  };

  const remove = async (ev) => {
    if (!(await showConfirm(`Excluir o evento "${ev.name}"?`))) return;
    try { await apiDelete(`/events/${ev._id}`); showAlert('Evento excluído', 'success'); load(); }
    catch (err) { if (err.status !== 401) showAlert(err.message || 'Erro ao excluir evento', 'error'); }
  };

  const inputCls = 'w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-genesis-red';

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-black uppercase tracking-tighter text-gray-900 dark:text-white md:text-4xl">
            <CalendarRange className="text-genesis-red" size={30} /> Eventos
          </h1>
          <p className="text-gray-500 dark:text-gray-400">Evento → Torneio → Sessões/fases. Um torneio com vários dias (1A, 1B, Final) continua sendo um só.</p>
        </div>
        {isAdmin && (
          <button onClick={openCreate} className="flex items-center justify-center gap-2 rounded-xl bg-genesis-red px-6 py-3 font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-700">
            <Plus size={18} /> Novo Evento
          </button>
        )}
      </header>

      {loading ? (
        <div className="py-20 text-center text-gray-400 animate-pulse">Carregando eventos...</div>
      ) : events.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-gray-200 p-12 text-center text-gray-400 dark:border-zinc-800">
          Nenhum evento cadastrado.{isAdmin ? '' : ' Peça ao administrador.'}
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((ev) => {
            const detail = open[ev._id];
            return (
              <motion.div key={ev._id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-[#141414]">
                <div className="flex items-center justify-between gap-3 p-5">
                  <button onClick={() => toggle(ev)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <ChevronDown size={18} className={`shrink-0 text-gray-400 transition-transform ${detail ? 'rotate-180' : ''}`} />
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-black text-gray-900 dark:text-white">{ev.name}</h3>
                      <p className="flex flex-wrap gap-x-4 text-xs text-gray-500">
                        {(ev.start_date || ev.end_date) && <span>{fmtDay(ev.start_date)}{ev.end_date ? ` → ${fmtDay(ev.end_date)}` : ''}</span>}
                        {ev.location && <span className="flex items-center gap-1"><MapPin size={11} /> {ev.location}</span>}
                        <span>{ev.tournaments_count} torneio(s)</span>
                      </p>
                    </div>
                  </button>
                  {isAdmin && (
                    <div className="flex shrink-0 gap-2">
                      <button onClick={() => openEdit(ev)} title="Editar" className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:text-blue-500 dark:border-zinc-700"><Edit2 size={15} /></button>
                      <button onClick={() => remove(ev)} title="Excluir" className="rounded-lg border border-gray-200 p-2 text-gray-400 hover:text-red-500 dark:border-zinc-700"><Trash2 size={15} /></button>
                    </div>
                  )}
                </div>

                {detail && (
                  <div className="space-y-2 border-t border-gray-100 bg-gray-50 p-4 dark:border-zinc-800/60 dark:bg-[#0f0f0f]">
                    {detail.tournaments.length === 0 && <p className="text-sm italic text-gray-400">Nenhum torneio neste evento.</p>}
                    {detail.tournaments.map((t) => (
                      <button key={t._id} onClick={() => navigate(`/torneios?id=${t._id}&tab=salao`)} className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-genesis-red dark:border-zinc-800 dark:bg-[#141414]">
                        <div className="flex items-center gap-2 font-bold text-gray-900 dark:text-white">
                          <Trophy size={16} className="text-genesis-red" />
                          {t.number ? <span className="text-genesis-red">#{String(t.number).padStart(2, '0')}</span> : null} {t.name}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {t.sessions.map((s) => (
                            <span key={s._id} className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] font-bold text-gray-600 dark:bg-zinc-800 dark:text-gray-300">
                              {s.name} · {STATUS[s.status] || s.status}
                            </span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModal(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.form onSubmit={save} initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111111]">
              <div className="flex items-center justify-between border-b border-gray-100 p-6 dark:border-zinc-800">
                <h2 className="text-xl font-black uppercase tracking-tight text-gray-900 dark:text-white">{editing ? 'Editar evento' : 'Novo evento'}</h2>
                <button type="button" onClick={() => setModal(false)} className="text-gray-400 hover:text-gray-600"><X /></button>
              </div>
              <div className="space-y-4 p-6">
                <div>
                  <label className="mb-1 block text-sm font-bold">Nome</label>
                  <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Ex: KSOP Rio" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="mb-1 block text-sm font-bold">Início</label><input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} /></div>
                  <div><label className="mb-1 block text-sm font-bold">Fim</label><input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} className={inputCls} /></div>
                </div>
                <div><label className="mb-1 block text-sm font-bold">Local</label><input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-sm font-bold">Observações</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></div>
              </div>
              <div className="border-t border-gray-100 p-6 dark:border-zinc-800">
                <button type="submit" className="w-full rounded-xl bg-genesis-red py-3 font-black uppercase tracking-widest text-white hover:bg-red-700">Salvar</button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
