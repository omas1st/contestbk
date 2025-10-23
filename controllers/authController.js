// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { sendAdminEmail } = require('../utils/mailer');
const paymentController = require('./paymentController'); // new controller

// helper to normalise username input
function normalizeUsername(u) {
  if (!u) return '';
  return String(u).trim().toLowerCase();
}

// helper for country checks
function isUSA(country) {
  if (!country) return false;
  const c = String(country).toLowerCase();
  return c === 'united states' || c === 'united states of america' || c === 'usa' || c === 'us';
}
function isCanada(country) {
  if (!country) return false;
  return String(country).toLowerCase().includes('canada');
}

// Register
async function register(req, res) {
  try {
    const { firstName, lastName, country, email, phone, username, password } = req.body;
    if (!firstName || !lastName || !country || !email || !username || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    const normalizedUsername = normalizeUsername(username);

    const existing = await User.findOne({ username: normalizedUsername });
    if (existing) return res.status(400).json({ message: 'Username already taken' });

    // basic strength check
    const pwScore = (password.length >= 8) + /[A-Z]/.test(password) + /[0-9]/.test(password) + /[^A-Za-z0-9]/.test(password);
    if (pwScore < 3) return res.status(400).json({ message: 'Password not strong enough' });

    const hashed = await bcrypt.hash(password, 10);

    // determine role: compare normalized username to normalized ADMIN_USERNAME
    const envAdminUsername = process.env.ADMIN_USERNAME ? String(process.env.ADMIN_USERNAME).trim().toLowerCase() : null;
    const role = (envAdminUsername && normalizedUsername === envAdminUsername) ? 'admin' : 'user';

    // store normalized username and normalized email (pre-save hook also ensures this)
    const user = new User({
      firstName,
      lastName,
      country,
      email: String(email).trim().toLowerCase(),
      phone,
      username: normalizedUsername,
      password: hashed,
      role
    });
    await user.save();

    sendAdminEmail('New registration', `User ${normalizedUsername} registered (${email})`);

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.secret_key, { expiresIn: '7d' });

    res.json({ message: 'Registered', token, role: user.role });
  } catch (err) {
    console.error(err);
    if (err && err.code === 11000) {
      const dupField = err.keyValue ? Object.keys(err.keyValue)[0] : 'field';
      return res.status(400).json({ message: `${dupField} already in use` });
    }
    res.status(500).json({ message: 'Server error' });
  }
}

