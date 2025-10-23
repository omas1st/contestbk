// middleware/auth.js
const jwt = require('jsonwebtoken');

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token provided' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.secret_key);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

const adminAuth = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ message: 'No token provided' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.secret_key);
    // allow JWT with role: 'admin' or a special 'admin' field (server issues this for ENV admin)
    if (payload.role === 'admin' || payload.admin) {
      req.admin = true;
      req.user = payload;
      next();
    } else {
      return res.status(403).json({ message: 'Admin only' });
    }
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

module.exports = { authenticate, adminAuth };
