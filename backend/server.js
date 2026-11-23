require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = require('./app');
const logger = require('./lib/logger');
const CHANNELS = ['general', 'material', 'salao'];
const { User, ChatMessage, Tournament, TournamentSession, Event } = require('./models');
const sessionsLib = require('./lib/sessions');
const { publicMessage } = require('./lib/chat');
const { authenticate, allowedTournaments } = require('./middlewares/authMiddleware');
const logActivity = require('./services/activityLogger');
const { autoAdvance, clockPayload, levelNumber } = require('./lib/tournamentClock');
const levelLog = require('./lib/levelLog');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/genesis';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const PORT = process.env.PORT || 3000;
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'administrador@admin.com.br').toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

async function seedAdmin() {
  const exists = await User.findOne({ email: ADMIN_EMAIL });
  if (exists) return;
  await User.create({ name: 'Administrador Geral', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
  logger.info({ email: ADMIN_EMAIL }, 'default admin created');
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] } });
app.set('io', io);
// G10: cada lote de movimentos gravado avisa o painel (fino: fichas/fichários/torneios afetados)
require('./lib/movements').setNotifier((payload) => io.emit('movementsPosted', payload));

// ─── WebSockets ──────────────────────────────────────────────────────────────
const socketToken = (socket) => socket.handshake.auth?.token || socket.handshake.headers?.authorization;
// Valida contra o banco (sessão não revogada, papel e escopo atuais). Rotas que revogam sessões chamam
// `io.in('user:<id>').disconnectSockets(true)`; os eventos sensíveis abaixo revalidam mesmo assim.
io.use(async (socket, next) => {
  try {
    const user = await authenticate(socketToken(socket));
    if (!user) return next(new Error('unauthorized'));
    socket.user = user;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
/** Revalida o usuário do socket antes de uma ação sensível; derruba a conexão se a sessão caiu. */
async function freshUser(socket) {
  const user = await authenticate(socketToken(socket)).catch(() => null);
  if (!user) { socket.disconnect(true); return null; }
  socket.user = user;
  return user;
}

const onlineUsers = new Map(); // socket.id -> userId

function broadcastOnlineCount() {
  io.emit('onlineCount', new Set(onlineUsers.values()).size);
}

io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`);
  onlineUsers.set(socket.id, socket.user.id || socket.id);
  broadcastOnlineCount();

  // limite de mensagens: 10 a cada 10s por conexão
  let msgTimes = [];
  const overMessageLimit = () => {
    const now = Date.now();
    msgTimes = msgTimes.filter((t) => now - t < 10_000);
    msgTimes.push(now);
    return msgTimes.length > 10;
  };

  socket.on('getOnlineCount', () => socket.emit('onlineCount', new Set(onlineUsers.values()).size));
  // Chat por evento e canal: cada par é uma sala `chat:<evento>:<canal>`
  socket.on('joinEvent', (id) => {
    if (mongoose.isValidObjectId(id)) CHANNELS.forEach((c) => socket.join(`chat:${id}:${c}`));
  });
  socket.on('leaveEvent', (id) => CHANNELS.forEach((c) => socket.leave(`chat:${id}:${c}`)));

  // Relógio do torneio: cliente entra na sala e recebe o estado atual na hora
  socket.on('joinTournament', async (id) => {
    if (!mongoose.isValidObjectId(id)) return;
    try {
      const user = await freshUser(socket);
      if (!user) return;
      const allowed = await allowedTournaments(user);
      if (allowed && !allowed.includes(String(id))) return; // operador restrito não escuta o relógio de outro torneio
      socket.join(`tournament:${id}`);
      const t = await Tournament.findById(id);
      if (!t) return;
      // um relógio por sessão: quem entra recebe o estado atual de cada uma (parados/pausados não recebem pulso)
      const sessions = await sessionsLib.listSessions(t._id);
      if (sessions.length) sessions.forEach((x) => socket.emit('tournamentClock', clockPayload(sessionsLib.clockView(t, x))));
      else socket.emit('tournamentClock', clockPayload(t));
    } catch (e) {
      logger.error({ err: e }, 'joinTournament failed');
    }
  });
  socket.on('leaveTournament', (id) => socket.leave(`tournament:${id}`));

  socket.on('sendMessage', async (data = {}) => {
    try {
      if (!(await freshUser(socket))) return;
      if (overMessageLimit()) {
        socket.emit('chatError', 'Muitas mensagens. Aguarde um momento.');
        return;
      }
      if (!mongoose.isValidObjectId(data.event_id) || !(await Event.exists({ _id: data.event_id }))) {
        socket.emit('chatError', 'Escolha um evento válido para conversar.');
        return;
      }
      const event_id = String(data.event_id);
      const channel = CHANNELS.includes(data.channel) ? data.channel : 'general';
      const message = String(data.message || '').trim().slice(0, 2000);

      // anexo de imagem: só data URL de imagem, no máx ~280KB
      let image;
      if (typeof data.image === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(data.image)) {
        if (data.image.length <= 380_000) image = data.image;
        else { socket.emit('chatError', 'Imagem muito grande (máx ~280KB).'); return; }
      }
      if (!message && !image) return;

      // resposta: a mensagem original precisa ser do mesmo evento e canal
      let reply = {};
      if (data.reply_to) {
        const orig = mongoose.isValidObjectId(data.reply_to) && await ChatMessage.findOne({ _id: data.reply_to, event_id, channel });
        if (orig) {
          reply = {
            reply_to: orig._id,
            reply_preview: { sender_name: orig.sender_name, message: (orig.message || '').slice(0, 120), has_image: !!orig.image },
          };
        }
      }

      const newMessage = new ChatMessage({
        ...reply,
        message,
        image,
        sender_name: socket.user.name,
        sender_email: socket.user.email,
        sender_role: socket.user.role,
        event_id,
        channel,
        is_urgent: !!data.is_urgent,
      });
      await newMessage.save();
      io.to(`chat:${event_id}:${channel}`).emit('newMessage', publicMessage(newMessage, null));

      if (newMessage.is_urgent) {
        socket.broadcast.emit('urgentNotification', {
          _id: String(newMessage._id),
          sender_name: newMessage.sender_name,
          message: newMessage.message || '(imagem)',
          event_id,
          channel,
        });
      }
    } catch (e) {
      logger.error({ err: e }, 'error saving chat message');
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineCount();
  });
});

// ─── Runner do relógio ───────────────────────────────────────────────────────
// A cada segundo: para cada torneio rodando, avança o nível se o tempo estourou
// e transmite o estado do relógio para quem estiver assistindo aquele torneio.
let clockTimer = null;
let tickCount = 0;
function startClockRunner() {
  if (clockTimer) return;
  clockTimer = setInterval(async () => {
    try {
      const now = Date.now();
      tickCount += 1;
      // Cada SESSÃO roda o seu próprio relógio; torneios sem sessões (dados antigos) ainda rodam no torneio.
      const sessions = await TournamentSession.find({ clock_status: 'running' });
      const tournaments = new Map();
      const tournamentOf = async (id) => {
        const k = String(id);
        if (!tournaments.has(k)) tournaments.set(k, await Tournament.findById(id));
        return tournaments.get(k);
      };
      const tick = async (owner, t, session) => {
        const view = sessionsLib.clockView(t, session);
        const room = `tournament:${t._id}`;
        const sid = session ? String(session._id) : null;
        const adv = autoAdvance(view, now);
        if (adv) {
          Object.assign(owner, adv.updates);
          await owner.save();
          for (const ev of adv.events) {
            if (ev.type === 'level') io.to(room).emit('tournamentLevelChanged', { tournament_id: String(t._id), session_id: sid, level: ev.level });
            else if (ev.type === 'marker') io.to(room).emit('tournamentMarker', { tournament_id: String(t._id), session_id: sid, row_type: ev.row_type, label: ev.label });
            else if (ev.type === 'ended') io.to(room).emit('tournamentEnded', { tournament_id: String(t._id), session_id: sid });
          }
          if (session && owner.clock_status !== 'running') await sessionsLib.syncTournamentCache(t._id);
          if (session) await levelLog.onAutoAdvance(session._id, io);
          logActivity('Nível do Torneio Avançou', 'tournament', `${t.name}${session ? ` · ${session.name}` : ''} | nível ${(() => { const n = levelNumber(view.blind_structure || [], owner.current_level); return n === null ? '-' : n + (view.level_offset || 0); })()} (linha ${owner.current_level + 1})`, { name: 'Relógio' });
        }
        io.to(room).emit('tournamentClock', clockPayload(sessionsLib.clockView(t, session), now));
        // repara (a cada ~15 s) o registro por nível de uma sessão rodando sem ele — falha anterior não trava nem esconde o nível
        if (session && tickCount % 15 === 0) await levelLog.reconcile(session._id, io);
      };
      for (const session of sessions) {
        const t = await tournamentOf(session.tournament_id);
        if (t) await tick(session, t, session);
      }
      const hasSessions = new Set((await TournamentSession.distinct('tournament_id')).map(String));
      for (const t of await Tournament.find({ clock_status: 'running' })) {
        if (!hasSessions.has(String(t._id))) await tick(t, t, null);
      }
    } catch (e) {
      logger.error({ err: e }, 'clock runner tick failed');
    }
  }, 1000);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
async function start() {
  await mongoose.connect(MONGO_URI);
  logger.info('connected to MongoDB');
  // avisa (uma vez) se o Mongo não é replica set: movimentações de estoque perdem a transação
  require('./lib/movements').supportsTransactions().catch(() => {});
  try {
    await seedAdmin();
  } catch (e) {
    logger.error({ err: e }, 'error seeding admin user');
  }
  startClockRunner();
  server.listen(PORT, '0.0.0.0', () => logger.info(`backend listening on ${PORT}`));
}

start().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});

module.exports = { server, io };
