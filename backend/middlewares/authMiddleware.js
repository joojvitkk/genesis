const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_genesis_key';
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret_genesis_key' || process.env.JWT_SECRET.length < 32)) {
  throw new Error('JWT_SECRET ausente, padrão ou curto demais (mín. 32 caracteres): defina um segredo forte em produção.');
}

// ─── Matriz de permissões: ÁREA × NÍVEL (spec §13, §18.10) ──────────────────────
// Mantida em sincronia com frontend/src/config.js (test/permissions.test.js compara os dois).
//   view    — consultar
//   operate — operar (lançar movimentos, conferir, justificar, registrar entradas/mesas…)
//   manage  — administrar (cadastros estruturais, estornos, configurações, usuários)
// Áreas: `mesas` = operação do SALÃO (entradas, reentradas, jogadores ativos, eliminações, mesas, relógio, pausar/encerrar sessão) —
// o Material só consulta; `auditoria` = módulo administrativo de auditoria (só admin; consultar o livro-razão é outra coisa); `torneios` = estrutura do torneio e
// o material (envio, retorno, descarte, conferência, KO). O papel `salao` só consulta o restante (D3).
const LEVELS = ['view', 'operate', 'manage'];
const PERMISSIONS = {
  admin:    { dashboard: 'manage', estoque: 'manage', ficharios: 'manage', torneios: 'manage', mesas: 'manage', chip_race: 'manage', chat: 'manage', relatorios: 'manage', usuarios: 'manage', modelos_stack: 'manage', auditoria: 'manage' },
  material: { dashboard: 'view', estoque: 'operate', ficharios: 'operate', torneios: 'operate', mesas: 'view', chip_race: 'operate', chat: 'operate', relatorios: 'view', modelos_stack: 'view' },
  salao:    { dashboard: 'view', estoque: 'view', torneios: 'view', mesas: 'operate', chip_race: 'view', chat: 'operate', modelos_stack: 'view' },
};

/** O papel tem, no mínimo, este nível na área? */
const hasLevel = (role, area, level = 'view') => {
  const have = PERMISSIONS[role]?.[area];
  return !!have && LEVELS.indexOf(have) >= LEVELS.indexOf(level);
};

function decodeToken(rawHeader) {
  if (!rawHeader) return null;
  const token = rawHeader.startsWith('Bearer ') ? rawHeader.slice(7) : rawHeader;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// ─── Revogação de sessão (P5) e escopo por torneio (G11) ─────────────────────
// O token só PROVA quem é o usuário (`id`) e em qual geração de sessão (`sv`) ele nasceu. Papel, nome, e-mail e escopo
// de torneios vêm SEMPRE do banco, a cada requisição — sem cache: rebaixar/excluir/restringir um usuário vale na hora,
// inclusive com mais de um processo. Toda mudança de papel/escopo/senha incrementa `session_version` (token antigo morre).

/** Valida o token contra o banco e devolve o usuário ATUAL (id, name, email, role, allowed) ou null. */
async function authenticate(rawHeader) {
  const decoded = decodeToken(rawHeader);
  if (!decoded?.id || decoded.sv === undefined) return null; // token sem `sv` (anterior ao P5) não vale mais
  const { User } = require('../models');
  const u = await User.findById(decoded.id).select('name email role session_version allowed_tournament_ids');
  if (!u || (u.session_version || 1) !== decoded.sv) return null;
  return {
    id: String(u._id), name: u.name, email: u.email, role: u.role,
    allowed: (u.allowed_tournament_ids || []).map(String),
  };
}

/**
 * Torneios que o usuário pode acessar: `null` = todos. Admin sempre acessa todos; para os demais, lista vazia = sem
 * restrição (compatível com quem já existia) e lista preenchida = SOMENTE esses torneios.
 * Aceita o `req.user` já autenticado (traz `allowed`).
 */
async function allowedTournaments(user) {
  if (!user?.id || user.role === 'admin') return null;
  if (Array.isArray(user.allowed)) return user.allowed.length ? user.allowed : null;
  const { User } = require('../models');
  const u = await User.findById(user.id).select('allowed_tournament_ids');
  const ids = (u?.allowed_tournament_ids || []).map(String);
  return ids.length ? ids : null;
}

/** O usuário pode agir sobre este torneio? (rotas que não passam por /tournaments/:tid). Lança 403. */
async function assertTournamentAllowed(user, tournamentId) {
  const allowed = await allowedTournaments(user);
  if (!allowed) return;
  if (!tournamentId || !allowed.includes(String(tournamentId))) {
    const { HttpError } = require('../lib/catalog');
    throw new HttpError(403, 'Você não tem acesso a este torneio.');
  }
}

/** Restringe `/tournaments/:tid/**` aos torneios permitidos. Sem token válido deixa passar: o verifyToken da rota responde 401. */
const requireTournamentAccess = async (req, res, next) => {
  try {
    const user = await authenticate(req.headers['authorization']);
    if (!user) return next();
    const allowed = await allowedTournaments(user);
    if (!allowed || allowed.includes(String(req.params.tid))) return next();
    return res.status(403).json({ error: 'Você não tem acesso a este torneio.' });
  } catch {
    return res.status(500).json({ error: 'Falha ao validar o acesso ao torneio.' });
  }
};

const verifyToken = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Nenhum token fornecido.' });
  let user;
  try {
    user = await authenticate(header);
  } catch {
    return res.status(500).json({ error: 'Falha ao validar a sessão.' });
  }
  if (!user) return res.status(401).json({ error: 'Sessão inválida ou revogada. Faça login novamente.' });
  req.user = user;
  next();
};

