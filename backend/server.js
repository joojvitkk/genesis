require('dotenv').config();

const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const app = require('./app');
const logger = require('./lib/logger');
const { User, ChatMessage, Tournament } = require('./models');
const { decodeToken } = require('./middlewares/authMiddleware');
const logActivity = require('./services/activityLogger');
const { autoAdvance, clockPayload } = require('./lib/tournamentClock');

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

// ─── WebSockets ──────────────────────────────────────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
  const user = decodeToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user;
  next();
});

const CHANNELS = ['general', 'material', 'salao'];
const onlineUsers = new Map(); // socket.id -> userId

function broadcastOnlineCount() {
  io.emit('onlineCount', new Set(onlineUsers.values()).size);
}

io.on('connection', (socket) => {
  onlineUsers.set(socket.id, socket.user.id || socket.id);
  broadcastOnlineCount();

  socket.on('getOnlineCount', () => socket.emit('onlineCount', new Set(onlineUsers.values()).size));
  socket.on('joinChannel', (channel) => { if (CHANNELS.includes(channel)) socket.join(channel); });
  socket.on('leaveChannel', (channel) => socket.leave(channel));

  // Relógio do torneio: cliente entra na sala e recebe o estado atual na hora
  socket.on('joinTournament', async (id) => {
    if (!mongoose.isValidObjectId(id)) return;
    socket.join(`tournament:${id}`);
    try {
      const t = await Tournament.findById(id);
      if (t) socket.emit('tournamentClock', clockPayload(t));
    } catch (e) {
      logger.error({ err: e }, 'joinTournament failed');
    }
  });
  socket.on('leaveTournament', (id) => socket.leave(`tournament:${id}`));

  socket.on('sendMessage', async (data = {}) => {
    try {
      const channel = CHANNELS.includes(data.channel) ? data.channel : 'general';
      const message = String(data.message || '').trim().slice(0, 2000);
      if (!message) return;

      const newMessage = new ChatMessage({
        message,
        sender_name: socket.user.name,
        sender_email: socket.user.email,
        sender_role: socket.user.role,
        channel,
        is_urgent: !!data.is_urgent,
      });
      await newMessage.save();
      io.to(channel).emit('newMessage', newMessage);

      if (newMessage.is_urgent) {
        socket.broadcast.emit('urgentNotification', {
          sender_name: newMessage.sender_name,
          message: newMessage.message,
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
function startClockRunner() {
  if (clockTimer) return;
  clockTimer = setInterval(async () => {
    try {
      const running = await Tournament.find({ clock_status: 'running' });
      const now = Date.now();
      for (const t of running) {
        const adv = autoAdvance(t, now);
        if (adv) {
          Object.assign(t, adv.updates);
          await t.save();
          for (const ev of adv.events) {
            if (ev.type === 'level') {
              io.to(`tournament:${t._id}`).emit('tournamentLevelChanged', { tournament_id: String(t._id), level: ev.level });
            } else if (ev.type === 'marker') {
              io.to(`tournament:${t._id}`).emit('tournamentMarker', { tournament_id: String(t._id), row_type: ev.row_type, label: ev.label });
            } else if (ev.type === 'ended') {
              io.to(`tournament:${t._id}`).emit('tournamentEnded', { tournament_id: String(t._id) });
            }
          }
          logActivity('Nível do Torneio Avançou', 'tournament', `${t.name} | nível ${t.current_level}`, { name: 'Relógio' });
        }
        io.to(`tournament:${t._id}`).emit('tournamentClock', clockPayload(t, now));
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
