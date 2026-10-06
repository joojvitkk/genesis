import { createContext, useContext, useCallback, useMemo, useState } from 'react';
import pt from '../locales/pt';
import en from '../locales/en';
import { setRuntimeLang } from './i18n-runtime/translate';

const DICTS = { pt, en };
const KEY = 'genesis_lang';

/** Tradução pura — testável sem React. */
export function translate(lang, key, vars) {
  let s = DICTS[lang]?.[key] ?? DICTS.pt[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

const I18nContext = createContext({ lang: 'pt', setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(KEY) || 'pt'; } catch { return 'pt'; }
  });

  const setLang = useCallback((l) => {
    setRuntimeLang(l);                       // o texto de TODA a interface passa por tr() com este idioma
    document.documentElement.lang = l === 'en' ? 'en' : 'pt-BR';
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);

  const value = useMemo(() => ({ lang, setLang, t, langs: Object.keys(DICTS) }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export { locale, tr } from './i18n-runtime/translate';

export function useT() {
  return useContext(I18nContext);
}
