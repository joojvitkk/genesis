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

const verifyToken = (req, res, next) => {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'Nenhum token fornecido.' });

  const decoded = decodeToken(header);
  if (!decoded) return res.status(401).json({ error: 'Falha ao autenticar token.' });

  req.user = decoded; // { id, name, email, role }
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

// Rate limiter simples em memória para o /login (sem dependência externa).
// Conta apenas TENTATIVAS FALHAS — login correto ou retry bem-sucedido não gastam a cota.
const loginFailures = new Map(); // key -> { count, first }
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

const clearLoginAttempts = (req) => {
  loginFailures.delete(keyFor(req));
};

module.exports = {
  verifyToken,
  requirePageAccess,
  decodeToken,
  accessControl,
  loginRateLimiter,
  registerFailedLogin,
  clearLoginAttempts,
  JWT_SECRET,
};