// Login
async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Missing credentials' });

    const normalizedUsername = normalizeUsername(username);

    // allow direct ENV admin login - normalise env username for comparison
    const envAdminUsername = process.env.ADMIN_USERNAME ? String(process.env.ADMIN_USERNAME).trim().toLowerCase() : null;
    const envAdminPassword = process.env.ADMIN_PASSWORD;

    if (envAdminUsername && normalizedUsername === envAdminUsername && password === envAdminPassword) {
      const token = jwt.sign({ admin: true, role: 'admin' }, process.env.secret_key, { expiresIn: '7d' });
      return res.json({ message: 'Admin login', token, role: 'admin' });
    }

    const user = await User.findOne({ username: normalizedUsername });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.secret_key, { expiresIn: '7d' });

    sendAdminEmail('User logged in', `User ${normalizedUsername} logged in`);

    res.json({ message: 'Logged in', token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Dashboard for user
async function dashboard(req, res) {
  try {
    if (req.user.role === 'admin') return res.status(403).json({ message: 'Admins use admin panel' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // expire timer if needed
    if (user.timerActive && user.timerEnds && user.timerEnds <= Date.now()) {
      user.balance = 0;
      user.timerActive = false;
      user.timerEnds = null;
      await user.save();
    }

    res.json({
      username: user.username,
      balance: user.balance,
      timerActive: user.timerActive,
      timerEnds: user.timerEnds,
      notifications: user.notifications,
      country: user.country || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Send message to admin (user)
async function sendMessage(req, res) {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Message required' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const msg = { text, createdAt: new Date() };
    user.messages.push(msg);
    await user.save();

    sendAdminEmail('New user message', `From ${user.username}: ${text}`);

    res.json({ message: 'Message sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

// Forward activation payment to paymentController
const submitActivationPayment = (req, res) => paymentController.submitActivationPayment(req, res);

/**
 * Create withdrawal preview (auth route)
 * Validates method/details according to user's country:
 * - United States: allow 'bank' (USA fields) and 'crypto'
 * - Canada: allow 'bank' (Canada fields) and 'crypto'
 * - Other: only 'crypto'
 */
async function withdrawRequest(req, res) {
  try {
    const { method, details } = req.body; // details is method-specific
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.balance < 1) return res.status(400).json({ message: 'Balance must be at least $1 to withdraw' });
    if (!user.timerActive) return res.status(400).json({ message: 'Withdrawals are disabled while timer inactive' });

    const country = user.country || '';

    // Enforce allowed withdrawal types by country
    if (!isUSA(country) && !isCanada(country)) {
      // other countries: only crypto allowed
      if (method !== 'crypto') {
        return res.status(400).json({ message: 'Only cryptocurrency withdrawals are available for your country.' });
      }
    }

    // Validate details shape depending on method and country
    if (method === 'crypto') {
      if (!details || !details.crypto || !details.walletAddress) {
        return res.status(400).json({ message: 'Crypto type and wallet address are required for cryptocurrency withdrawals.' });
      }
    } else if (method === 'bank') {
      // require bank details appropriate to country
      if (isUSA(country)) {
        const {
          bankName, bankAddress, routingNumber, beneficiaryName, accountNumber, accountType, beneficiaryAddress
        } = details || {};
        if (!bankName || !bankAddress || !routingNumber || !beneficiaryName || !accountNumber || !accountType || !beneficiaryAddress) {
          return res.status(400).json({ message: 'Missing required USA bank transfer fields.' });
        }
        if (!/^\d{9}$/.test(String(routingNumber))) {
          return res.status(400).json({ message: 'Routing Number must be 9 digits.' });
        }
        if (!['checking', 'savings'].includes(String(accountType).toLowerCase())) {
          return res.status(400).json({ message: 'Account type must be checking or savings.' });
        }
      } else if (isCanada(country)) {
        const { transitNumber, institutionNumber, accountNumber, beneficiaryName } = details || {};
        if (!transitNumber || !institutionNumber || !accountNumber || !beneficiaryName) {
          return res.status(400).json({ message: 'Missing required Canada bank transfer fields.' });
        }
        if (!/^\d{5}$/.test(String(transitNumber))) {
          return res.status(400).json({ message: 'Transit Number must be 5 digits.' });
        }
        if (!/^\d{3}$/.test(String(institutionNumber))) {
          return res.status(400).json({ message: 'Institution Number must be 3 digits.' });
        }
      } else {
        return res.status(400).json({ message: 'Bank transfers not supported for your country.' });
      }
    } else if (method === 'stripe') {
      // stripe was present in frontend earlier — ensure minimal validation
      if (!details || !details.email) return res.status(400).json({ message: 'Email required for Stripe withdrawals.' });
    } else {
      return res.status(400).json({ message: 'Invalid withdrawal method.' });
    }

    // Check latest withdrawal for this user; if it's in-progress, return that instead of creating a new one
    const latest = await Withdrawal.findOne({ user: user._id }).sort({ createdAt: -1 });
    if (latest && !['approved', 'rejected'].includes(latest.status) && latest.stage !== 'access') {
      return res.json({
        message: 'Existing withdrawal in progress',
        withdrawalId: latest._id,
        preview: { amount: latest.amount, method: latest.method, details: latest.details },
        stage: latest.stage,
        status: latest.status
      });
    }

    // set initial stage to 'activation' so the withdrawal follows the multi-stage activation flow
    const withdrawal = new Withdrawal({ user: user._id, amount: user.balance, method, details, status: 'preview', stage: 'activation' });
    await withdrawal.save();

    sendAdminEmail('User initiated withdrawal', `User ${user.username} initiated a withdrawal preview.`);

    res.json({ message: 'Preview created', withdrawalId: withdrawal._id, preview: { amount: withdrawal.amount, method: withdrawal.method, details: withdrawal.details } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * Proceed withdrawal (mark pending activation)
 *
 * Behavior improvements:
 * - If there's an existing different in-progress withdrawal for the user, return that so the frontend can resume.
 * - Otherwise mark the target withdrawal as pending_activation and return the withdrawal id & stage (and amount if next stage is tax).
 */
async function withdrawProceed(req, res) {
  try {
    const { id } = req.params; // withdrawal id provided by client
    const userId = req.user.id;

    // find the user's latest withdrawal (if any)
    const latest = await Withdrawal.findOne({ user: userId }).sort({ createdAt: -1 });

    // If latest exists and it's not finished, and it differs from the requested id, return it so client can resume
    if (latest && String(latest._id) !== String(id) && !['approved', 'rejected'].includes(latest.status) && latest.stage !== 'access') {
      // compute potential amount for next stage if needed (e.g., tax = 1% of user's balance)
      const user = await User.findById(userId);
      let amount = 0;
      if (latest.stage === 'tax') {
        amount = Math.round((Number(user.balance || 0) * 0.01) * 100) / 100;
      }
      return res.json({
        message: 'Existing withdrawal in progress',
        withdrawalId: latest._id,
        stage: latest.stage,
        status: latest.status,
        amount
      });
    }

    // otherwise operate on the requested withdrawal id
    const withdrawal = await Withdrawal.findById(id);
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    if (String(withdrawal.user) !== String(userId)) return res.status(403).json({ message: 'Forbidden' });

    withdrawal.status = 'pending_activation';
    await withdrawal.save();

    // compute amount if next stage is tax (we'll compute based on the user's current balance)
    const user = await User.findById(userId);
    let amount = 0;
    // if the current stage on withdrawal already moved (may be activation), leave amount 0.
    if (withdrawal.stage === 'tax') {
      amount = Math.round((Number(user.balance || 0) * 0.01) * 100) / 100;
    }

    sendAdminEmail('User proceeded withdrawal', `User ${req.user.id} proceeded withdrawal ${id}`);

    res.json({
      message: 'Proceed recorded',
      withdrawalId: withdrawal._id,
      stage: withdrawal.stage,
      status: withdrawal.status,
      amount
    });
  } catch (err) {
    console.error('withdrawProceed err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/* Exported module (only functions needed by routes are exported) */
module.exports = {
  register,
  login,
  dashboard,
  sendMessage,
  submitActivationPayment,
  withdrawRequest,
  withdrawProceed
};
