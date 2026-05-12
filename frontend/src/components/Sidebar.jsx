import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Package, Briefcase, Trophy, Coins, MessageSquare, Layers, BarChart, MonitorPlay, ClipboardList, Users, X, LogOut, Sun, Moon } from 'lucide-react';

export default function Sidebar({ isOpen, onClose, onLogout, user, theme, onToggleTheme }) {
  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard size={20} />, label: 'Dashboard', roles: ['admin'] },
    { to: '/estoque', icon: <Package size={20} />, label: 'Estoque de Fichas', roles: ['admin', 'material'] },
    { to: '/ficharios', icon: <Briefcase size={20} />, label: 'Fichários', roles: ['admin', 'material'] },
    { to: '/torneios', icon: <Trophy size={20} />, label: 'Torneios', roles: ['admin', 'salao'] },
    { to: '/chip-race', icon: <Coins size={20} />, label: 'ChipRace', roles: ['admin', 'salao', 'material'] },
    { to: '/chat', icon: <MessageSquare size={20} />, label: 'Chat', roles: ['admin', 'salao', 'material'] },
    { to: '/modelos-stack', icon: <Layers size={20} />, label: 'Modelos de Stack', roles: ['admin', 'salao'] },
    { to: '/relatorios', icon: <BarChart size={20} />, label: 'Relatórios', roles: ['admin'] },
    { to: '/salao', icon: <MonitorPlay size={20} />, label: 'Visão de Salão', roles: ['admin', 'salao', 'material'] },
    { to: '/auditoria', icon: <ClipboardList size={20} />, label: 'Log de Auditoria', roles: ['admin'] },
    { to: '/usuarios', icon: <Users size={20} />, label: 'Usuários', roles: ['admin'] },
  ];

  return (
    <aside className={`fixed top-0 left-0 h-full w-64 bg-white dark:bg-[#111111] z-40 transform transition-transform duration-300 ease-in-out border-r border-gray-200 dark:border-zinc-800/50 shadow-2xl md:translate-x-0 flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-white/5 bg-gray-50 dark:bg-transparent shrink-0">
        <span className="text-2xl font-black tracking-widest text-genesis-red">GENESIS</span>
        <button onClick={onClose} className="md:hidden p-2 text-gray-500 dark:text-gray-400 hover:text-genesis-red rounded-lg">
          <X size={20} />
        </button>
      </div>

      <div className="p-6 border-b border-gray-100 dark:border-white/5 shrink-0">
        <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-widest font-bold mb-1">Usuário Ativo</p>
        <p className="font-semibold text-gray-900 dark:text-white truncate">{user?.name || user?.username}</p>
        <p className="text-sm text-genesis-red font-medium uppercase mt-1 opacity-80">{user?.role}</p>
      </div>

      <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto scrollbar-thin">
        {navItems.filter(item => item.roles.includes(user?.role)).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={onClose}
            className={({ isActive }) => `flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 font-semibold text-sm ${isActive ? 'bg-genesis-red text-white shadow-lg shadow-red-500/30' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800/50 hover:text-gray-900 dark:hover:text-gray-100'}`}
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-gray-100 dark:border-white/5 shrink-0 space-y-2">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-500 transition-all"
        >
          <LogOut size={18} /> Sair
        </button>
      </div>
    </aside>
  );
}
