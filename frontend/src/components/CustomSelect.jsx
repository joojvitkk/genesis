import { useState, useEffect, useRef, useLayoutEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

const MENU_MAX = 288; // px (18rem)
const GAP = 4;

/**
 * Select padronizado do sistema (ver DESIGN_SYSTEM.md §3.3).
 * O menu é desenhado num PORTAL (document.body) com posição fixa: nunca é cortado nem empurra a rolagem
 * de um modal/popup. Abre para baixo e vira para cima quando não há espaço. Teclado: ↑ ↓ Enter Esc Home End.
 *
 * props: options [{ value, label }], value, onChange(value), placeholder, disabled, id, 'aria-label'
 */
export default function CustomSelect({ options = [], value, onChange, placeholder = 'Selecione...', disabled = false, id, 'aria-label': ariaLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState(null); // { left, width, top?, bottom?, maxHeight }
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const listId = useId();
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedOption = options[selectedIndex];

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP - 8;
    const above = r.top - GAP - 8;
    const wanted = Math.min(MENU_MAX, Math.max(options.length, 1) * 44 + 2);
    const openUp = below < Math.min(wanted, 160) && above > below;
    const space = openUp ? above : below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8)),
      width: r.width,
      maxHeight: Math.max(120, Math.min(MENU_MAX, space)),
      ...(openUp ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
    });
  }, [options.length]);

  const open = () => { if (disabled) return; place(); setActive(selectedIndex >= 0 ? selectedIndex : 0); setIsOpen(true); };
  const close = useCallback((refocus = false) => { setIsOpen(false); if (refocus) buttonRef.current?.focus(); }, []);
  const choose = (opt) => { onChange?.(opt.value); close(true); };

  useLayoutEffect(() => { if (isOpen) place(); }, [isOpen, place]);

  // fecha ao clicar fora; reposiciona ao rolar (qualquer ancestral) ou redimensionar
  useEffect(() => {
    if (!isOpen) return undefined;
    const onDown = (e) => {
      if (buttonRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      close();
    };
    const onMove = (e) => { if (menuRef.current?.contains(e.target)) return; place(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', place);
    };
  }, [isOpen, place, close]);

  // mantém o item ativo visível
  useEffect(() => {
    if (isOpen && active >= 0) menuRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, active]);

  const onKeyDown = (e) => {
    if (disabled) return;
    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    const last = options.length - 1;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(last, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (options[active]) choose(options[active]); }
    else if (e.key === 'Tab') close();
  };

  return (
    <div className="relative w-full">
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listId : undefined}
        aria-label={ariaLabel}
        className="input flex items-center justify-between gap-2 text-left"
      >
        <span className={`truncate ${selectedOption ? '' : 'text-fg-subtle'}`}>{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-fg-subtle transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && !disabled && pos && createPortal(
        <ul
          ref={menuRef}
          id={listId}
          role="listbox"
          style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          className="z-[200] overflow-y-auto rounded-lg border border-line bg-surface py-1 text-fg shadow-2xl"
        >
          {options.map((opt, i) => {
            const selected = opt.value === value;
            return (
              <li
                key={String(opt.value)}
                data-index={i}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(opt)}
                className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm ${i === active ? 'bg-sunken' : ''} ${selected ? 'font-semibold text-brand-fg' : ''}`}
              >
                <span className="min-w-0 flex-1">{opt.label}</span>
                {selected && <Check size={16} aria-hidden="true" className="shrink-0" />}
              </li>
            );
          })}
          {options.length === 0 && <li className="px-3 py-3 text-sm text-fg-subtle">Nenhuma opção disponível</li>}
        </ul>,
        document.body,
      )}
    </div>
  );
}
