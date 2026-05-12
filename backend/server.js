const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json());

// Import das Rotas e Modelos
const apiRoutes = require('./routes');
const { User, ChatMessage } = require('./models');
app.use('/api', apiRoutes);

// Conexão com MongoDB e Seeder do Admin
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/genesis';
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB Genesis Database');
    try {
      const adminExists = await User.findOne({ email: 'administrador@admin.com.br' });
      if (!adminExists) {
        await User.create({ name: 'Administrador Geral', email: 'administrador@admin.com.br', password: 'admin123', role: 'admin' });
        console.log('Default Admin user created successfully.');
      }
    } catch (e) {
      console.error('Error seeding admin user:', e);
    }
  })
  .catch(err => console.error('MongoDB connection error:', err));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

// WebSockets
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  onlineUsers.set(socket.id, { connectedAt: new Date() });
  
  // Update everyone about the new connection
  io.emit('onlineCount', onlineUsers.size);
  
  socket.on('getOnlineCount', () => {
    socket.emit('onlineCount', onlineUsers.size);
  });
  
  socket.on('joinChannel', (channel) => {
    socket.join(channel);
    console.log(`User joined channel: ${channel}`);
  });

  socket.on('leaveChannel', (channel) => {
    socket.leave(channel);
  });

  socket.on('sendMessage', async (data) => {
    try {
      const newMessage = new ChatMessage({
        message: data.message,
        sender_name: data.sender_name,
        sender_role: data.sender_role,
        channel: data.channel,
        is_urgent: data.is_urgent
      });
      await newMessage.save();
      io.to(data.channel).emit('newMessage', newMessage);

      if (data.is_urgent) {
        socket.broadcast.emit('urgentNotification', {
          sender_name: data.sender_name,
          message: data.message,
          channel: data.channel
        });
      }
    } catch (e) {
      console.error('Error saving chat message:', e);
    }
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('onlineCount', onlineUsers.size);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend server running on port ${PORT} and accessible on the network`);
});
