import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle, Info, X } from 'lucide-react';
import { SPRING_SNAP, EXIT, scrimMotion, modalMotion } from '../lib/motion';

const AlertContext = createContext();

export const useAlert = () => useContext(AlertContext);

const TONE_STYLES = {
  warning: { bar: 'bg-amber-500', text: 'text-amber-500', icon: AlertTriangle, title: 'Atenção' },
  danger:  { bar: 'bg-red-500',   text: 'text-red-500',   icon: AlertTriangle, title: 'Confirmar' },
  info:    { bar: 'bg-blue-500',  text: 'text-blue-500',  icon: Info,          title: 'Aviso' },
  success: { bar: 'bg-emerald-500', text: 'text-emerald-500', icon: CheckCircle, title: 'Pronto' },
};

export const AlertProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind: 'confirm'|'prompt'|'modal', ... }
  const inputRef = useRef(null);
  const [promptValue, setPromptValue] = useState('');

  const showAlert = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const showConfirm = useCallback((message, opts = {}) => new Promise((resolve) => {
    setDialog({
      kind: 'confirm', message,
      title: opts.title, tone: opts.tone || 'warning',
      confirmLabel: opts.confirmLabel || 'Confirmar', cancelLabel: opts.cancelLabel || 'Cancelar',
      resolve,
    });
  }), []);

  const showPrompt = useCallback((message, opts = {}) => new Promise((resolve) => {
    setPromptValue(opts.defaultValue || '');
    setDialog({
      kind: 'prompt', message,
      title: opts.title, tone: opts.tone || 'info',
      placeholder: opts.placeholder || '',
      confirmLabel: opts.confirmLabel || 'Salvar', cancelLabel: opts.cancelLabel || 'Cancelar',
      resolve,
    });
  }), []);

  // Modal só-OK (bloqueante), p/ mostrar uma informação
  const showModal = useCallback((message, opts = {}) => new Promise((resolve) => {
    setDialog({
      kind: 'modal', message,
      title: opts.title, tone: opts.tone || 'info',
      confirmLabel: opts.confirmLabel || 'Entendi',
      resolve,
    });
  }), []);

  const close = useCallback((result) => {
    setDialog((d) => { d?.resolve?.(result); return null; });
  }, []);

  useEffect(() => {
    if (!dialog) return;
    if (dialog.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 30);

    const onKey = (e) => {
      if (e.key === 'Escape') close(dialog.kind === 'prompt' ? null : (dialog.kind === 'modal' ? undefined : false));
      if (e.key === 'Enter' && dialog.kind !== 'prompt') {
        close(dialog.kind === 'confirm' ? true : undefined);
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [dialog, close]);

  const tone = dialog ? (TONE_STYLES[dialog.tone] || TONE_STYLES.warning) : null;
  const ToneIcon = tone?.icon;
  const cancelResult = dialog?.kind === 'prompt' ? null : (dialog?.kind === 'modal' ? undefined : false);

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, showPrompt, showModal }}>
      {children}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: SPRING_SNAP }}
            exit={{ opacity: 0, y: 12, scale: 0.97, transition: EXIT }}
            role="status"
            aria-live="polite"
            className={`material-sheet fixed inset-x-4 bottom-[calc(92px+env(safe-area-inset-bottom,0px))] z-[110] flex items-center gap-3 rounded-2xl px-5 py-4 md:inset-x-auto md:bottom-6 md:right-6 ${
              toast.type === 'error' ? 'text-danger' : toast.type === 'success' ? 'text-ok' : 'text-info'
            }`}
          >
            {toast.type === 'error' && <AlertTriangle size={20} />}
            {toast.type === 'success' && <CheckCircle size={20} />}
            {toast.type === 'info' && <Info size={20} />}
            <p className="font-bold text-sm">{toast.message}</p>
            <button onClick={() => setToast(null)} className="ml-2 opacity-70 hover:opacity-100"><X size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal unificado: confirm / prompt / info */}
      <AnimatePresence>
        {dialog && (
          <motion.div
            {...scrimMotion}
            onClick={() => close(cancelResult)}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-backdrop"
          >
            <motion.div
              {...modalMotion}
              role={dialog.kind === 'confirm' ? 'alertdialog' : 'dialog'}
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="card material-sheet relative w-full max-w-sm max-h-[92vh] overflow-y-auto p-6"
            >
              <div className={`absolute left-0 top-0 h-1 w-full ${tone.bar}`} />
              <button onClick={() => close(cancelResult)} className="absolute right-4 top-4 text-gray-300 hover:text-gray-500" aria-label="Fechar"><X size={18} /></button>

              <div className={`mb-3 flex items-center gap-3 ${tone.text}`}>
                <ToneIcon size={26} />
                <h3 className="text-lg font-bold text-fg">{dialog.title || tone.title}</h3>
              </div>

              {typeof dialog.message === 'string'
                ? <p className="mb-5 whitespace-pre-line font-medium text-fg-muted">{dialog.message}</p>
                : <div className="mb-5">{dialog.message}</div>}

              {dialog.kind === 'prompt' && (
                <form
                  onSubmit={(e) => { e.preventDefault(); if (promptValue.trim()) close(promptValue.trim()); }}
                  className="mb-5"
                >
                  <input
                    ref={inputRef}
                    value={promptValue}
                    onChange={(e) => setPromptValue(e.target.value)}
                    placeholder={dialog.placeholder}
                    className="input w-full"
                  />
                </form>
              )}

              <div className="flex gap-3">
                {dialog.kind !== 'modal' && (
                  <button
                    onClick={() => close(cancelResult)}
                    className="flex-1 rounded-xl bg-raised py-3 font-bold text-fg transition-all hover:bg-gray-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  >
                    {dialog.cancelLabel}
                  </button>
                )}
                <button
                  onClick={() => {
                    if (dialog.kind === 'prompt') { if (promptValue.trim()) close(promptValue.trim()); }
                    else if (dialog.kind === 'confirm') close(true);
                    else close(undefined);
                  }}
                  className={`btn btn-lg flex-1 ${dialog.tone === 'danger' ? 'btn-danger-solid' : 'btn-primary'}`}
                >
                  {dialog.confirmLabel}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AlertContext.Provider>
  );
};
