// tests/auth.test.js
/**
 * Requires dev dependencies:
 *  - jest
 *  - supertest
 *  - mongodb-memory-server
 *
 * Run: NODE_ENV=test npm test
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
let app;
let mongod;
const User = require('../models/User');

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGO_URI = uri; // ensure server uses the memory server
  process.env.NODE_ENV = 'test';
  app = require('../server'); // server exports app

  // wait for mongoose connect
  await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
});

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

afterEach(async () => {
  // clean db between tests
  await User.deleteMany({});
});

test('Register -> login flow', async () => {
  const userData = {
    firstName: 'Test',
    lastName: 'User',
    country: 'Testland',
    email: 'test@example.com',
    phone: '123',
    username: 'testuser1',
    password: 'StrongP@ss1'
  };

  // Register
  const reg = await request(app).post('/api/auth/register').send(userData);
  expect(reg.status).toBe(200);
  expect(reg.body).toHaveProperty('token');

  // Login (correct)
  const login = await request(app).post('/api/auth/login').send({ username: userData.username, password: userData.password });
  expect(login.status).toBe(200);
  expect(login.body).toHaveProperty('token');

  // Login (wrong password)
  const badLogin = await request(app).post('/api/auth/login').send({ username: userData.username, password: 'wrongpass' });
  expect(badLogin.status).toBe(400);
  expect(badLogin.body.message).toMatch(/Invalid credentials/i);
});
