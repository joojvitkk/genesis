const TOKEN_KEY = 'genesis_token';
const USER_KEY = 'genesis_user';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
}

// Chaves de dados do usuário que não podem sobreviver ao logout (a próxima conta no mesmo aparelho não herda nada).
// Preferências visuais (tema, idioma) ficam: não são dados de ninguém.
const USER_DATA_KEYS = ['genesis_offline_queue']; // fila offline removida: limpa o que versões antigas deixaram
const USER_DATA_PREFIXES = ['genesis_report_presets', 'genesis:tracking:']; // a folha digital em cache também sai no logout

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    for (const k of Object.keys(localStorage)) {
      if (USER_DATA_KEYS.includes(k) || USER_DATA_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
    sessionStorage.clear();
  } catch { /* ignore */ }
  purgeApiCaches();
}

/** Apaga qualquer cache de API deixado por versões antigas do service worker (`genesis-api`). */
export function purgeApiCaches() {
  try {
    if (typeof caches === 'undefined') return;
    caches.keys().then((keys) => keys.filter((k) => /api/i.test(k)).forEach((k) => caches.delete(k))).catch(() => {});
  } catch { /* ignore */ }
}

// Handler global chamado quando a API retorna 401 (sessão expirada/inválida).
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) { unauthorizedHandler = fn; }
export function notifyUnauthorized() {
  clearSession();
  if (unauthorizedHandler) unauthorizedHandler();
}
