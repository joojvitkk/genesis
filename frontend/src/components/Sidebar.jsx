import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Package, Briefcase, Trophy, Coins,
  MessageSquare, Layers, BarChart, MonitorPlay, ClipboardList,
  Users, BookOpen, ListOrdered, ShieldAlert, Target, CalendarRange, X, LogOut, Sun, Moon, ChevronRight, Menu
} from 'lucide-react';
import { can } from '../config';
import { useT } from '../lib/i18n.jsx';
import Avatar from './Avatar';
import { SPRING_SHEET, EXIT, scrimMotion } from '../lib/motion';
import Logo from './brand/Logo';

// Apple Design §6: para onde o gesto está INDO (projeção de momento), não onde soltou. d=0.998 → v·0.499 px.
const projectX = (v) => (v / 1000) * 0.998 / (1 - 0.998);

// `area` refere-se à matriz de permissões em config.js (PERMISSIONS). Grupos por finalidade operacional; grupo sem item autorizado não aparece.
export const NAV_GROUPS = [
  { key: 'nav.group.overview', items: [
    { to: '/dashboard',     icon: LayoutDashboard, key: 'nav.dashboard',   area: 'dashboard' },
    { to: '/eventos',       icon: CalendarRange,   key: 'nav.eventos',     area: 'torneios' },
    { to: '/torneios',      icon: Trophy,          key: 'nav.torneios',    area: 'torneios' },
    { to: '/tracking-sheet',icon: ListOrdered,     key: 'nav.tracking',    area: 'torneios' },
  ] },
  { key: 'nav.group.operation', items: [
    { to: '/salao',         icon: MonitorPlay,     key: 'nav.salao',       area: 'mesas' },
    { to: '/chip-race',     icon: Coins,           key: 'nav.chipRace',    short: 'nav.chipRaceShort', area: 'chip_race' },
    { to: '/ocorrencias',   icon: ShieldAlert,     key: 'nav.ocorrencias', area: 'estoque' },
    { to: '/chat',          icon: MessageSquare,   key: 'nav.chat',        area: 'chat' },
  ] },
  { key: 'nav.group.stock', items: [
    { to: '/estoque',       icon: Package,         key: 'nav.estoque',     area: 'estoque' },
    { to: '/fichas-ko',     icon: Target,          key: 'nav.fichasKo',    area: 'estoque' },
    { to: '/ficharios',     icon: Briefcase,       key: 'nav.ficharios',   area: 'ficharios' },
    { to: '/modelos-stack', icon: Layers,          key: 'nav.stacks',      area: 'modelos_stack' },
  ] },
  { key: 'nav.group.control', items: [
    { to: '/relatorios',    icon: BarChart,        key: 'nav.relatorios',  area: 'relatorios' },
    { to: '/livro-estoque', icon: BookOpen,        key: 'nav.livroEstoque',area: 'estoque' },
    { to: '/auditoria',     icon: ClipboardList,   key: 'nav.auditoria',   area: 'auditoria' },
    { to: '/usuarios',      icon: Users,           key: 'nav.usuarios',    area: 'usuarios' },
  ] },
];
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Grupos visíveis para o papel (itens autorizados; grupos vazios saem). */
export function visibleGroups(role) {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.area)) })).filter((g) => g.items.length);
}

// Items that show in the bottom tab bar (most used, max 5)
const BOTTOM_PRIORITY = ['/salao', '/torneios', '/chip-race', '/chat', '/estoque'];

/** Marca oficial (conceito 02 · G modular): símbolo + wordmark. */
function Brand({ size = 'md' }) {
  return <Logo height={size === 'lg' ? 34 : 28} className="text-fg" />;
}

