import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

/**
 * Select estilizado compartilhado.
 * props: options [{ value, label }], value, onChange(value), placeholder, disabled
 */
export default function CustomSelect({ options = [], value, onChange, placeholder = 'Selecione...', disabled = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const selectedOption = options.find(o => o.value === value);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsOpen(false);
    };
    const handleKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, []);

  return (
    <div className="relative w-full" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full flex justify-between items-center bg-gray-50 dark:bg-[#141414] border border-gray-300 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-white ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        <ChevronDown size={16} className={`transition-transform text-gray-400 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && !disabled && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1 bg-white dark:bg-[#141414] border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl max-h-48 overflow-y-auto"
          >
            {options.map(opt => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                onClick={() => { onChange(opt.value); setIsOpen(false); }}
                className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer text-sm text-gray-900 dark:text-white border-b border-gray-50 dark:border-zinc-800/30 last:border-0"
              >
                {opt.label}
              </li>
            ))}
            {options.length === 0 && (
              <li className="px-4 py-3 text-sm text-gray-400">Nenhuma opção disponível</li>
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
