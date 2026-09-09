// Rate limiter geral em memória (janela deslizante simples, sem dependência).
// Suficiente para uma única instância; atrás de vários workers use um store compartilhado.

function rateLimit({ windowMs = 60_000, max = 300, message = 'Muitas requisições. Aguarde um momento.' } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT) {
    return (req, res, next) => next();
  }
  const hits = new Map(); // ip -> number[] (timestamps)

  // limpeza periódica
  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, times] of hits) {
      const kept = times.filter((t) => t > cutoff);
      if (kept.length) hits.set(ip, kept);
      else hits.delete(ip);
    }
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const times = (hits.get(ip) || []).filter((t) => t > cutoff);
    times.push(now);
    hits.set(ip, times);
    if (times.length > max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = rateLimit;
