import { useEffect } from 'react';

/**
 * Fecha um modal com a tecla Esc e trava o scroll do body enquanto aberto.
 * @param {boolean} open
 * @param {() => void} onClose
 */
export function useModalDismiss(open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);
}
