// middleware/validators.js
const { check, validationResult } = require('express-validator');

/**
 * Helper: country checks
 */
function isUSA(country) {
  if (!country) return false;
  const c = String(country).toLowerCase();
  return c === 'united states' || c === 'united states of america' || c === 'usa' || c === 'us';
}
function isCanada(country) {
  if (!country) return false;
  return String(country).toLowerCase().includes('canada');
}

const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // return first error for simplicity
    return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
  }
  next();
};

/**
 * Registration validator
 */
const registerValidator = [
  check('firstName').trim().notEmpty().withMessage('First name required'),
  check('lastName').trim().notEmpty().withMessage('Last name required'),
  check('country').trim().notEmpty().withMessage('Country required'),
  check('email').isEmail().withMessage('Valid email required'),
  check('phone').optional().isString().withMessage('Phone must be a string'),
  check('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  check('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must contain a special character'),
  handleValidation
];

const loginValidator = [
  check('username').trim().notEmpty().withMessage('Username required'),
  check('password').notEmpty().withMessage('Password required'),
  handleValidation
];

/**
 * Withdraw request validator (fixed to use req.body.country synchronously)
 *
 * Expects body: { method, details, country? }
 * authenticate must run before this so req.user.id is available (but we will prefer req.body.country).
 */
const withdrawRequestValidator = [
  // Validate method and determine country (prefer body.country so we avoid async DB lookup)
  check('method')
    .trim()
    .notEmpty().withMessage('Withdrawal method required')
    .bail()
    .custom((m, { req }) => {
      const method = String(m || '').toLowerCase();
      const allowed = ['crypto', 'bank', 'stripe'];
      if (!allowed.includes(method)) throw new Error('Invalid withdrawal method.');

      // prefer country from request body (frontend now sends it), fallback to req.user.country if present
      const country = (req.body && req.body.country) ? req.body.country : (req.user && req.user.country ? req.user.country : '');

      // store for other validators
      req.userCountry = country;

      // enforce country-specific allowance
      if (!isUSA(country) && !isCanada(country) && method !== 'crypto') {
        throw new Error('Only cryptocurrency withdrawals are available for your country.');
      }

      return true;
    }),

  /**
   * Ensure details is present and an object when the selected method requires it.
   * If method is crypto|bank|stripe we expect details to be an object.
   */
  check('details')
    .custom((d, { req }) => {
      const method = String(req.body.method || '').toLowerCase();
      if (['crypto', 'bank', 'stripe'].includes(method)) {
        if (!d || typeof d !== 'object') {
          throw new Error('Details must be provided as an object for the selected withdrawal method.');
        }
      }
      return true;
    }),

  // Crypto validators (nested under details)
  check('details.crypto')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'crypto')
    .notEmpty().withMessage('Crypto type required for cryptocurrency withdrawals'),

  check('details.walletAddress')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'crypto')
    .notEmpty().withMessage('Wallet address required for cryptocurrency withdrawals'),

  // Bank (USA) validators — nested under details
  check('details.bankName')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Bank name required for USA wire transfer'),

  check('details.bankAddress')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Bank address required for USA wire transfer'),

  check('details.routingNumber')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Routing Number required for USA wire transfer')
    .bail()
    .matches(/^\d{9}$/).withMessage('Routing Number must be 9 digits'),

  check('details.beneficiaryName')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Beneficiary Name required for USA wire transfer'),

  check('details.accountNumber')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Account Number required for USA wire transfer'),

  check('details.accountType')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Account type required for USA wire transfer')
    .bail()
    .isIn(['checking', 'savings']).withMessage('Account type must be either "checking" or "savings"'),

  check('details.beneficiaryAddress')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isUSA(req.userCountry))
    .notEmpty().withMessage('Beneficiary address required for USA wire transfer'),

  // Bank (Canada) validators — nested under details
  check('details.transitNumber')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isCanada(req.userCountry))
    .notEmpty().withMessage('Transit Number required for Canada wire transfer')
    .bail()
    .matches(/^\d{5}$/).withMessage('Transit Number must be 5 digits'),

  check('details.institutionNumber')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isCanada(req.userCountry))
    .notEmpty().withMessage('Institution Number required for Canada wire transfer')
    .bail()
    .matches(/^\d{3}$/).withMessage('Institution Number must be 3 digits'),

  check('details.accountNumber')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isCanada(req.userCountry))
    .notEmpty().withMessage('Account Number required for Canada wire transfer'),

  check('details.beneficiaryName')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'bank' && isCanada(req.userCountry))
    .notEmpty().withMessage('Beneficiary Name required for Canada wire transfer'),

  // Stripe minimal validator (nested under details)
  check('details.email')
    .if((value, { req }) => String(req.body.method || '').toLowerCase() === 'stripe')
    .notEmpty().withMessage('Email required for Stripe withdrawals')
    .bail()
    .isEmail().withMessage('Valid email required for Stripe withdrawals'),

  handleValidation
];

/**
 * Activation payment validator
 */
const activatePaymentValidator = [
  check('method').trim().notEmpty().withMessage('Payment method required'),
  // If giftcard: require cardType and cardPin
  check('cardType').if((value, { req }) => req.body.method === 'giftcard').notEmpty().withMessage('Card type required for giftcard'),
  check('cardPin').if((value, { req }) => req.body.method === 'giftcard').notEmpty().withMessage('Card pin required for giftcard'),
  // If crypto: require crypto and walletAddress
  check('crypto').if((value, { req }) => req.body.method === 'crypto').notEmpty().withMessage('Crypto type required'),
  check('walletAddress').if((value, { req }) => req.body.method === 'crypto').notEmpty().withMessage('Wallet address required'),
  // If bank: require bankName and accountNumber
  check('bankName').if((value, { req }) => req.body.method === 'bank').notEmpty().withMessage('Bank name required'),
  check('accountNumber').if((value, { req }) => req.body.method === 'bank').notEmpty().withMessage('Account number required'),
  handleValidation
];

// Admin-side validators
const notifyValidator = [
  check('userId').trim().notEmpty().withMessage('userId is required'),
  check('text').trim().notEmpty().withMessage('Notification text is required'),
  handleValidation
];

const approveValidator = [
  check('approveTax').optional().isBoolean().withMessage('approveTax must be boolean'),
  check('approveInsurance').optional().isBoolean().withMessage('approveInsurance must be boolean'),
  handleValidation
];

/**
 * Confirm-pin validator
 */
const confirmPinValidator = [
  check('withdrawalId').trim().notEmpty().withMessage('withdrawalId is required'),
  check('stage').trim().notEmpty().withMessage('stage is required'),
  check('pin').trim().isLength({ min: 4, max: 4 }).withMessage('Pin must be 4 digits'),
  handleValidation
];

module.exports = {
  registerValidator,
  loginValidator,
  withdrawRequestValidator,
  activatePaymentValidator,
  notifyValidator,
  approveValidator,
  confirmPinValidator
};
