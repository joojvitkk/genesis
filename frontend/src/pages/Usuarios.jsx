import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, UserPlus, Mail, Shield, Trash2, Edit2, X, Save, 
  Search, Filter, ChevronRight, Key, AlertCircle, Calendar, UserCheck, Eye, EyeOff
} from 'lucide-react';
import { useAlert } from '../contexts/AlertContext';
import { BACKEND_URL } from '../App';

export default function Usuarios() {
  const { showAlert, showConfirm } = useAlert();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);

  // Current logged-in user (to block self-delete)
  const currentUser = JSON.parse(localStorage.getItem('genesis_user') || '{}');

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'salao'
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/users`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setUsers(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!editingUser && form.password !== form.confirmPassword) {
      return showAlert('As senhas não coincidem', 'error');
    }

    const token = localStorage.getItem('genesis_token');
    const url = editingUser ? `${BACKEND_URL}/api/users/${editingUser._id}` : `${BACKEND_URL}/api/users`;
    const method = editingUser ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(form)
      });
      if (res.ok) {
        showAlert(editingUser ? 'Usuário atualizado!' : 'Usuário criado!', 'success');
        setIsModalOpen(false);
        fetchUsers();
      } else {
        const data = await res.json();
        showAlert(data.error || 'Erro ao processar', 'error');
      }
    } catch (e) { console.error(e); }
  };

  const handleEdit = (user) => {
    setEditingUser(user);
    setForm({
      name: user.name,
      email: user.email || user.username || '',
      role: user.role,
      password: '',
      confirmPassword: ''
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

    const token = localStorage.getItem('genesis_token');
    try {
      const res = await fetch(`${BACKEND_URL}/api/users/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        showAlert('Usuário removido', 'success');
        fetchUsers();
      }
    } catch (e) { console.error(e); }
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white uppercase tracking-tighter">Membros da Equipe</h1>
          <p className="text-gray-500 font-medium italic">Gerencie os acessos e permissões da plataforma</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex items-center gap-3 bg-white dark:bg-zinc-900 p-2 rounded-2xl border border-gray-100 dark:border-zinc-800 shadow-sm min-w-[280px]">
            <Search size={20} className="text-gray-400 ml-2" />
            <input 
              type="text" 
              placeholder="Buscar por nome ou email..." 
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-sm font-bold dark:text-white"
            />
          </div>
          <button 
            onClick={() => { setEditingUser(null); setForm({name:'', email:'', password:'', confirmPassword:'', role:'salao'}); setIsModalOpen(true); }}
            className="px-6 py-3 bg-genesis-red text-white font-black uppercase text-xs rounded-2xl shadow-lg shadow-red-500/20 hover:bg-red-700 transition-all flex items-center justify-center gap-2"
          >
            <UserPlus size={16}/> Novo Usuário
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-48 bg-gray-100 dark:bg-zinc-800 rounded-[40px]"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredUsers.map(user => (
            <motion.div 
              key={user._id}
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-[#111111] p-8 rounded-[40px] border border-gray-100 dark:border-zinc-800 shadow-sm relative group overflow-hidden"
            >
              {/* Decorative ball — bottom-left, behind content */}
              <div className={`absolute -left-6 -bottom-6 w-28 h-28 rounded-full opacity-5 group-hover:opacity-10 transition-all pointer-events-none ${getRoleColor(user.role)}`}></div>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${getRoleBadge(user.role)}`}>
                    {user.role}
                  </span>
                  {/* Action buttons — z-10 to stay above decorative elements */}
                  <div className="flex items-center gap-1 relative z-10">
                    <button onClick={() => handleEdit(user)} className="p-2 text-gray-400 hover:text-blue-500 transition-all rounded-xl hover:bg-blue-50 dark:hover:bg-blue-500/10"><Edit2 size={16}/></button>
                    {user.email !== currentUser?.email ? (
                      <button onClick={() => handleDelete(user._id)} className="p-2 text-gray-400 hover:text-red-500 transition-all rounded-xl hover:bg-red-50 dark:hover:bg-red-500/10"><Trash2 size={16}/></button>
                    ) : (
                      <div className="p-2 text-gray-200 dark:text-zinc-700 cursor-not-allowed" title="Você não pode excluir sua própria conta">
                        <Trash2 size={16}/>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-black text-gray-900 dark:text-white uppercase leading-tight mb-1">{user.name}</h3>
                  <div className="flex items-center gap-2 text-xs font-bold text-gray-500">
                    <Mail size={12}/> {user.email}
                    {user.email === currentUser?.email && (
                      <span className="ml-1 px-2 py-0.5 bg-genesis-red/10 text-genesis-red text-[9px] font-black uppercase rounded-full tracking-widest">Você</span>
                    )}
                  </div>
                </div>

                <div className="pt-6 border-t border-gray-50 dark:border-zinc-800/50 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Cadastrado por</p>
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{user.created_by || 'Sistema'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Desde</p>
                    <p className="text-xs font-bold text-gray-700 dark:text-gray-300">{new Date(user.createdAt).toLocaleDateString()}</p>
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsModalOpen(false)} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="relative bg-white dark:bg-[#111111] w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden border border-gray-200 dark:border-zinc-800"
            >
              <form onSubmit={handleSubmit} className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-genesis-red/10 text-genesis-red rounded-2xl">
                      {editingUser ? <Edit2 size={24}/> : <UserPlus size={24}/>}
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-gray-900 dark:text-white uppercase tracking-tight">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h2>
                      <p className="text-xs text-gray-500 font-bold uppercase tracking-widest">Defina as credenciais de acesso</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="p-2 text-gray-400 hover:text-gray-600 transition-all"><X /></button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Nome Completo</label>
                    <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none font-bold" />
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Email de Acesso</label>
                    <input required type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none font-bold" />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative">
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Senha</label>
                      <input 
                        required={!editingUser} 
                        type={showPassword ? 'text' : 'password'} 
                        value={form.password} 
                        onChange={e => setForm({...form, password: e.target.value})} 
                        className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none font-bold pr-12" 
                        placeholder={editingUser ? 'Deixe em branco' : '********'} 
                      />
                      <button 
                        type="button" 
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-4 bottom-3 text-gray-400 hover:text-gray-600 transition-all"
                      >
                        {showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}
                      </button>
                    </div>
                    <div className="relative">
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Confirmar</label>
                      <input 
                        required={!editingUser} 
                        type={showPassword ? 'text' : 'password'} 
                        value={form.confirmPassword} 
                        onChange={e => setForm({...form, confirmPassword: e.target.value})} 
                        className="w-full bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-genesis-red outline-none font-bold pr-12" 
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-gray-400 uppercase mb-2 block tracking-widest">Nível de Acesso</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['material', 'salao', 'admin'].map(role => (
                        <button
                          key={role}
                          type="button"
                          onClick={() => setForm({...form, role})}
                          className={`py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all ${form.role === role ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 border-gray-900 dark:border-white' : 'border-gray-100 dark:border-zinc-800 text-gray-400'}`}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button type="submit" className="w-full py-4 bg-genesis-red text-white font-black uppercase text-xs rounded-2xl hover:opacity-90 transition-all shadow-xl shadow-red-500/20 flex items-center justify-center gap-2">
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
  return colors[role] || 'bg-gray-500/10 text-gray-500';
}