function NavGroup({ title, children }) {
  return (
    <div role="group" aria-label={title} className="border-t border-line-soft py-2 first:border-t-0 first:pt-0">
      <p className="nav-group-title pt-1">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function UserBadge({ user }) {
  const name = user?.name || user?.username || '?';
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar user={user} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-fg">{name}</p>
        <p className="text-xs font-medium capitalize text-fg-subtle">{user?.role}</p>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onOpen, onClose, onLogout, user, theme, onToggleTheme }) {
  const location = useLocation();
  const { t } = useT();
  const groups = visibleGroups(user?.role);
  const filtered = groups.flatMap((g) => g.items).map(i => ({ ...i, label: t(i.key) }));
  const bottomItems = filtered.filter(i => BOTTOM_PRIORITY.includes(i.to)).slice(0, 4);
  const themeLabel = theme === 'dark' ? 'Modo claro' : 'Modo escuro';
  const ThemeIcon = theme === 'dark' ? Sun : Moon;

  return (
    <>
      {/* ─── Desktop ─────────────────────────────────────────── */}
      <aside className="material material-float hidden md:flex fixed left-3 top-3 bottom-3 z-40 w-60 flex-col overflow-hidden rounded-3xl border">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-4">
          <Brand />
          <button onClick={onToggleTheme} aria-label={themeLabel} title={themeLabel} className="btn btn-ghost btn-icon">
            <ThemeIcon size={16} />
          </button>
        </div>

        <NavLink to="/conta" aria-label="Minha conta" title="Minha conta" className={({ isActive }) => `block shrink-0 border-b border-line-soft px-4 py-3 transition-colors hover:bg-sunken ${isActive ? 'bg-brand-soft' : ''}`}><UserBadge user={user} /></NavLink>

        <nav aria-label="Principal" className="flex-1 overflow-y-auto px-2 py-2">
          {groups.map((g) => (
            <NavGroup key={g.key} title={t(g.key)}>
              {g.items.map(item => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`}>
                    <Icon size={18} className="shrink-0" aria-hidden="true" />
                    <span className="truncate">{t(item.key)}</span>
                  </NavLink>
                );
              })}
            </NavGroup>
          ))}
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-line-soft p-2">
          <button onClick={onLogout} className="nav-item w-full hover:!text-danger"><LogOut size={16} aria-hidden="true" /> {t('account.logout')}</button>
        </div>
      </aside>

      {/* ─── Drawer mobile ───────────────────────────────────── */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div key="backdrop" {...scrimMotion} className="md:hidden fixed inset-0 z-40 modal-backdrop" onClick={onClose} />
            {/* gaveta: segue o dedo 1:1, resiste nas bordas (rubber band) e fecha pela projeção de momento; sai pelo mesmo lado por onde entrou */}
            <motion.div key="drawer" initial={{ x: '-100%' }} animate={{ x: 0, transition: SPRING_SHEET }} exit={{ x: '-100%', transition: EXIT }}
              drag="x" dragDirectionLock dragConstraints={{ left: -288, right: 0 }} dragElastic={{ left: 0, right: 0.08 }}
              onDragEnd={(_, info) => { if (info.offset.x + projectX(info.velocity.x) < -120) onClose(); }}
              className="material-sheet md:hidden fixed left-0 top-0 z-50 flex h-full w-72 flex-col rounded-r-2xl border-l-0" role="dialog" aria-modal="true" aria-label="Menu">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-4">
                <Brand />
                <button onClick={onClose} aria-label="Fechar menu" className="btn btn-ghost btn-icon"><X size={20} /></button>
              </div>
              <NavLink to="/conta" onClick={onClose} draggable={false} aria-label="Minha conta" className="block shrink-0 border-b border-line-soft px-4 py-3 hover:bg-sunken"><UserBadge user={user} /></NavLink>
              <nav aria-label="Principal" className="flex-1 overflow-y-auto px-2 py-2">
                {groups.map((g) => (
                  <NavGroup key={g.key} title={t(g.key)}>
                    {g.items.map(item => {
                      const Icon = item.icon;
                      const isActive = location.pathname === item.to;
                      return (
                        <NavLink key={item.to} to={item.to} onClick={onClose} draggable={false} className={`nav-item min-h-11 ${isActive ? 'nav-item-active' : ''}`}>
                          <Icon size={18} className="shrink-0" aria-hidden="true" />
                          <span className="flex-1">{t(item.key)}</span>
                          {isActive && <ChevronRight size={14} aria-hidden="true" />}
                        </NavLink>
                      );
                    })}
                  </NavGroup>
                ))}
              </nav>
              <div className="shrink-0 space-y-0.5 border-t border-line-soft p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
                <button onClick={onToggleTheme} className="nav-item min-h-11 w-full"><ThemeIcon size={16} aria-hidden="true" /> {themeLabel}</button>
                <button onClick={() => { onClose(); onLogout(); }} className="nav-item min-h-11 w-full hover:!text-danger"><LogOut size={16} aria-hidden="true" /> {t('account.logout')}</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ─── Barra inferior mobile (máx. 5 itens, alvo ≥ 44px) ──── */}
      <nav aria-label="Atalhos" className="material material-float md:hidden fixed inset-x-3 z-40 flex items-stretch overflow-hidden rounded-3xl border"
           style={{ bottom: 'calc(10px + env(safe-area-inset-bottom, 0px))', height: '64px' }}>
        {bottomItems.map(item => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <NavLink key={item.to} to={item.to} aria-current={isActive ? 'page' : undefined}
              className={`press flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive ? 'text-brand-fg' : 'text-fg-subtle'}`}>
              <Icon size={20} aria-hidden="true" />
              <span>{item.short ? t(item.short) : item.label}</span>
            </NavLink>
          );
        })}
        <button onClick={onOpen} className="press flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium text-fg-subtle">
          <Menu size={20} aria-hidden="true" />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
