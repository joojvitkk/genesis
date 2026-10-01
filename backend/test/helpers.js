process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_genesis';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const TEST_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/genesis_test';

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 20000,
      maxPoolSize: 5,
    });
    // o banco de teste é persistente: descarta índices antigos (ex.: Seat sem sessão, pré-G4) e cria os atuais
    await require('../models').Seat.syncIndexes();
  }
}

async function clearDb() {
  const cols = await mongoose.connection.db.collections();
  await Promise.all(cols.map((c) => c.deleteMany({})));
}

async function disconnect() {
  await mongoose.disconnect();
}

function tokenFor(user) {
  return jwt.sign(
    { id: user._id, name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function makeUser(role = 'admin', overrides = {}) {
  const { User } = require('../models');
  const user = await User.create({
    name: `Test ${role}`,
    email: overrides.email || `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
    password: overrides.password || 'secret1',
    role,
    ...overrides,
  });
  return { user, token: tokenFor(user) };
}

/** Cria uma ficha (cadastro mestre, sem quantidade). */
async function makeChip({ value = 25, color = '#ff0000' } = {}) {
  const { Chip } = require('../models');
  return new Chip({ value, color }).save();
}

/**
 * Cria um fichário físico e o MONTA (ASSEMBLY externo → fichário) com `content`:
 * [{ chip, quantity }]. O estoque físico só existe por movimentação.
 */
async function makeBinder(name = 'Maleta', content = [], extra = {}) {
  const { Binder } = require('../models');
  const { postBatch } = require('../lib/movements');
  const binder = await new Binder({ name, ...extra }).save();
  if (content.length) {
    await postBatch(content.map(({ chip, quantity }) => ({
      type: 'ASSEMBLY', chip_id: chip._id, quantity, reason: 'Montagem inicial',
      from: { kind: 'external' }, to: { kind: 'binder', id: binder._id },
    })), { user: { name: 'Teste' } });
  }
  return Binder.findById(binder._id);
}

module.exports = { connect, clearDb, disconnect, tokenFor, makeUser, makeChip, makeBinder, TEST_URI };
