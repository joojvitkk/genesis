require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));

// Import das Rotas e Modelos
const apiRoutes = require('./routes');
const { User, ChatMessage } = require('./models');
const { decodeToken } = require('./middlewares/authMiddleware');
app.use('/api', apiRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Conexão com MongoDB e Seeder do Admin
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/genesis';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'administrador@admin.com.br';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB Genesis Database');
    try {
      const adminExists = await User.findOne({ email: ADMIN_EMAIL });
      if (!adminExists) {
        await User.create({ name: 'Administrador Geral', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin' });
        console.log(`Default admin created: ${ADMIN_EMAIL}`);
      }
    } catch (e) {
      console.error('Error seeding admin user:', e);
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] }
});

app.set('io', io);

// ─── WebSockets ──────────────────────────────────────────────────────────────
// Autenticação obrigatória: o cliente envia o JWT em socket.handshake.auth.token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization;
  const user = decodeToken(token);
  if (!user) return next(new Error('unauthorized'));
  socket.user = user; // { id, name, email, role }
  next();
});

const onlineUsers = new Map(); // socket.id -> userId

function broadcastOnlineCount() {
  const uniqueUsers = new Set(onlineUsers.values());
  io.emit('onlineCount', uniqueUsers.size);
}

io.on('connection', (socket) => {
  onlineUsers.set(socket.id, socket.user.id || socket.id);
  broadcastOnlineCount();

  socket.on('getOnlineCount', () => {
    const uniqueUsers = new Set(onlineUsers.values());
    socket.emit('onlineCount', uniqueUsers.size);
  });

  socket.on('joinChannel', (channel) => {
    if (['general', 'material', 'salao'].includes(channel)) socket.join(channel);
  });

  socket.on('leaveChannel', (channel) => socket.leave(channel));

  socket.on('sendMessage', async (data = {}) => {
    try {
      const channel = ['general', 'material', 'salao'].includes(data.channel) ? data.channel : 'general';
      const message = String(data.message || '').trim().slice(0, 2000);
      if (!message) return;

      const newMessage = new ChatMessage({
        message,
        // identidade derivada do token — o cliente não pode forjar
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
      console.error('Error saving chat message:', e);
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    broadcastOnlineCount();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT} and accessible on the network`);
});
