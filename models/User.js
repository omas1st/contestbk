// FILE: models/User.js
// -------------------------

const { Schema, model } = require('mongoose');

const PaymentSchema = new Schema({
  method: String,
  details: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now },
  status: { type: String, default: 'submitted' }
});

const MessageSchema = new Schema({
  text: String,
  createdAt: { type: Date, default: Date.now }
});

const NotificationSchema = new Schema({
  text: String,
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});

const UserSchema = new Schema({
  firstName: String,
  lastName: String,
  country: String,
  email: { type: String, unique: true, sparse: true, trim: true, lowercase: true },
  phone: String,
  username: { type: String, unique: true, trim: true, lowercase: true },
  password: String,
  role: { type: String, default: 'user' },
  balance: { type: Number, default: 0 },
  timerActive: { type: Boolean, default: false },
  timerEnds: { type: Date, default: null },
  messages: [MessageSchema],
  notifications: [NotificationSchema],
  payments: [PaymentSchema],
  taxApproved: { type: Boolean, default: false },
  insuranceApproved: { type: Boolean, default: false },

  /**
   * activationPins stores pins set by admin for each stage per user.
   * Example:
   * activationPins: {
   *   activation: { pin: '1234', set: true, setAt: Date },
   *   tax: { pin: '2345', set: true, setAt: Date }
   * }
   */
  activationPins: { type: Schema.Types.Mixed, default: {} },

  /**
   * activationStatus stores which stages the user has completed:
   * activationStatus: { activation: true, tax: true, insurance: false, ... }
   */
  activationStatus: { type: Schema.Types.Mixed, default: {} }

}, { timestamps: true });

/**
 * Ensure values are normalized before saving.
 * - username and email are trimmed and lowercased.
 * This complements the schema `lowercase: true` but ensures any programmatic writes
 * also get normalized.
 */
UserSchema.pre('save', function (next) {
  if (this.isModified('username') && this.username) {
    this.username = String(this.username).trim().toLowerCase();
  }
  if (this.isModified('email') && this.email) {
    this.email = String(this.email).trim().toLowerCase();
  }
  next();
});

/**
 * Create explicit indexes with a case-insensitive collation to help
 * enforce uniqueness at the DB level in a case-insensitive way.
 *
 * Note: if you already have existing unique indexes on these fields,
 * creating new indexes may fail until old indexes are dropped or migrated.
 */
UserSchema.index({ username: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
UserSchema.index({ email: 1 }, { unique: true, sparse: true, collation: { locale: 'en', strength: 2 } });

module.exports = model('User', UserSchema);
