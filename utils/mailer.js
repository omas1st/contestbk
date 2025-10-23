// utils/mailer.js
const nodemailer = require('nodemailer');

let transporter = null;

// create transporter only when env vars are present
if (process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL_PASSWORD) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.ADMIN_EMAIL,
      pass: process.env.ADMIN_EMAIL_PASSWORD
    }
  });
} else {
  console.warn('ADMIN_EMAIL or ADMIN_EMAIL_PASSWORD not provided - email notifications disabled.');
}

/**
 * sendAdminEmail(subject, text, attachments)
 * attachments: optional array of { filename, path } objects accepted by nodemailer
 */
async function sendAdminEmail(subject, text, attachments = []) {
  if (!transporter) {
    // Fallback: log so you can inspect content when email isn't configured
    console.log('sendAdminEmail skipped (no transporter). Subject:', subject);
    console.log('Body:', text);
    if (attachments && attachments.length) {
      console.log('Attachments:', attachments.map(a => a.filename || a.path));
    }
    return;
  }
  try {
    const mailOptions = {
      from: process.env.ADMIN_EMAIL,
      to: process.env.ADMIN_EMAIL,
      subject,
      text,
      attachments: Array.isArray(attachments) ? attachments : []
    };
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error('Mailer error:', err);
  }
}

module.exports = { sendAdminEmail };
