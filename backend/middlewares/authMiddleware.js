const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'secret_genesis_key';

// Matriz única de permissões — mantida em sincronia com frontend/src/config.js
const accessControl = {
  admin:    ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios', 'usuarios', 'modelos_stack'],
  material: ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios', 'modelos_stack'],
  salao:    ['dashboard', 'estoque', 'torneios', 'chip_race', 'chat', 'modelos_stack'],
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

// ─── Revogação de sessão (P5) ────────────────────────────────────────────────
// O token carrega `sv` (session_version). Se não bater com o do usuário no banco,
// o token está revogado. Cache curto para não bater no banco a cada request.
const svCache = new Map(); // userId -> { sv, at }
const SV_TTL = 30_000;

async function currentSessionVersion(userId) {
  const hit = svCache.get(userId);
  if (hit && Date.now() - hit.at < SV_TTL) return hit.sv;
  const { User } = require('../models');
  const u = await User.findById(userId).select('session_version');
  const sv = u ? (u.session_version || 1) : null;
  svCache.set(userId, { sv, at: Date.now() });
  return sv;
}

function bumpSessionVersion(userId) {
  svCache.delete(String(userId));
}

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

const requirePageAccess = (page) => (req, res, next) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ error: 'Usuário não identificado.' });
  }
  const allowed = accessControl[req.user.role] || [];
  if (allowed.includes(page)) return next();
  return res.status(403).json({ error: `Acesso negado para a área: ${page}` });
};

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
  decodeToken,
  accessControl,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  bumpSessionVersion,
  JWT_SECRET,
};
