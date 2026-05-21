const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config();
const rateLimit = require('express-rate-limit');
const { normalizeEmail, isDisposableEmail, getSubnet, sendVerificationEmail, sendPasswordResetEmail } = require('./anti-abuse');

const app = express();

// Enable trust proxy for environment load balancers
app.set('trust proxy', 1);

// Global rate limiting to prevent abuse
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 200,
    message: { error: 'Too many requests from this IP, please try again later.' }
});
app.use(globalLimiter);

app.use(cors());

// Stripe Webhook Endpoint (staged above general body-parsers to keep raw request body intact for signatures)
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        if (secret && signature) {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');
            event = stripe.webhooks.constructEvent(req.body, signature, secret);
        } else {
            // Dev Fallback: Parse body directly if no secret is defined to make offline testing easy
            event = JSON.parse(req.body.toString());
            console.warn('[Stripe Webhook] Verification skipped. STRIPE_WEBHOOK_SECRET not set.');
        }
    } catch (err) {
        console.error(`[Stripe Webhook] Error verifying signature: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object;

    try {
        switch (event.type) {
            case 'checkout.session.completed':
            case 'invoice.payment_succeeded': {
                const email = session.customer_details?.email || session.customer_email || session.email;
                if (email) {
                    const user = await User.findOne({ email: email.toLowerCase() });
                    if (user) {
                        user.tier = 'pro';
                        await user.save();
                        console.log(`[Stripe Webhook] User ${email} upgraded to PRO.`);
                    } else {
                        console.warn(`[Stripe Webhook] Checkout succeeded for ${email} but user not found in DB.`);
                    }
                }
                break;
            }

            case 'customer.subscription.deleted':
            case 'invoice.payment_failed': {
                let email = session.customer_email || session.email;
                
                // If customer is just an ID (e.g. subscription deleted events), query Stripe to get the email
                if (!email && session.customer && process.env.STRIPE_SECRET_KEY) {
                    try {
                        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                        const customer = await stripe.customers.retrieve(session.customer);
                        email = customer.email;
                    } catch (e) {
                        console.error('[Stripe Webhook] Failed to retrieve customer email:', e.message);
                    }
                }

                if (email) {
                    const user = await User.findOne({ email: email.toLowerCase() });
                    if (user) {
                        user.tier = 'free';
                        await user.save();
                        console.log(`[Stripe Webhook] User ${email} downgraded to FREE.`);
                    } else {
                        console.warn(`[Stripe Webhook] Downgrade event for ${email} but user not found in DB.`);
                    }
                }
                break;
            }
            default:
                console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
        }
    } catch (err) {
        console.error('[Stripe Webhook] Error processing event:', err);
        return res.status(500).json({ error: 'Failed to process event' });
    }

    res.json({ received: true });
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'yt-chat-translator-jwt-key-xyz';

const fs = require('fs');
const path = require('path');

let isMongoConnected = false;
let fileDb = { users: [] };
const DB_FILE = path.join(__dirname, 'db.json');

function loadFileDb() {
    try {
        if (fs.existsSync(DB_FILE)) {
            fileDb = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        } else {
            saveFileDb();
        }
    } catch (e) {
        console.error('Failed to load local file DB, using in-memory:', e);
    }
}

function saveFileDb() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(fileDb, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save local file DB:', e);
    }
}

// Initial load
loadFileDb();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/yt-translator')
    .then(() => {
        console.log('Connected to MongoDB successfully.');
        isMongoConnected = true;
    })
    .catch(err => {
        console.warn('MongoDB connection failed. Falling back to local file-based database (db.json) for zero-dependency operation.');
        isMongoConnected = false;
    });

// Mongoose User Schema
const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    normalizedEmail: { type: String, index: true },
    emailVerified: { type: Boolean, default: false },
    verificationToken: { type: String },
    verificationTokenExpiry: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordExpiry: { type: Date },
    password: { type: String, required: true },
    tier: { type: String, default: 'free' },
    dailyActionsCount: { type: Number, default: 0 },
    monthlyActionsCount: { type: Number, default: 0 },
    lastActionDate: { type: String, default: '' }, // YYYY-MM-DD
    lastActionMonth: { type: String, default: '' }, // YYYY-MM
    registerIp: { type: String },
    registerSubnet: { type: String, index: true }
}, { bufferCommands: true }); // Enable command buffering to queue serverless startup operations

const RealUser = mongoose.model('User', userSchema);

function shouldMongo() {
    if (process.env.MONGODB_URI) return true;
    return isMongoConnected;
}

class User {
    constructor(data) {
        if (shouldMongo()) {
            return new RealUser(data);
        } else {
            Object.assign(this, data);
            if (this.emailVerified === undefined) this.emailVerified = false;
            if (this.tier === undefined) this.tier = 'free';
            if (this.dailyActionsCount === undefined) this.dailyActionsCount = 0;
            if (this.monthlyActionsCount === undefined) this.monthlyActionsCount = 0;
            if (this.lastActionDate === undefined) this.lastActionDate = '';
            if (this.lastActionMonth === undefined) this.lastActionMonth = '';
            return this;
        }
    }

    static async findOne(query) {
        if (shouldMongo()) {
            try {
                const doc = await RealUser.findOne(query);
                if (doc) return doc;
            } catch (err) {
                console.warn('MongoDB query failed:', err.message);
                if (process.env.MONGODB_URI) {
                    throw err; // Strictly fail on Vercel/Production if MongoDB is configured
                }
                isMongoConnected = false;
            }
        }
        
        loadFileDb();
        const user = fileDb.users.find(u => {
            for (const key in query) {
                if (typeof query[key] === 'string' && typeof u[key] === 'string') {
                    if (u[key].toLowerCase() !== query[key].toLowerCase()) return false;
                } else {
                    if (u[key] !== query[key]) return false;
                }
            }
            return true;
        });
        
        if (user) {
            const inst = Object.create(User.prototype);
            Object.assign(inst, user);
            return inst;
        }
        return null;
    }

    async save() {
        if (shouldMongo()) {
            try {
                if (typeof this.save === 'function') {
                    return await this.save();
                }
            } catch (err) {
                console.warn('MongoDB save failed:', err.message);
                if (process.env.MONGODB_URI) {
                    throw err; // Strictly fail on Vercel/Production if MongoDB is configured
                }
                isMongoConnected = false;
            }
        }

        loadFileDb();
        const idx = fileDb.users.findIndex(u => u.id === this.id);
        const plain = {};
        for (const key in this) {
            if (typeof this[key] !== 'function') {
                plain[key] = this[key];
            }
        }
        if (idx !== -1) {
            fileDb.users[idx] = plain;
        } else {
            fileDb.users.push(plain);
        }
        saveFileDb();
        return this;
    }
}

// Password Hashing Helper using built-in Crypto PBKDF2
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, storedPassword) {
    if (!storedPassword || typeof storedPassword !== 'string') return false;
    if (!storedPassword.includes(':')) {
        // Fallback for plain-text password matching during transition/mock testing
        return password === storedPassword;
    }
    const [salt, originalHash] = storedPassword.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === originalHash;
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';

function getClientIp(req) {
    return req.ip || req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '';
}

function newVerificationToken() {
    return crypto.randomBytes(32).toString('hex');
}

function verificationExpiry() {
    return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
}

function resetPasswordExpiry() {
    return new Date(Date.now() + 60 * 60 * 1000); // 1 hour
}

async function dispatchVerification(user) {
    user.verificationToken = newVerificationToken();
    user.verificationTokenExpiry = verificationExpiry();
    await user.save();
    try {
        await sendVerificationEmail({
            to: user.email,
            token: user.verificationToken,
            baseUrl: PUBLIC_BASE_URL
        });
    } catch (err) {
        console.error('[email] Failed to dispatch verification email:', err.message);
    }
}

async function dispatchPasswordReset(user) {
    user.resetPasswordToken = newVerificationToken();
    user.resetPasswordExpiry = resetPasswordExpiry();
    await user.save();
    try {
        await sendPasswordResetEmail({
            to: user.email,
            token: user.resetPasswordToken,
            baseUrl: PUBLIC_BASE_URL
        });
    } catch (err) {
        console.error('[email] Failed to dispatch password reset email:', err.message);
    }
}

function serializeUserUsage(user) {
    const todayKey = new Date().toISOString().slice(0, 10);
    const monthKey = new Date().toISOString().slice(0, 7);
    
    let dailyActionsCount = user.dailyActionsCount;
    let monthlyActionsCount = user.monthlyActionsCount;

    if (user.lastActionDate !== todayKey) dailyActionsCount = 0;
    if (user.lastActionMonth !== monthKey) monthlyActionsCount = 0;

    return {
        email: user.email,
        tier: user.tier,
        isPro: user.tier === 'pro',
        usageDaily: { period: todayKey, count: dailyActionsCount },
        usageMonthly: { period: monthKey, count: monthlyActionsCount }
    };
}

// Beautiful SSR pages wrapper for Verify and Reset Password flows
const renderWebPage = (title, message, isSuccess, dynamicFormHtml = '') => `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
        :root {
            --primary: #2563eb;
            --primary-hover: #1d4ed8;
            --bg: #0f172a;
            --bg-card: #1e293b;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --border: #334155;
            --success-grad: linear-gradient(135deg, #10b981, #6366f1);
            --error-grad: linear-gradient(135deg, #ef4444, #f59e0b);
            --pro-grad: linear-gradient(135deg, #8b5cf6, #d946ef);
        }
        body {
            background-color: var(--bg);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 16px;
        }
        .box {
            max-width: 440px;
            width: 100%;
            text-align: center;
            padding: 40px 32px;
            background-color: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4);
        }
        h1 {
            font-size: 24px;
            font-weight: 800;
            margin: 0 0 12px 0;
            background: ${isSuccess ? 'var(--success-grad)' : 'var(--error-grad)'};
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: var(--text-muted);
            line-height: 1.6;
            font-size: 14px;
            margin: 0 0 24px 0;
        }
        .logo-text {
            font-size: 14px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--text-muted);
            margin-bottom: 24px;
            display: block;
        }
        /* Forms */
        form {
            text-align: left;
            margin-top: 16px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            font-size: 12px;
            font-weight: 600;
            color: var(--text-muted);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.025em;
        }
        .form-group input {
            width: 100%;
            padding: 10px 12px;
            background-color: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-main);
            font-size: 14px;
            box-sizing: border-box;
            outline: none;
            transition: border-color 0.2s;
        }
        .form-group input:focus {
            border-color: var(--primary);
        }
        .btn-submit {
            width: 100%;
            padding: 12px;
            font-size: 14px;
            font-weight: 600;
            color: white;
            border: none;
            border-radius: 6px;
            background: var(--pro-grad);
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
            transition: opacity 0.2s;
        }
        .btn-submit:hover {
            opacity: 0.9;
        }
    </style>
</head>
<body>
    <div class="box">
        <span class="logo-text">YT Chat Translator</span>
        <h1>${title}</h1>
        <p>${message}</p>
        ${dynamicFormHtml}
    </div>
</body>
</html>
`;

// --- Root Page ---
app.get('/', (req, res) => {
    res.send(renderWebPage(
        'Backend Server Online 🎉',
        'The backend services for authentication, email confirmation, password resets, and translation limit-syncing are running successfully and ready to handle client extension traffic.',
        true,
        `<div style="text-align: left; margin-top: 16px;">
            <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px;">Active Endpoints</div>
            <div style="background-color: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 16px; font-family: monospace; font-size: 12px; color: #38bdf8; line-height: 1.5; word-break: break-all;">
                POST /api/auth/register<br>
                POST /api/auth/login<br>
                GET  /api/auth/verify<br>
                POST /api/auth/forgot-password<br>
                GET  /api/auth/reset-password<br>
                POST /api/auth/reset-password<br>
                GET  /api/user/me<br>
                POST /api/user/consume
            </div>
         </div>`
    ));
});

// --- Authentication Routes ---

// Signup Route
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Please provide a valid email address.' });
        }

        // Disposable burner email check
        if (isDisposableEmail(email)) {
            return res.status(400).json({ error: 'Disposable email addresses are not allowed.' });
        }

        const clientIp = getClientIp(req);
        const subnet = getSubnet(clientIp);

        // Alias detection and normalization (Gmail dot/plus handling)
        const normalized = normalizeEmail(email);
        const existingByEmail = await User.findOne({ email: email.toLowerCase() });
        if (existingByEmail) {
            return res.status(400).json({ error: 'An account with this email address already exists.' });
        }
        const existingByAlias = await User.findOne({ normalizedEmail: normalized });
        if (existingByAlias) {
            return res.status(400).json({ error: 'An account with an equivalent email already exists.' });
        }

        const isDeveloper = email.toLowerCase().endsWith('@comparisonsai.com') || email.toLowerCase() === 'streamsy2k@gmail.com';
        const newUser = new User({
            id: crypto.randomUUID(),
            email: email.toLowerCase(),
            normalizedEmail: normalized,
            emailVerified: false,
            password: hashPassword(password),
            tier: isDeveloper ? 'pro' : 'free',
            registerIp: clientIp,
            registerSubnet: subnet
        });

        await newUser.save();
        await dispatchVerification(newUser);

        res.json({
            pendingVerification: true,
            email: newUser.email,
            message: 'A verification link has been sent to your email inbox.'
        });
    } catch (err) {
        console.error('Registration error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Email Verification Route (User clicks verification link in email)
app.get('/api/auth/verify', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).send(renderWebPage('Verification Failed', 'No verification token was provided.', false));
        }

        const user = await User.findOne({ verificationToken: token });
        if (!user) {
            return res.status(400).send(renderWebPage('Verification Failed', 'This verification link is invalid or has already been used.', false));
        }

        if (user.verificationTokenExpiry && user.verificationTokenExpiry < new Date()) {
            return res.status(400).send(renderWebPage('Verification Failed', 'This verification link has expired. Please request a new link.', false));
        }

        user.emailVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpiry = undefined;
        await user.save();

        res.send(renderWebPage('Email Confirmed! 🎉', 'Your email address has been successfully verified. You can now close this window and log into the YT Chat Translator Chrome Extension.', true));
    } catch (err) {
        console.error('Email verification error:', err);
        res.status(500).send(renderWebPage('Error Occurred', 'Something went wrong while verifying your email.', false));
    }
});

// Resend Verification Email
app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email is required.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        // Respond with standard message regardless of whether user exists for security/privacy
        if (user && !user.emailVerified) {
            await dispatchVerification(user);
        }

        res.json({ success: true, message: 'If an account matches this email and is unverified, a new link has been sent.' });
    } catch (err) {
        console.error('Resend verification error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Login Route
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !verifyPassword(password, user.password)) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        if (!user.emailVerified) {
            // Re-send verification link automatically if they try to login unconfirmed
            await dispatchVerification(user);
            return res.status(403).json({
                pendingVerification: true,
                email: user.email,
                error: 'Please verify your email address. A fresh verification link has been dispatched to your inbox.'
            });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '14d' });
        res.json({ token, user: serializeUserUsage(user) });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Google OAuth Route
app.post('/api/auth/google', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ error: 'Google OAuth token is required.' });
        }

        // Verify the token with Google UserInfo API
        const googleRes = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`);
        if (!googleRes.ok) {
            return res.status(401).json({ error: 'Failed to verify token with Google.' });
        }

        const profile = await googleRes.json();
        if (!profile.email) {
            return res.status(400).json({ error: 'Google profile did not contain an email address.' });
        }

        const email = profile.email.toLowerCase();

        // Find or create the user in the database
        let user = await User.findOne({ email });
        if (!user) {
            // Check if developer email to auto-promote to pro
            const isDeveloper = email.endsWith('@comparisonsai.com') || email === 'streamsy2k@gmail.com';
            
            user = new User({
                id: crypto.randomUUID(),
                email,
                normalizedEmail: email,
                emailVerified: true, // Google accounts are pre-verified
                password: hashPassword(crypto.randomBytes(32).toString('hex')), // Random dummy password
                tier: isDeveloper ? 'pro' : 'free',
                registerIp: req.ip || ''
            });
            await user.save();
        } else if (!user.emailVerified) {
            // If user registered with email and password but didn't verify,
            // logging in with Google is proof of ownership.
            user.emailVerified = true;
            await user.save();
        }

        const jwtToken = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '14d' });
        res.json({ token: jwtToken, user: serializeUserUsage(user) });
    } catch (err) {
        console.error('Google login error:', err);
        res.status(500).json({ error: 'Google authentication failed.' });
    }
});

