import { useState, useEffect } from 'react';
import Avatar from '../components/Avatar';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, Mail, Trash2, Edit2, X, Save,
  Search, Eye, EyeOff, KeyRound, ShieldOff
} from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { getStoredUser } from '../lib/auth';

export default function Usuarios() {
  const { showAlert, showConfirm, showModal } = useAlert();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Current logged-in user (to block self-delete)
  const currentUser = getStoredUser() || {};

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'salao',
    allowed_tournament_ids: []
  });
  const [tournaments, setTournaments] = useState([]); // para o escopo por torneio (G11)

  useEffect(() => {
    fetchUsers();
    apiGet('/tournaments').then((t) => setTournaments(Array.isArray(t) ? t : t?.data || [])).catch(() => {});
  }, []);

  const fetchUsers = async () => {
    try {
      setUsers(await apiGet('/users'));
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao carregar usuários', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!editingUser && form.password !== form.confirmPassword) {
      return showAlert('As senhas não coincidem', 'error');
    }
    if (editingUser && form.password && form.password !== form.confirmPassword) {
      return showAlert('As senhas não coincidem', 'error');
    }

    const payload = { name: form.name, email: form.email, role: form.role, allowed_tournament_ids: form.role === 'admin' ? [] : form.allowed_tournament_ids };
    if (form.password) payload.password = form.password;

    try {
      if (editingUser) {
        await apiPut(`/users/${editingUser._id}`, payload);
        showAlert('Usuário atualizado!', 'success');
      } else {
        await apiPost('/users', payload);
        showAlert('Usuário criado!', 'success');
      }
      setIsModalOpen(false);
      fetchUsers();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao processar', 'error');
    }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      name: user.name,
      email: user.email || user.username || '',
      role: user.role,
      password: '',
      confirmPassword: '',
      allowed_tournament_ids: (user.allowed_tournament_ids || []).map(String),
    });
    setIsModalOpen(true);
  };

  const handleDelete = async (id) => {
    // Prevent self-deletion
    const matchById = users.find(u => u._id === id);
    if (matchById?.email === currentUser?.email) {
      return showAlert('Você não pode excluir seu próprio usuário.', 'error');
    }

    const confirmed = await showConfirm('Excluir este usuário permanentemente?');
    if (!confirmed) return;

    try {
      await apiDelete(`/users/${id}`);
      showAlert('Usuário removido', 'success');
      fetchUsers();
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao remover usuário', 'error');
    }
  };

  const handleResetPassword = async (user) => {
    const ok = await showConfirm(`Gerar uma senha temporária para ${user.name}? A senha atual deixa de funcionar.`, {
      title: 'Resetar senha', confirmLabel: 'Gerar', tone: 'danger',
    });
    if (!ok) return;
    try {
      const { temporary_password } = await apiPost(`/users/${user._id}/reset-password`);
      await showModal(
        <div className="space-y-3">
          <p className="select-all rounded-xl border border-line bg-sunken px-4 py-3 text-center font-mono text-lg font-bold tracking-wider text-gray-900 dark:text-white">
            {temporary_password}
          </p>
          <p className="text-sm font-medium text-fg-muted">
            Anote agora — não será mostrada de novo. {user.name} terá que trocá-la no próximo login.
          </p>
        </div>,
        { title: `Senha temporária de ${user.name}`, tone: 'success', confirmLabel: 'Copiei / anotei' },
      );
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro ao resetar senha', 'error');
    }
  };

  const handleRevokeSessions = async (user) => {
    if (!(await showConfirm(`Encerrar todas as sessões de ${user.name}?`))) return;
    try {
      await apiPost(`/users/${user._id}/revoke-sessions`);
      showAlert('Sessões encerradas.', 'success');
    } catch (e) {
      if (e.status !== 401) showAlert(e.message || 'Erro', 'error');
    }
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="page-title">Membros da Equipe</h1>
          <p className="page-sub">Gerencie os acessos e permissões da plataforma</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex items-center gap-3 bg-surface p-2 rounded-2xl border border-line-soft min-w-[280px]">
            <Search size={20} className="text-fg-subtle ml-2" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou email..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-sm font-bold dark:text-white"
            />
          </div>
          <button 
            onClick={() => { setEditingUser(null); setForm({name:'', email:'', password:'', confirmPassword:'', role:'salao', allowed_tournament_ids: []}); setIsModalOpen(true); }}
            className="px-6 py-3 bg-brand text-white font-bold text-xs rounded-2xl hover:bg-brand-hover transition-all flex items-center justify-center gap-2"
          >
            <UserPlus size={16}/> Novo Usuário
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-raised rounded-2xl"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredUsers.map(user => (
            <motion.div 
              key={user._id}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="card p-8 relative group overflow-hidden"
            >
              {/* Decorative ball — bottom-left, behind content */}
              <div className={`absolute -left-6 -bottom-6 w-28 h-28 rounded-full opacity-5 group-hover:opacity-10 transition-all pointer-events-none ${getRoleColor(user.role)}`}></div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${getRoleBadge(user.role)}`}>
                    {user.role}
                  </span>
                  {/* Action buttons — z-10 to stay above decorative elements */}
                  <div className="flex items-center gap-1 relative z-10">
                    <button onClick={() => handleResetPassword(user)} title="Resetar senha" className="p-2 text-fg-subtle hover:text-amber-500 transition-all rounded-xl hover:bg-amber-50 dark:hover:bg-amber-500/10"><KeyRound size={16}/></button>
                    <button onClick={() => handleRevokeSessions(user)} title="Encerrar sessões" className="p-2 text-fg-subtle hover:text-purple-500 transition-all rounded-xl hover:bg-purple-50 dark:hover:bg-purple-500/10"><ShieldOff size={16}/></button>
                    <button onClick={() => handleEdit(user)} className="p-2 text-fg-subtle hover:text-blue-500 transition-all rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10"><Edit2 size={16}/></button>
                    {user.email !== currentUser?.email ? (
                      <button onClick={() => handleDelete(user._id)} className="p-2 text-fg-subtle hover:text-red-500 transition-all rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={16}/></button>
                    ) : (
                      <div className="p-2 text-gray-200 dark:text-zinc-700 cursor-not-allowed" title="Você não pode excluir sua própria conta">
                        <Trash2 size={16}/>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Avatar user={user} size="lg" />
                  <div className="min-w-0">
                    <h3 className="text-xl font-bold text-fg leading-tight mb-1 truncate">{user.name}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-fg-muted">
                      <Mail size={12}/> <span className="break-all">{user.email}</span>
                      {user.email === currentUser?.email && (
                        <span className="ml-1 px-2 py-0.5 bg-brand-soft text-brand-fg text-xs font-bold rounded-full">Você</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-line-soft grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">Cadastrado por</p>
                    <p className="text-xs font-bold text-fg">{user.created_by || 'Sistema'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-fg-subtle uppercase tracking-wide mb-1">Desde</p>
                    <p className="text-xs font-bold text-fg">{new Date(user.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* User Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-[var(--overlay)]" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="card relative w-full max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
            >
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-brand-soft text-brand-fg rounded-2xl">
                      {editingUser ? <Edit2 size={24}/> : <UserPlus size={24}/>}
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold text-fg">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h2>
                      <p className="text-xs text-fg-muted font-bold uppercase tracking-wide">Defina as credenciais de acesso</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-fg-subtle hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Nome Completo</label>
                    <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="input w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Email de Acesso</label>
                    <input required type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input w-full" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Senha</label>
                      <input 
                        required={!editingUser} 
                        type={showPassword ? 'text' : 'password'} 
                        value={form.password} 
                        onChange={e => setForm({...form, password: e.target.value})} 
                        className="input w-full pr-12" 
                        placeholder={editingUser ? 'Deixe em branco' : '********'} 
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 bottom-3 text-fg-subtle hover:text-gray-600 transition-all"
                      >
                        {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                      </button>
                    </div>
                    <div className="relative">
                      <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Confirmar</label>
                      <input 
                        required={!editingUser} 
                        type={showPassword ? 'text' : 'password'} 
                        value={form.confirmPassword} 
                        onChange={e => setForm({...form, confirmPassword: e.target.value})} 
                        className="input w-full pr-12" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Nível de Acesso</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['material', 'salao', 'admin'].map(role => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setForm({...form, role})}
                          className={`py-3 rounded-xl text-xs font-bold border-2 transition-all ${form.role === role ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white' : 'border-line-soft text-fg-subtle'}`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  {form.role !== 'admin' && tournaments.length > 0 && (
                    <fieldset data-testid="tournament-scope">
                      <legend className="text-xs font-bold text-fg-subtle uppercase mb-2 block tracking-wide">Torneios permitidos</legend>
                      <p className="mb-2 text-xs text-fg-subtle">Nenhum marcado = acessa todos os torneios. Marcando, só enxerga e opera os escolhidos.</p>
                      <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line-soft p-2">
                        {tournaments.map((t) => (
                          <label key={t._id} className="flex items-center gap-2 text-sm font-medium text-fg">
                            <input
                              type="checkbox" checked={form.allowed_tournament_ids.includes(t._id)}
                              onChange={(e) => setForm({ ...form, allowed_tournament_ids: e.target.checked ? [...form.allowed_tournament_ids, t._id] : form.allowed_tournament_ids.filter((id) => id !== t._id) })}
                            /> {t.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                </div>

                <button type="submit" className="w-full py-4 bg-brand text-white font-bold text-xs rounded-2xl hover:opacity-90 transition-all flex items-center justify-center gap-2">
                  <Save size={16}/> {editingUser ? 'Salvar Alterações' : 'Criar Membro'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function getRoleColor(role) {
  const colors = { admin: 'bg-red-500', material: 'bg-emerald-500', salao: 'bg-blue-500' };
  return colors[role] || 'bg-gray-500';
}

function getRoleBadge(role) {
  const colors = {
    admin: 'bg-red-500/10 text-red-500',
    material: 'bg-emerald-500/10 text-emerald-500',
    salao: 'bg-blue-500/10 text-blue-500'
  };
  return colors[role] || 'bg-gray-500/10 text-fg-muted';
}