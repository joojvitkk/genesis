process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_genesis';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const TEST_URI = process.env.MONGO_URI_TEST || 'mongodb://127.0.0.1:27017/genesis_test';

async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 5000 });
  }
}

async function clearDb() {
  await mongoose.connection.dropDatabase();
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

module.exports = { connect, clearDb, disconnect, tokenFor, makeUser, TEST_URI };
