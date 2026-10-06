import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Package, Briefcase, Trophy, Coins,
  MessageSquare, Layers, BarChart, MonitorPlay, ClipboardList,
  Users, BookOpen, ShieldAlert, CalendarRange, X, LogOut, Sun, Moon, ChevronRight, Menu
} from 'lucide-react';
import { can } from '../config';
import { useT } from '../lib/i18n.jsx';

// `area` refere-se à matriz de permissões em config.js (PERMISSIONS)
const NAV_ITEMS = [
  { to: '/dashboard',    icon: LayoutDashboard, key: 'nav.dashboard',    area: 'dashboard' },
  { to: '/salao',        icon: MonitorPlay,     key: 'nav.salao',        area: 'mesas' },
  { to: '/eventos',      icon: CalendarRange,   key: 'nav.eventos',      area: 'torneios' },
  { to: '/torneios',     icon: Trophy,          key: 'nav.torneios',     area: 'torneios' },
  { to: '/chip-race',    icon: Coins,           key: 'nav.chipRace',     area: 'chip_race' },
  { to: '/estoque',      icon: Package,         key: 'nav.estoque',      area: 'estoque' },
  { to: '/livro-estoque',icon: BookOpen,        key: 'nav.livroEstoque', area: 'estoque' },
  { to: '/ocorrencias',  icon: ShieldAlert,     key: 'nav.ocorrencias',  area: 'estoque' },
  { to: '/ficharios',    icon: Briefcase,       key: 'nav.ficharios',    area: 'ficharios' },
  { to: '/chat',         icon: MessageSquare,   key: 'nav.chat',         area: 'chat' },
  { to: '/modelos-stack',icon: Layers,          key: 'nav.stacks',       area: 'modelos_stack' },
  { to: '/relatorios',   icon: BarChart,        key: 'nav.relatorios',   area: 'relatorios' },
  { to: '/auditoria',    icon: ClipboardList,   key: 'nav.auditoria',    area: 'auditoria' },
  { to: '/usuarios',     icon: Users,           key: 'nav.usuarios',     area: 'usuarios' },
];

// Items that show in the bottom tab bar (most used, max 5)
const BOTTOM_PRIORITY = ['/salao', '/torneios', '/chip-race', '/chat', '/estoque'];

/** Marca: wordmark em Fira Sans bold com o quadrado vermelho (único uso decorativo da cor da marca). */
function Brand({ size = 'md' }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold tracking-[0.18em] text-fg ${size === 'lg' ? 'text-xl' : 'text-base'}`}>
      <span className="inline-block h-3 w-3 rounded-sm bg-brand" aria-hidden="true" />
      GENESIS
    </span>
  );
}

function UserBadge({ user }) {
  const name = user?.name || user?.username || '?';
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-sm font-semibold text-fg border border-line">
        {name[0].toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-fg">{name}</p>
        <p className="text-xs font-medium capitalize text-fg-subtle">{user?.role}</p>
      </div>
    </div>
  );
}

function LangSwitch({ t, lang, setLang, langs }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-fg-subtle">
      <span className="font-medium">{t('lang.label')}:</span>
      {langs.map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l}
          className={`rounded px-1.5 py-0.5 font-semibold uppercase ${lang === l ? 'bg-brand-soft text-brand-fg' : 'hover:text-fg'}`}>{l}</button>
      ))}
    </div>
  );
}

export default function Sidebar({ isOpen, onOpen, onClose, onLogout, user, theme, onToggleTheme }) {
  const location = useLocation();
  const { t, lang, setLang, langs } = useT();
  const filtered = NAV_ITEMS.filter(i => can(user?.role, i.area)).map(i => ({ ...i, label: t(i.key) }));
  const bottomItems = filtered.filter(i => BOTTOM_PRIORITY.includes(i.to)).slice(0, 4);
  const themeLabel = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <>
      {/* ─── Desktop ─────────────────────────────────────────── */}
      <aside className="hidden md:flex fixed left-0 top-0 z-40 h-full w-60 flex-col border-r border-line bg-surface">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-4">
          <Brand />
          <button onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel} className="btn btn-ghost btn-icon">
            <ThemeIcon size={16} />
          </button>
        </div>

        <NavLink to="/conta" aria-label="Minha conta" title="Minha conta" className={({ isActive }) => `block shrink-0 border-b border-line-soft px-4 py-3 transition-colors hover:bg-sunken ${isActive ? 'bg-brand-soft' : ''}`}><UserBadge user={user} /></NavLink>

        <nav aria-label="Principal" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {filtered.map(item => {
            const Icon = item.icon;
            return (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
                <Icon size={18} className="shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-line-soft p-2">
          <LangSwitch t={t} lang={lang} setLang={setLang} langs={langs} />
          <button onClick={onLogout} className="nav-item w-full hover:!text-danger"><LogOut size={16} aria-hidden="true" /> {t('account.logout')}</button>
        </div>
      </aside>

      {/* ─── Drawer mobile ───────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div key="backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
              className="md:hidden fixed inset-0 z-40 bg-[var(--overlay)]" onClick={onClose} />
            <motion.div key="drawer" initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ duration: 0.22, ease: 'easeOut' }}
              className="md:hidden fixed left-0 top-0 z-50 flex h-full w-72 flex-col border-r border-line bg-surface shadow-2xl" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-4">
                <Brand />
                <button onClick={onClose} aria-label="Fechar menu" className="btn btn-ghost btn-icon"><X size={20} /></button>
              </div>
              <NavLink to="/conta" onClick={onClose} aria-label="Minha conta" className="block shrink-0 border-b border-line-soft px-4 py-3 hover:bg-sunken"><UserBadge user={user} /></NavLink>
              <nav aria-label="Principal" className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
                {filtered.map(item => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <NavLink key={item.to} to={item.to} onClick={onClose} className={`nav-item min-h-11 ${isActive ? 'nav-item-active' : ''}`}>
                      <Icon size={18} className="shrink-0" aria-hidden="true" />
                      <span className="flex-1">{item.label}</span>
                      {isActive && <ChevronRight size={14} aria-hidden="true" />}
                    </NavLink>
                  );
                })}
              </nav>
              <div className="shrink-0 space-y-0.5 border-t border-line-soft p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
                <button onClick={onToggleTheme} className="nav-item min-h-11 w-full"><ThemeIcon size={16} aria-hidden="true" /> {themeLabel}</button>
                <LangSwitch t={t} lang={lang} setLang={setLang} langs={langs} />
                <button onClick={() => { onClose(); onLogout(); }} className="nav-item min-h-11 w-full hover:!text-danger"><LogOut size={16} aria-hidden="true" /> {t('account.logout')}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Barra inferior mobile (máx. 5 itens, alvo ≥ 44px) ──── */}
      <nav aria-label="Atalhos" className="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface"
           style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', height: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}>
        {bottomItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <NavLink key={item.to} to={item.to} aria-current={isActive ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-brand-fg' : 'text-fg-subtle'}`}>
              <Icon size={20} aria-hidden="true" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
        <button onClick={onOpen} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-fg-subtle">
          <Menu size={20} aria-hidden="true" />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
