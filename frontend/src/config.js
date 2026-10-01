// URL do backend.
// - VITE_BACKEND_URL definido (mesmo vazio) manda: "" = mesma origem (build de produção atrás do nginx)
// - ausente (dev): host atual na porta 3000
const envUrl = import.meta.env.VITE_BACKEND_URL;
export const BACKEND_URL =
  envUrl !== undefined ? envUrl : `http://${window.location.hostname}:3000`;

// Matriz de permissões ÁREA × NÍVEL (spec §13, §18.10) — mantida em sincronia com
// backend/middlewares/authMiddleware.js (PERMISSIONS); backend/test/permissions.test.js compara os dois.
//   view    — consultar · operate — operar (movimentos, conferência, entradas, mesas…) · manage — administrar (cadastros, estornos, config)
export const LEVELS = ['view', 'operate', 'manage'];
export const PERMISSIONS = {
  admin:    { dashboard: 'manage', estoque: 'manage', ficharios: 'manage', torneios: 'manage', mesas: 'manage', chip_race: 'manage', chat: 'manage', relatorios: 'manage', usuarios: 'manage', modelos_stack: 'manage' },
  material: { dashboard: 'view', estoque: 'operate', ficharios: 'operate', torneios: 'operate', mesas: 'operate', chip_race: 'operate', chat: 'operate', relatorios: 'view', modelos_stack: 'view' },
  salao:    { dashboard: 'view', estoque: 'view', torneios: 'view', mesas: 'operate', chip_race: 'view', chat: 'operate', modelos_stack: 'view' },
};

/** O papel tem, no mínimo, este nível na área? (padrão: consultar) */
export function can(role, area, level = 'view') {
  const have = PERMISSIONS[role]?.[area];
  return !!have && LEVELS.indexOf(have) >= LEVELS.indexOf(level);
}

// Mapa rota -> área de permissão
export const ROUTE_AREA = {
  '/dashboard': 'dashboard',
  '/salao': 'mesas',
  '/eventos': 'torneios',
  '/torneios': 'torneios',
  '/chip-race': 'chip_race',
  '/estoque': 'estoque',
  '/livro-estoque': 'estoque',
  '/ocorrencias': 'estoque',
  '/modelos-ficharios': 'ficharios',
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
