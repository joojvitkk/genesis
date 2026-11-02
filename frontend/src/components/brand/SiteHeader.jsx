import { Link } from 'react-router-dom';
import { Sun, Moon } from 'lucide-react';
import Logo from './Logo';

/**
 * Cabeçalho das páginas públicas (/site e /login) — o mesmo nas duas, para a experiência ser uma só.
 * Material translúcido, marca à esquerda, poucas ações à direita. `nav` é opcional (só o /site tem seções).
 */
export default function SiteHeader({ theme, onToggleTheme, nav = [], active = '', onNav, action }) {
  return (
    <header className="material sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to="/site" aria-label="GENESIS — início"><Logo height={28} className="text-fg" /></Link>
        {nav.length > 0 && (
          <nav aria-label="Seções" className="hidden items-center gap-1 md:flex">
            {nav.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={onNav?.(n.id)} aria-current={active === n.id ? 'true' : undefined}
                className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${active === n.id ? 'bg-sunken text-fg' : 'text-fg-muted hover:text-fg'}`}>{n.label}</a>
            ))}
          </nav>
        )}
        <div className="flex items-center gap-2">
          <button onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Modo claro' : 'Modo escuro'} className="btn btn-ghost btn-icon">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          {action}
        </div>
      </div>
    </header>
  );
}
