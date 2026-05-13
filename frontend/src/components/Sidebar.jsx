import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Package, Briefcase, Trophy, Coins,
  MessageSquare, Layers, BarChart, MonitorPlay, ClipboardList,
  Users, X, LogOut, Sun, Moon, ChevronRight
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/dashboard',    icon: LayoutDashboard, label: 'Dashboard',       roles: ['admin'] },
  { to: '/salao',        icon: MonitorPlay,      label: 'Salão',           roles: ['admin', 'salao', 'material'] },
  { to: '/torneios',     icon: Trophy,           label: 'Torneios',        roles: ['admin', 'salao'] },
  { to: '/chip-race',    icon: Coins,            label: 'Chip Race',       roles: ['admin', 'salao', 'material'] },
  { to: '/estoque',      icon: Package,          label: 'Estoque',         roles: ['admin', 'material'] },
  { to: '/ficharios',    icon: Briefcase,        label: 'Fichários',       roles: ['admin', 'material'] },
  { to: '/chat',         icon: MessageSquare,    label: 'Chat',            roles: ['admin', 'salao', 'material'] },
  { to: '/modelos-stack',icon: Layers,           label: 'Stacks',          roles: ['admin', 'salao'] },
  { to: '/relatorios',   icon: BarChart,         label: 'Relatórios',      roles: ['admin'] },
  { to: '/auditoria',    icon: ClipboardList,    label: 'Auditoria',       roles: ['admin'] },
  { to: '/usuarios',     icon: Users,            label: 'Usuários',        roles: ['admin'] },
];

// Items that show in the bottom tab bar (most used, max 5)
const BOTTOM_PRIORITY = ['/salao', '/torneios', '/chip-race', '/chat', '/estoque'];

export default function Sidebar({ isOpen, onOpen, onClose, onLogout, user, theme, onToggleTheme }) {
  const location = useLocation();
  const filtered = NAV_ITEMS.filter(i => i.roles.includes(user?.role));

  // Bottom nav items: priority items user has access to, up to 4, plus "Menu" 
  const bottomItems = filtered.filter(i => BOTTOM_PRIORITY.includes(i.to)).slice(0, 4);

  return (
    <>
      {/* ─── DESKTOP SIDEBAR ──────────────────────────────────── */}
      <aside className="hidden md:flex fixed top-0 left-0 h-full w-64 bg-white dark:bg-[#111111] z-40 flex-col border-r border-gray-200 dark:border-zinc-800/50 shadow-2xl">
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-gray-100 dark:border-white/5 shrink-0">
          <span className="text-2xl font-black tracking-widest text-genesis-red">GENESIS</span>
          <button
            onClick={onToggleTheme}
            className="p-2 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {/* User info */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-white/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-genesis-red/10 flex items-center justify-center text-genesis-red font-black text-sm shrink-0">
              {(user?.name || user?.username || '?')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm text-gray-900 dark:text-white truncate">{user?.name || user?.username}</p>
              <p className="text-[10px] text-genesis-red font-black uppercase tracking-widest opacity-80">{user?.role}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {filtered.map(item => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 font-semibold text-sm group
                  ${isActive
                    ? 'bg-genesis-red text-white shadow-md shadow-red-500/20'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800/60 hover:text-gray-900 dark:hover:text-white'
                  }`
                }
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-gray-100 dark:border-white/5 shrink-0">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl font-semibold text-sm text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-all"
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* ─── MOBILE DRAWER ────────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
              onClick={onClose}
            />

            {/* Drawer panel */}
            <motion.div
              key="drawer"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="md:hidden fixed top-0 left-0 h-full w-72 bg-white dark:bg-[#111111] z-50 flex flex-col shadow-2xl"
            >
              {/* Drawer header */}
              <div className="h-16 flex items-center justify-between px-5 border-b border-gray-100 dark:border-zinc-800 shrink-0">
                <span className="text-xl font-black tracking-widest text-genesis-red">GENESIS</span>
                <button onClick={onClose} className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800">
                  <X size={20} />
                </button>
              </div>

              {/* User card inside drawer */}
              <div className="px-4 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-3 bg-gray-50 dark:bg-zinc-900 rounded-2xl p-3">
                  <div className="w-10 h-10 rounded-full bg-genesis-red flex items-center justify-center text-white font-black text-sm shrink-0">
                    {(user?.name || user?.username || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-900 dark:text-white truncate">{user?.name || user?.username}</p>
                    <p className="text-[10px] text-genesis-red font-black uppercase tracking-widest">{user?.role}</p>
                  </div>
                </div>
              </div>

              {/* Nav items */}
              <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
                {filtered.map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all font-semibold text-sm
                        ${isActive
                          ? 'bg-genesis-red text-white shadow-lg shadow-red-500/20'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
                        }`}
                    >
                      <div className={`p-1.5 rounded-lg ${isActive ? 'bg-white/20' : 'bg-gray-100 dark:bg-zinc-800'}`}>
                        <Icon size={16} />
                      </div>
                      <span className="flex-1">{item.label}</span>
                      {isActive && <ChevronRight size={14} className="opacity-60" />}
                    </NavLink>
                  );
                })}
              </nav>

              {/* Footer */}
              <div className="p-4 border-t border-gray-100 dark:border-zinc-800 space-y-2 shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
                <button
                  onClick={onToggleTheme}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800 transition-all"
                >
                  <div className="p-1.5 rounded-lg bg-gray-100 dark:bg-zinc-800">
                    {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  </div>
                  <span>{theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}</span>
                </button>
                <button
                  onClick={() => { onClose(); onLogout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-semibold text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-all"
                >
                  <div className="p-1.5 rounded-lg bg-red-50 dark:bg-red-500/10">
                    <LogOut size={16} />
                  </div>
                  <span>Sair</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── MOBILE BOTTOM NAV ────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-[#111111] border-t border-gray-200 dark:border-zinc-800 flex items-stretch"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', height: 'calc(68px + env(safe-area-inset-bottom, 0px))' }}>
        {bottomItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1 transition-all"
            >
              <div className={`p-2 rounded-xl transition-all ${isActive ? 'bg-genesis-red text-white shadow-md shadow-red-500/30' : 'text-gray-400 dark:text-gray-500'}`}>
                <Icon size={20} />
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wide ${isActive ? 'text-genesis-red' : 'text-gray-400 dark:text-gray-500'}`}>
                {item.label}
              </span>
            </NavLink>
          );
        })}
        {/* "Mais" / Menu button */}
        <button
          onClick={onOpen}
          className="flex-1 flex flex-col items-center justify-center gap-1 pt-2 pb-1 text-gray-400 dark:text-gray-500"
        >
          <div className="p-2 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
          </div>
          <span className="text-[9px] font-bold uppercase tracking-wide">Menu</span>
        </button>
      </nav>
    </>
  );
}
