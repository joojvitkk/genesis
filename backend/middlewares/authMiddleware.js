const jwt = require('jsonwebtoken');

const accessControl = {
  admin: ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios', 'usuarios', 'modelos_stack'],
  material: ['dashboard', 'estoque', 'ficharios', 'torneios', 'chip_race', 'chat', 'relatorios'],
  salao: ['dashboard', 'torneios', 'chip_race', 'chat', 'modelos_stack', 'estoque']
};

const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).json({ error: 'Nenhum token fornecido.' });

  const tokenStr = token.replace('Bearer ', '');
  jwt.verify(tokenStr, process.env.JWT_SECRET || 'secret_genesis_key', (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Falha ao autenticar token.' });
    req.user = decoded; // { id, username, role }
    next();
  });
};

const requirePageAccess = (page) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Usuário não identificado.' });
    }
    const role = req.user.role;
    if (accessControl[role] && accessControl[role].includes(page)) {
      return next();
    }
    return res.status(403).json({ error: `Acesso negado para a área: ${page}` });
  };
};

module.exports = { verifyToken, requirePageAccess };
