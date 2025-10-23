// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const { adminAuth } = require('../middleware/auth');
const adminController = require('../controllers/adminController');

const { notifyValidator, approveValidator } = require('../middleware/validators');

// All admin routes require adminAuth
router.use(adminAuth);

// Users list & edit
router.get('/users', adminController.getUsers);
router.put('/users/:id', adminController.editUser);

// NEW: Delete a user (admin only) - removes user and related withdrawals
router.delete('/users/:id', adminController.deleteUser);

// NEW: Set pin for a specific user & stage (activation, tax, insurance, verification, security)
router.post('/users/:userId/set-pin', adminController.setPinForUser);

// Messages
router.get('/messages', adminController.getMessages);

// Notifications -> send to user (with validation)
router.post('/notify', notifyValidator, adminController.notifyUser);

// Payments (giftcards etc)
router.get('/payments', adminController.getPayments);

// Approvals (tax/insurance) with validation
router.post('/approve/:userId', approveValidator, adminController.approveUser);

// Withdrawals
router.get('/withdrawals', adminController.getWithdrawals);
router.post('/withdrawals/:id/approve', adminController.approveWithdrawal);

module.exports = router;
