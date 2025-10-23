// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const fs = require('fs');

const app = express();

/* -------------------------
   Body parser (early)
   ------------------------- */
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

/* -------------------------
   Security middlewares
   ------------------------- */
app.use(helmet());

/* -------------------------
   Logging
   ------------------------- */
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

/* -------------------------
   CORS
   ------------------------- */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',');
app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps, curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('CORS policy: This origin is not allowed'));
      }
    },
    credentials: true,
  })
);

/* -------------------------
   Rate limiting
   ------------------------- */
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX || '80', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

/* -------------------------
   Uploads (static + multer) - CHANGED TO MEMORY STORAGE FOR CLOUDINARY
   ------------------------- */
// REMOVED: Directory creation since we're using memory storage + Cloudinary
// Vercel has read-only filesystem, so we cannot create directories

// CHANGED: Use memory storage for Cloudinary uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

/* -------------------------
   Safe in-place sanitizers
   ------------------------- */

/**
 * Remove keys that are Mongo operators or contain '.' from an object in-place.
 * This prevents NoSQL operator injection like { "$gt": "" } or nested keys like "a.b".
 * It mutates the passed object (does NOT reassign req.query or other references).
 */
function removeMongoOperatorKeysInPlace(obj) {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    // sanitize each element in array
    obj.forEach((el) => {
      if (typeof el === 'object' && el !== null) removeMongoOperatorKeysInPlace(el);
    });
    return;
  }

  Object.keys(obj).forEach((key) => {
    // If key is a Mongo operator or contains a dot, delete it
    if (key.startsWith('$') || key.indexOf('.') !== -1) {
      try {
        delete obj[key];
      } catch (e) {
        // If deletion fails for some reason, set to undefined as a fallback
        try { obj[key] = undefined; } catch (e2) { /* ignore */ }
      }
      return;
    }

    // Recurse into nested objects/arrays
    const val = obj[key];
    if (typeof val === 'object' && val !== null) {
      removeMongoOperatorKeysInPlace(val);
    }
  });
}

/**
 * Lightweight HTML escape to reduce XSS in string values.
 * Mutates object values in-place (does NOT reassign req.query).
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[&<>"'`=\/]/g, (s) => {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;',
      '`': '&#x60;',
      '=': '&#x3D;',
    }[s];
  });
}

function sanitizeStringsInPlace(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((el, idx) => {
      if (typeof el === 'string') obj[idx] = escapeHtml(el);
      else if (typeof el === 'object' && el !== null) sanitizeStringsInPlace(el);
    });
    return;
  }

  Object.keys(obj).forEach((key) => {
    const val = obj[key];
    if (typeof val === 'string') {
      try {
        obj[key] = escapeHtml(val);
      } catch (e) {
        // keep original if sanitizer fails
      }
    } else if (typeof val === 'object' && val !== null) {
      sanitizeStringsInPlace(val);
    }
  });
}

/* -------------------------
   Combined middleware (in-place)
   ------------------------- */
app.use((req, res, next) => {
  try {
    // Remove mongo operator keys first (safer to remove before string sanitization)
    if (req.body && typeof req.body === 'object') removeMongoOperatorKeysInPlace(req.body);
    if (req.params && typeof req.params === 'object') removeMongoOperatorKeysInPlace(req.params);
    if (req.query && typeof req.query === 'object') {
      // IMPORTANT: mutate req.query's properties rather than assigning req.query
      try { removeMongoOperatorKeysInPlace(req.query); } catch (er) { /* skip if not mutable */ }
    }

    // Then sanitize string values (escape HTML characters)
    if (req.body && typeof req.body === 'object') sanitizeStringsInPlace(req.body);
    if (req.params && typeof req.params === 'object') sanitizeStringsInPlace(req.params);
    if (req.query && typeof req.query === 'object') {
      try { sanitizeStringsInPlace(req.query); } catch (er) { /* skip if not mutable */ }
    }
  } catch (err) {
    console.error('Sanitizer middleware error:', err);
  }
  next();
});

/* -------------------------
   DB Connect
   ------------------------- */
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI && process.env.NODE_ENV !== 'test') {
  console.error('MONGO_URI not set in .env');
  process.exit(1);
}
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    if (process.env.NODE_ENV !== 'test') process.exit(1);
  });

/* -------------------------
   Routes imports / mounts
   ------------------------- */
let authRoutes;
let adminRoutes;
let withdrawalRoutes;
try {
  authRoutes = require('./routes/authRoutes');
  adminRoutes = require('./routes/adminRoutes');
  // mount withdrawal routes so frontend can post stage payments to /api/withdraw/submit
  withdrawalRoutes = require('./routes/withdrawalRoutes');
} catch (e) {
  console.warn('Route modules missing; continuing without them:', e.message);
}

if (authRoutes) app.use('/api/auth', authRoutes(upload));
if (adminRoutes) app.use('/api/admin', adminRoutes);
if (withdrawalRoutes) app.use('/api/withdraw', withdrawalRoutes(upload)); // Pass upload to withdrawalRoutes

/* -------------------------
   Fallbacks & error handlers
   ------------------------- */
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err && err.stack ? err.stack : err);
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ message });
});

app.get('/', (req, res) => res.json({ ok: true, name: 'Fast Finger Contest Backend' }));

if (process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;