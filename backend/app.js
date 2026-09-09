const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const logger = require('./lib/logger');
const rateLimit = require('./lib/rateLimit');

const apiRoutes = require('./routes');

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = express();
app.set('trust proxy', 1); // atrás do nginx — para req.ip correto

// API só devolve JSON; CSP não se aplica. Mantém HSTS, noSniff, frameguard etc.
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(rateLimit({ windowMs: 60_000, max: Number(process.env.RATE_LIMIT_MAX) || 300 }));

app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/health' },
  // log enxuto: método, rota, status, duração — sem despejar req/res inteiros
  serializers: {
    req: (req) => ({ method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} ${res.statusCode} — ${err.message}`,
}));
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

// io real é injetado pelo server.js; este no-op mantém as rotas funcionando em testes
const noopEmitter = { emit() {}, to() { return noopEmitter; } };
app.set('io', noopEmitter);

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

app.use('/api', apiRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// Handler de erro central
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  req.log?.error({ err }, 'unhandled error');
  res.status(err.status || 500).json({ error: err.expose ? err.message : 'Erro interno do servidor.' });
});

module.exports = app;
