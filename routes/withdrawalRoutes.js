const express = require('express');
const withdrawCtrl = require('../controllers/withdrawalController');
const { authenticate } = require('../middleware/auth');

/**
 * Export function so server.js can pass upload instance (for file uploads)
 * usage: app.use('/api/withdraw', withdrawalRoutes(upload));
 */
module.exports = (upload) => {
  const router = express.Router();

  // create preview
  router.post('/preview', authenticate, withdrawCtrl.createPreview);

  // proceed (mark pending_activation)
  router.post('/:id/proceed', authenticate, withdrawCtrl.proceedWithdraw);

  // submit activation / stage payment (multipart) - use the upload instance from server.js
  router.post('/submit', authenticate, upload.any(), withdrawCtrl.submitStagePayment);

  // convenience for activation
  router.post('/:id/activate', authenticate, upload.any(), withdrawCtrl.submitActivation);

  // confirm pin for stage
  router.post('/confirm-pin', authenticate, withdrawCtrl.confirmStagePin);

  // admin approve withdrawal (keeps existing admin route)
  router.post('/:id/admin-approve', authenticate, withdrawCtrl.adminApprove);

  return router;
};