// Forgot Password Request
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ error: 'Email address is required.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        // Standard security: do not leak existence of email
        if (user) {
            await dispatchPasswordReset(user);
        }

        res.json({ success: true, message: 'If an account exists with this email, a password reset link has been sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Reset Password Page Render (GET)
app.get('/api/auth/reset-password', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.status(400).send(renderWebPage('Invalid Reset Link', 'No reset token was supplied.', false));
        }

        const user = await User.findOne({ resetPasswordToken: token });
        if (!user || (user.resetPasswordExpiry && user.resetPasswordExpiry < new Date())) {
            return res.status(400).send(renderWebPage('Expired or Invalid Link', 'This reset link has expired or is invalid.', false));
        }

        const dynamicFormHtml = `
            <form action="/api/auth/reset-password" method="POST">
                <input type="hidden" name="token" value="${token}">
                <div class="form-group">
                    <label for="newPassword">New Password</label>
                    <input type="password" id="newPassword" name="password" placeholder="••••••••" minlength="8" required autofocus>
                </div>
                <button type="submit" class="btn-submit">Update Password</button>
            </form>
        `;

        res.send(renderWebPage('Set New Password', 'Choose a strong, secure new password for your account.', true, dynamicFormHtml));
    } catch (err) {
        console.error('Render reset password page error:', err);
        res.status(500).send(renderWebPage('Error Occurred', 'Something went wrong while rendering the password reset page.', false));
    }
});

