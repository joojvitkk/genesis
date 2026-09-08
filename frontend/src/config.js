// URL do backend. Prioriza VITE_BACKEND_URL; senão usa o host atual na porta 3000.
export const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || `http://${window.location.hostname}:3000`;

// Matriz de permissões — mantida em sincronia com
// backend/middlewares/authMiddleware.js (accessControl)
export const PERMISSIONS = {
  admin:    ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios', 'usuarios', 'modelos_stack'],
  material: ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios', 'modelos_stack'],
  salao:    ['dashboard', 'estoque', 'torneios', 'chip_race', 'chat', 'modelos_stack'],
};

export function can(role, area) {
  return !!PERMISSIONS[role]?.includes(area);
}

// Mapa rota -> área de permissão
export const ROUTE_AREA = {
  '/dashboard': 'dashboard',
  '/salao': 'torneios',
  '/torneios': 'torneios',
  '/chip-race': 'chip_race',
  '/estoque': 'estoque',
  '/ficharios': 'ficharios',
  '/chat': 'chat',
  '/modelos-stack': 'modelos_stack',
  '/relatorios': 'relatorios',
  '/auditoria': 'relatorios',
  '/usuarios': 'usuarios',
};

// Rota inicial por papel
export function homeRoute(role) {
  return role === 'admin' ? '/dashboard' : '/salao';
}
