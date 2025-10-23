// This file exports a function so we can inject the multer upload middleware from server.js
const express = require('express');
const { authenticate } = require('../middleware/auth');
const authController = require('../controllers/authController');
const withdrawalController = require('../controllers/withdrawalController');
const multer = require('multer');
const path = require('path');

const {
  registerValidator,
  loginValidator,
  activatePaymentValidator,
  withdrawRequestValidator,
  confirmPinValidator
} = require('../middleware/validators');

/**
 * export function so server.js can pass upload instance (for file uploads)
 * usage: app.use('/api/auth', authRoutes(upload));
 */
module.exports = (upload) => {
  const r = express.Router();

  // public
  r.post('/register', registerValidator, authController.register);
  r.post('/login', loginValidator, authController.login);

  // authenticated user routes
  r.get('/dashboard', authenticate, authController.dashboard);
  r.post('/message', authenticate, authController.sendMessage);

  // activation payment submission — may include file (giftcard image)
  // NOTE: switched to upload.any() so frontend can send multiple files (cards[][...] fields)
  // existing single-file clients (giftImage) will still work.
  r.post('/activate-payment',
    authenticate,
    upload.any(),
    activatePaymentValidator,
    authController.submitActivationPayment // forwarded to paymentController inside authController
  );

  // confirm 4-digit pin for an activation/payment stage
  r.post('/confirm-pin',
    authenticate,
    confirmPinValidator,
    withdrawalController.confirmStagePin
  );

  // withdraw flow
  r.post('/withdraw-request', authenticate, withdrawRequestValidator, authController.withdrawRequest);
  r.post('/withdraw-proceed/:id', authenticate, authController.withdrawProceed);

  return r;
};