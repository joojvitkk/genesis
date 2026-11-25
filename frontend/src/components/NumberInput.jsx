import { locale } from '../lib/i18n';

/**
 * Campo numérico com separador de milhar ("8.000"), como o relógio e as tabelas. Aceita só dígitos; `onChange` recebe o
 * texto SEM separador ("8000"), então a lógica do pai não muda. Use no lugar de `<input type="number">` para valores grandes.
 */
export default function NumberInput({ value, onChange, className = 'input', ...rest }) {
  const raw = value === null || value === undefined || value === '' ? '' : String(value).replace(/\D/g, '');
  const shown = raw === '' ? '' : Number(raw).toLocaleString(locale());
  return (
    <input
      {...rest} type="text" inputMode="numeric" autoComplete="off" value={shown} className={className}
      onChange={(e) => onChange?.(e.target.value.replace(/\D/g, ''))}
    />
  );
}
