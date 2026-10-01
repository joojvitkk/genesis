const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_genesis_key';

// ─── Matriz de permissões: ÁREA × NÍVEL (spec §13, §18.10) ──────────────────────
// Mantida em sincronia com frontend/src/config.js (test/permissions.test.js compara os dois).
//   view    — consultar
//   operate — operar (lançar movimentos, conferir, justificar, registrar entradas/mesas…)
//   manage  — administrar (cadastros estruturais, estornos, configurações, usuários)
// Áreas: `mesas` = operação do salão (entradas, eliminações, mesas, relógio); `torneios` = estrutura do torneio e
// o material (envio, retorno, descarte, conferência, KO). O papel `salao` só consulta o restante (D3).
const LEVELS = ['view', 'operate', 'manage'];
const PERMISSIONS = {
  admin:    { dashboard: 'manage', estoque: 'manage', ficharios: 'manage', torneios: 'manage', mesas: 'manage', chip_race: 'manage', chat: 'manage', relatorios: 'manage', usuarios: 'manage', modelos_stack: 'manage' },
  material: { dashboard: 'view', estoque: 'operate', ficharios: 'operate', torneios: 'operate', mesas: 'operate', chip_race: 'operate', chat: 'operate', relatorios: 'view', modelos_stack: 'view' },
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
// O token carrega `sv` (session_version). Se não bater com o do usuário no banco, o token está revogado.
// O mesmo registro traz `allowed_tournament_ids` (escopo). Cache curto para não bater no banco a cada request.
const authCache = new Map(); // userId -> { sv, allowed, at }
const SV_TTL = 30_000;

async function loadUserAuth(userId) {
  const hit = authCache.get(userId);
  if (hit && Date.now() - hit.at < SV_TTL) return hit;
  const { User } = require('../models');
  const u = await User.findById(userId).select('session_version allowed_tournament_ids');
  const entry = { sv: u ? (u.session_version || 1) : null, allowed: (u?.allowed_tournament_ids || []).map(String), at: Date.now() };
  authCache.set(userId, entry);
  return entry;
}
const currentSessionVersion = async (userId) => (await loadUserAuth(userId)).sv;

function bumpSessionVersion(userId) {
  authCache.delete(String(userId));
}

/**
 * Torneios que o usuário pode acessar: `null` = todos. Admin sempre acessa todos; para os demais, lista vazia = sem
 * restrição (compatível com quem já existia) e lista preenchida = SOMENTE esses torneios.
 */
async function allowedTournaments(user) {
  if (!user?.id || user.role === 'admin') return null;
  const { allowed } = await loadUserAuth(String(user.id));
  return allowed.length ? allowed : null;
}

/**
 * Restringe `/tournaments/:tid/**` aos torneios permitidos. Roda ANTES da rota (decodifica o token por conta própria;
 * sem token válido deixa passar e o verifyToken da rota responde 401).
 */
const requireTournamentAccess = async (req, res, next) => {
  try {
    const decoded = decodeToken(req.headers['authorization']);
    if (!decoded) return next();
    const allowed = await allowedTournaments(decoded);
    if (!allowed || allowed.includes(String(req.params.tid))) return next();
    return res.status(403).json({ error: 'Você não tem acesso a este torneio.' });
  } catch {
    return res.status(500).json({ error: 'Falha ao validar o acesso ao torneio.' });
  }
};

const verifyToken = async (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Nenhum token fornecido.' });

  const decoded = decodeToken(header);
  if (!decoded) return res.status(401).json({ error: 'Falha ao autenticar token.' });

  // token sem `sv` (emitido antes do P5) é aceito; com `sv` precisa bater
  if (decoded.sv !== undefined && decoded.id) {
    try {
      const sv = await currentSessionVersion(String(decoded.id));
      if (sv === null || sv !== decoded.sv) {
        return res.status(401).json({ error: 'Sessão revogada. Faça login novamente.' });
      }
    } catch {
      return res.status(500).json({ error: 'Falha ao validar a sessão.' });
    }
  }

  req.user = decoded;
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
const MAX_FAILURES = 20;

const keyFor = (req) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const email = String(req.body?.email || '').trim().toLowerCase();
  return `${ip}|${email}`;
};

const loginRateLimiter = (req, res, next) => {
  const entry = loginFailures.get(keyFor(req));
  if (entry && Date.now() - entry.first <= WINDOW_MS && entry.count >= MAX_FAILURES) {
    return res.status(429).json({ error: 'Muitas tentativas de login. Tente novamente em alguns minutos.' });
  }
  next();
};

const registerFailedLogin = (req) => {
  const key = keyFor(req);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) loginFailures.set(key, { count: 1, first: now });
  else entry.count += 1;
};

const clearLoginAttempts = (req) => loginFailures.delete(keyFor(req));

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
  requireTournamentAccess,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  bumpSessionVersion,
  JWT_SECRET,
};
