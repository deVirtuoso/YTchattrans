const disposableList = require('disposable-email-domains');
const { Resend } = require('resend');

const disposableSet = new Set(disposableList.map(d => d.toLowerCase()));
const GMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

function normalizeEmail(rawEmail) {
    if (typeof rawEmail !== 'string') return '';
    const email = rawEmail.trim().toLowerCase();
    const atIdx = email.lastIndexOf('@');
    if (atIdx <= 0) return email;

    let local = email.slice(0, atIdx);
    const domain = email.slice(atIdx + 1);

    const plusIdx = local.indexOf('+');
    if (plusIdx !== -1) local = local.slice(0, plusIdx);

    if (GMAIL_DOMAINS.has(domain)) {
        local = local.replace(/\./g, '');
        return `${local}@gmail.com`;
    }

    return `${local}@${domain}`;
}

function getEmailDomain(email) {
    if (typeof email !== 'string') return '';
    const atIdx = email.lastIndexOf('@');
    return atIdx === -1 ? '' : email.slice(atIdx + 1).toLowerCase();
}

function isDisposableEmail(email) {
    return disposableSet.has(getEmailDomain(email));
}

function getSubnet(ip) {
    if (!ip || typeof ip !== 'string') return '';
    let clean = ip.trim();
    if (clean.startsWith('::ffff:')) clean = clean.slice(7);

    if (clean.includes('.')) {
        const parts = clean.split('.');
        if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
        return '';
    }

    if (clean.includes(':')) {
        const segs = clean.split(':');
        const head = segs.slice(0, 4).map(s => s || '0').join(':');
        return `${head}::/64`;
    }

    return '';
}

let resendClient = null;
function getResend() {
    if (resendClient) return resendClient;
    const key = process.env.RESEND_API_KEY;
    if (!key) return null;
    resendClient = new Resend(key);
    return resendClient;
}

// Gorgeous HTML email wrappers
const emailLayout = (title, bodyHtml) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0; padding: 0; background-color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .wrapper {
      width: 100%; table-layout: fixed; background-color: #0f172a; padding: 40px 0;
    }
    .content-box {
      max-width: 500px; margin: 0 auto; background-color: #1e293b;
      border: 1px solid #334155; border-radius: 16px; padding: 32px; text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.3);
    }
    .logo-container {
      display: inline-flex; align-items: center; justify-content: center;
      margin-bottom: 24px;
    }
    .logo-icon {
      color: #2563eb; font-size: 28px; font-weight: bold; margin-right: 8px;
    }
    .logo-text {
      color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: -0.025em;
    }
    h1 {
      color: #ffffff; font-size: 22px; font-weight: 700; margin: 0 0 12px 0; line-height: 1.25;
    }
    p {
      color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;
    }
    .btn-gradient {
      display: inline-block; padding: 12px 32px; font-size: 14px; font-weight: 600;
      color: #ffffff !important; text-decoration: none; border-radius: 8px;
      background: linear-gradient(135deg, #8b5cf6, #d946ef);
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35);
      transition: transform 0.2s, opacity 0.2s;
    }
    .divider {
      border-top: 1px solid #334155; margin: 32px 0 24px 0;
    }
    .link-alt {
      font-size: 11px; color: #64748b; word-break: break-all; margin-bottom: 20px;
    }
    .link-alt a {
      color: #38bdf8; text-decoration: none;
    }
    .footer {
      font-size: 11px; color: #475569; line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="content-box">
      <div class="logo-container">
        <span class="logo-text">YT Chat Translator</span>
      </div>
      ${bodyHtml}
    </div>
  </div>
</body>
</html>
`;

async function sendVerificationEmail({ to, token, baseUrl }) {
    const resend = getResend();
    const verifyUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
    const from = process.env.RESEND_FROM || 'YT Chat Translator <onboarding@resend.dev>';

    const bodyHtml = `
      <h1>Confirm your email address</h1>
      <p>Thank you for signing up for YT Chat Translator! Verify your email to activate your account and start translating comments and live chat.</p>
      <div>
        <a href="${verifyUrl}" class="btn-gradient" target="_blank">Verify Email</a>
      </div>
      <div class="divider"></div>
      <div class="link-alt">
        Or copy and paste this link into your browser:<br>
        <a href="${verifyUrl}" target="_blank">${verifyUrl}</a>
      </div>
      <div class="footer">
        This link will expire in 24 hours. If you did not register for this account, you can safely ignore this email.
      </div>
    `;

    const html = emailLayout('Confirm your email', bodyHtml);

    if (!resend) {
        console.warn(`[email-dev-fallback] RESEND_API_KEY is not configured.`);
        console.warn(`[email-dev-fallback] Verification URL for ${to}: ${verifyUrl}`);
        return { dev: true, verifyUrl };
    }

    const response = await resend.emails.send({
        from,
        to,
        subject: 'Confirm your email — YT Chat Translator',
        html
    });

    if (response && response.error) {
        const err = response.error;
        throw new Error(`[Resend Error ${err.statusCode || ''}] ${err.message || JSON.stringify(err)}`);
    }

    return response;
}

async function sendPasswordResetEmail({ to, token, baseUrl }) {
    const resend = getResend();
    const resetUrl = `${baseUrl}/api/auth/reset-password?token=${encodeURIComponent(token)}`;
    const from = process.env.RESEND_FROM || 'YT Chat Translator <onboarding@resend.dev>';

    const bodyHtml = `
      <h1>Reset your password</h1>
      <p>We received a request to reset the password for your YT Chat Translator account. Click the button below to set a new password.</p>
      <div>
        <a href="${resetUrl}" class="btn-gradient" target="_blank">Reset Password</a>
      </div>
      <div class="divider"></div>
      <div class="link-alt">
        Or copy and paste this link into your browser:<br>
        <a href="${resetUrl}" target="_blank">${resetUrl}</a>
      </div>
      <div class="footer">
        This link will expire in 1 hour. If you did not request a password reset, please ignore this email and your password will remain unchanged.
      </div>
    `;

    const html = emailLayout('Reset your password', bodyHtml);

    if (!resend) {
        console.warn(`[email-dev-fallback] RESEND_API_KEY is not configured.`);
        console.warn(`[email-dev-fallback] Password Reset URL for ${to}: ${resetUrl}`);
        return { dev: true, resetUrl };
    }

    const response = await resend.emails.send({
        from,
        to,
        subject: 'Reset your password — YT Chat Translator',
        html
    });

    if (response && response.error) {
        const err = response.error;
        throw new Error(`[Resend Error ${err.statusCode || ''}] ${err.message || JSON.stringify(err)}`);
    }

    return response;
}

module.exports = {
    normalizeEmail,
    isDisposableEmail,
    getSubnet,
    sendVerificationEmail,
    sendPasswordResetEmail
};