/** Acesso à ÁREA no nível pedido (padrão: consultar). */
const requirePageAccess = (page, level = 'view') => (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ error: 'Usuário não identificado.' });
  }
  if (hasLevel(req.user.role, page, level)) return next();
  const msg = PERMISSIONS[req.user.role]?.[page] ? `Acesso negado: a área ${page} exige permissão de ${level}.` : `Acesso negado para a área: ${page}`;
  return res.status(403).json({ error: msg });
};

// Cadastros estruturais (fichas, modelos de fichário, fichários…) são só do administrador
// (spec §13/§18.10). Vale em cima de requirePageAccess: a página deixa VER, isto deixa CRIAR/EDITAR.
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !req.user.role) return res.status(401).json({ error: 'Usuário não identificado.' });
  if (roles.includes(req.user.role)) return next();
  return res.status(403).json({ error: 'Apenas administradores podem alterar cadastros estruturais.' });
};
const adminOnly = requireRole('admin');

// ─── Rate limiter do /login (só conta falhas) ───────────────────────────────
const loginFailures = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;
const IP_MAX_FAILURES = 40; // mesmo IP testando vários e-mails (password spraying)

const keyFor = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${ip}|${email}`;
};

const ipKey = (req) => `ip|${req.ip || req.connection?.remoteAddress || 'unknown'}`;
const blocked = (key, max) => {
  const e = loginFailures.get(key);
  return !!e && Date.now() - e.first <= WINDOW_MS && e.count >= max;
};
const hit = (key) => {
  const now = Date.now();
  const e = loginFailures.get(key);
  if (!e || now - e.first > WINDOW_MS) loginFailures.set(key, { count: 1, first: now });
  else e.count += 1;
};

const loginRateLimiter = (req, res, next) => {
  if (blocked(keyFor(req), MAX_FAILURES) || blocked(ipKey(req), IP_MAX_FAILURES)) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
  }
  next();
};

const registerFailedLogin = (req) => { hit(keyFor(req)); hit(ipKey(req)); };

const clearLoginAttempts = (req) => loginFailures.delete(keyFor(req));

// limpeza periódica: sem isto o mapa cresceria com cada e-mail tentado
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [k, e] of loginFailures) if (e.first < cutoff) loginFailures.delete(k);
}, WINDOW_MS).unref?.();

module.exports = {
  verifyToken,
  requirePageAccess,
  requireRole,
  adminOnly,
  decodeToken,
  PERMISSIONS,
  LEVELS,
  hasLevel,
  allowedTournaments,
  assertTournamentAllowed,
  authenticate,
  requireTournamentAccess,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  JWT_SECRET,
};
