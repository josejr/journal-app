const nodemailer = require("nodemailer");

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

let transporter = null;

function isConfigured() {
  return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

async function sendPasswordResetEmail(to, resetUrl) {
  if (!isConfigured()) {
    throw new Error("Email isn't configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS in .env");
  }
  await getTransporter().sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: "Reset your Daily Journal password",
    text: `Someone (hopefully you) requested a password reset.\n\nReset your password: ${resetUrl}\n\nThis link expires in 1 hour. If you didn't request this, you can ignore this email.`,
  });
}

module.exports = { isConfigured, sendPasswordResetEmail };