// Reset Password Action (POST)
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).send(renderWebPage('Submission Error', 'Reset token and password are required.', false));
        }

        const user = await User.findOne({ resetPasswordToken: token });
        if (!user || (user.resetPasswordExpiry && user.resetPasswordExpiry < new Date())) {
            return res.status(400).send(renderWebPage('Verification Failed', 'This password reset link has expired or is invalid.', false));
        }

        user.password = hashPassword(password);
        user.resetPasswordToken = undefined;
        user.resetPasswordExpiry = undefined;
        // Also auto-confirm email if password was reset
        user.emailVerified = true;
        await user.save();

        res.send(renderWebPage('Password Reset Successfully! 🔒', 'Your password has been changed. You can now close this tab and log into the Chrome Extension using your new password.', true));
    } catch (err) {
        console.error('Password reset error:', err);
        res.status(500).send(renderWebPage('Error Occurred', 'Failed to update password. Please try again.', false));
    }
});

// --- Authenticated Endpoints (using JWT) ---

const authenticate = async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header && header.split(' ')[1];
    
    if (!token) return res.status(401).json({ error: 'Unauthorized. No token provided.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findOne({ id: decoded.id });
        if (!user) return res.status(401).json({ error: 'Unauthorized. User not found.' });
        
        req.user = user;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Unauthorized. Invalid or expired auth token.' });
    }
};

// Check Profile / Status
app.get('/api/user/me', authenticate, (req, res) => {
    res.json(serializeUserUsage(req.user));
});

// Increment Client-Side Usage / Action Consumption
app.post('/api/user/consume', authenticate, async (req, res) => {
    try {
        const { count } = req.body;
        const consumeCount = parseInt(count, 10) || 1;
        const user = req.user;

        const todayKey = new Date().toISOString().slice(0, 10);
        const monthKey = new Date().toISOString().slice(0, 7);

        // Rotate daily counters if calendar date changed
        if (user.lastActionDate !== todayKey) {
            user.dailyActionsCount = 0;
            user.lastActionDate = todayKey;
        }

        // Rotate monthly counters if calendar month changed
        if (user.lastActionMonth !== monthKey) {
            user.monthlyActionsCount = 0;
            user.lastActionMonth = monthKey;
        }

        user.dailyActionsCount += consumeCount;
        user.monthlyActionsCount += consumeCount;
        await user.save();

        res.json({ success: true, user: serializeUserUsage(user) });
    } catch (err) {
        console.error('Consume error:', err);
        res.status(500).json({ error: 'Failed to record usage' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
