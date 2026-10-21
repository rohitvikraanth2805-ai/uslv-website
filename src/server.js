import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */
const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const PORT = Number(env.PORT) || 8080;

const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = Number(env.RATE_LIMIT_MAX) || 10; // bookings per visitor per 15 minutes

// Every booking is also saved here, so a lead is never lost if email fails.
// The default is OUTSIDE your project folder on purpose: if the file were inside it,
// VS Code Live Server would notice the change and reload the page right after a booking.
const BOOKINGS_FILE = env.BOOKINGS_FILE
  ? path.resolve(env.BOOKINGS_FILE)
  : path.join(os.homedir(), 'uslv-bookings', 'bookings.jsonl');

const EMAIL_ENABLED = Boolean(env.EMAIL_USER && env.EMAIL_PASS);

const SERVICES = ['Career Counselling', 'Financial Advisory', 'Educational Advisory', 'Corporate Training'];
const SERVICE_ALIASES = { Career: SERVICES[0], Finance: SERVICES[1], Education: SERVICES[2] }; // older form values

if (!EMAIL_ENABLED) {
  console.warn('⚠️  EMAIL_USER / EMAIL_PASS not set: bookings will be printed and saved, but no email is sent.');
}

/* -------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------- */
// Escape user input before placing it in HTML (prevents HTML injection into your inbox)
const esc = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Remove control characters and line breaks (prevents email header and log injection)
const singleLine = (value) => String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Validates and cleans the request body.
 * Required: name, phone, service. Optional but checked when present: email, age, message.
 */
function validateBooking(body = {}) {
  const errors = {};

  const name = singleLine(body.name);
  if (name.length < 2 || name.length > 80) errors.name = 'Enter your full name.';

  const digits = singleLine(body.phone).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');
  if (!/^[6-9]\d{9}$/.test(digits)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';

  const rawService = singleLine(body.service);
  const service = SERVICES.includes(rawService) ? rawService : SERVICE_ALIASES[rawService];
  if (!service) errors.service = 'Choose a valid service.';

  const email = singleLine(body.email).toLowerCase();
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) errors.email = 'Enter a valid email address.';

  const ageText = singleLine(body.age);
  const age = ageText ? Number(ageText) : null;
  if (ageText && (!Number.isInteger(age) || age < 1 || age > 120)) errors.age = 'Enter an age between 1 and 120.';

  const message = String(body.message ?? '').replace(/\r\n/g, '\n').trim();
  if (message.length > 1000) errors.message = 'Message is too long (1000 characters maximum).';

  return { errors, data: { name, phone: `+91${digits}`, service, email, age, message } };
}

const fail = (res, status, message, errors) =>
  res.status(status).json({ success: false, message, error: message, ...(errors ? { errors } : {}) });

/* -------------------------------------------------------------------------
 * Email
 * ---------------------------------------------------------------------- */
// Configure Explicit Gmail SMTP Transporter
const transporter = EMAIL_ENABLED
  ? nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null;

const explainMailError = (error) =>
  error?.code === 'EAUTH'
    ? `${error.message} → Gmail rejected the login. Use a Gmail App Password in EMAIL_PASS (not your normal password).`
    : error?.message;

// Verify SMTP connection on startup
if (transporter) {
  transporter.verify((error) => {
    if (error) console.error('❌ SMTP Connection Error:', explainMailError(error));
    else console.log('✅ SMTP Transporter connected & ready to send emails!');
  });
}

function buildHtmlEmail(d, timestamp) {
  const row = (label, value) => `
            <tr>
              <th>${label}</th>
              <td>${value}</td>
            </tr>`;

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 20px; }
        .card { max-width: 600px; background: #ffffff; margin: 0 auto; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); overflow: hidden; border: 1px solid #e2e8f0; }
        .header { background-color: #b8860b; color: #ffffff; padding: 20px; text-align: center; }
        .header h2 { margin: 0; font-size: 20px; text-transform: uppercase; letter-spacing: 1px; }
        .content { padding: 24px; }
        .booking-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        .booking-table th, .booking-table td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #edf2f7; font-size: 14px; }
        .booking-table th { background-color: #f8fafc; color: #475569; width: 35%; font-weight: 600; }
        .booking-table td { color: #1e293b; font-weight: 500; }
        .footer { background-color: #f8fafc; text-align: center; padding: 14px; font-size: 12px; color: #64748b; border-top: 1px solid #edf2f7; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h2>🚨 New Appointment Request</h2>
        </div>
        <div class="content">
          <table class="booking-table">${row('Customer Name', esc(d.name))}${row(
            'Phone Number',
            `<a href="tel:${esc(d.phone)}" style="color:#b8860b; text-decoration:none; font-weight:bold;">${esc(d.phone)}</a>`
          )}${row(
            'Email Address',
            d.email
              ? `<a href="mailto:${esc(d.email)}" style="color:#2563eb; text-decoration:none;">${esc(d.email)}</a>`
              : 'Not Provided'
          )}${row('Age', d.age ?? 'Not Provided')}${row('Service Required', `<strong>${esc(d.service)}</strong>`)}${row(
            'Message / Queries',
            d.message ? esc(d.message).replace(/\n/g, '<br>') : 'None'
          )}${row('Booking Time', `${esc(timestamp)} IST`)}
          </table>
        </div>
        <div class="footer">
          US &amp; LV India (OPC) Pvt Ltd • Automated Booking System
        </div>
      </div>
    </body>
    </html>
    `;
}

/* -------------------------------------------------------------------------
 * App & middleware
 * ---------------------------------------------------------------------- */
const app = express();
app.disable('x-powered-by');
if (env.TRUST_PROXY) app.set('trust proxy', Number(env.TRUST_PROXY) || env.TRUST_PROXY); // behind Render, Nginx, etc.

// Security headers (set CSP=off in .env if you ever add inline scripts or third-party embeds)
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (env.CSP !== 'off') {
    res.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
      ].join('; ')
    );
  }
  next();
});

// CORS: this site, plus (outside production) any localhost / 127.0.0.1 page on any port,
// which is what VS Code Live Server uses (e.g. http://127.0.0.1:5500), and file:// pages.
const isLocalOrigin = (origin) =>
  origin === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);

app.use(
  cors({
    origin: (origin, callback) =>
      callback(null, !origin || ALLOWED_ORIGINS.includes(origin) || (!IS_PROD && isLocalOrigin(origin))),
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  })
);

// Middleware to parse incoming request data (small limits: a booking is a few hundred bytes)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Static files come from the same folder as this file, so keep server code and private files out of reach
const PRIVATE_FILE = /(^|\/)(server\.js|package(-lock)?\.json|\.env[^/]*|[^/]*\.(jsonl|log))$/i;
const PRIVATE_DIR = /(^|\/)(node_modules|\.git|data)(\/|$)/i;
app.use((req, res, next) => {
  let requested;
  try {
    requested = decodeURIComponent(req.path);
  } catch {
    return res.status(400).type('text').send('Bad request');
  }
  if (PRIVATE_FILE.test(requested) || PRIVATE_DIR.test(requested)) return res.status(404).type('text').send('Not found');
  next();
});

// Serve static frontend assets from src folder
app.use(express.static(__dirname, { dotfiles: 'ignore', index: 'index.html', maxAge: IS_PROD ? '1h' : 0 }));

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// Simple per-visitor limit so the form can't be used to flood your inbox
const hits = new Map();
const rateLimit = (req, res, next) => {
  const now = Date.now();
  let entry = hits.get(req.ip);
  if (!entry || entry.reset <= now) {
    entry = { count: 0, reset: now + RATE_WINDOW_MS };
    hits.set(req.ip, entry);
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
    return fail(res, 429, 'Too many requests. Please try again in a few minutes.');
  }
  next();
};
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) if (entry.reset <= now) hits.delete(ip);
}, 60_000).unref();

/* -------------------------------------------------------------------------
 * Appointment form submission (both route names are accepted)
 * ---------------------------------------------------------------------- */
app.post(['/api/contact', '/api/book-appointment'], rateLimit, async (req, res) => {
  const body = req.body ?? {};

  // Anti-spam honeypot
  if (body.website) {
    return res.status(200).json({ success: true, message: 'Request received.' });
  }

  // Validate parameters
  const { errors, data } = validateBooking(body);
  if (Object.keys(errors).length) {
    return fail(res, 400, 'Please check the form and try again.', errors);
  }

  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // 1. PRINT TO VS CODE TERMINAL
  console.log('\n==================================================');
  console.log('🚨 NEW APPOINTMENT BOOKING RECEIVED!');
  console.log('==================================================');
  console.log(`👤 Customer Name : ${data.name}`);
  console.log(`📞 Phone Number  : ${data.phone}`);
  console.log(`📧 Email Address : ${data.email || 'Not Provided'}`);
  console.log(`🎂 Age           : ${data.age ?? 'Not Provided'}`);
  console.log(`💼 Service       : ${data.service}`);
  console.log(`💬 Message/Notes : ${singleLine(data.message) || 'None'}`);
  console.log(`⏰ Timestamp     : ${timestamp}`);
  console.log(`🌐 Sent from     : ${req.get('origin') || 'same site'}`);
  console.log('==================================================\n');

  // 2. SAVE A COPY AND EMAIL THE STYLED TABLE: independent, so one failing never loses the booking
  const saveCopy = async () => {
    await fs.mkdir(path.dirname(BOOKINGS_FILE), { recursive: true });
    await fs.appendFile(BOOKINGS_FILE, `${JSON.stringify({ ...data, receivedAt: new Date().toISOString() })}\n`, 'utf8');
  };

  const sendEmail = async () => {
    if (!transporter) throw new Error('Email is not configured');
    return transporter.sendMail({
      from: `"US & LV Website" <${env.EMAIL_USER}>`,
      to: env.OWNER_EMAIL || env.EMAIL_USER,
      replyTo: data.email || undefined,
      subject: truncate(`🚨 New Booking: ${data.name} (${data.service})`, 150),
      html: buildHtmlEmail(data, timestamp),
      text: `New appointment request\n\nName: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email || 'Not Provided'}\nAge: ${
        data.age ?? 'Not Provided'
      }\nService: ${data.service}\nMessage: ${data.message || 'None'}\nTime: ${timestamp} IST\n`,
    });
  };

  const [saved, emailed] = await Promise.allSettled([saveCopy(), sendEmail()]);

  if (emailed.status === 'fulfilled') console.log('✅ Styled HTML email sent successfully! Message ID:', emailed.value.messageId);
  else if (EMAIL_ENABLED) console.error('❌ Failed to send email alert:', explainMailError(emailed.reason));
  if (saved.status === 'rejected') console.error('❌ Failed to save booking copy:', saved.reason?.message);

  if (emailed.status === 'fulfilled') {
    return res.status(200).json({
      success: true,
      message: 'Thank you! Your appointment request has been received successfully.',
    });
  }
  if (saved.status === 'fulfilled') {
    return res.status(200).json({
      success: true,
      message: 'Thank you! Your appointment request has been logged.',
    });
  }

  // Neither the email nor the saved copy worked: tell the visitor the truth
  return fail(res, 502, 'We could not record your request. Please call us instead.');
});

// Unknown API routes get a proper JSON 404 (the website treats 404 as "try the next route")
app.use('/api', (_req, res) => fail(res, 404, 'Not found.'));

// Fallback route - Express v5 safe catch-all (pages only; missing files stay 404)
app.use((req, res) => {
  if ((req.method !== 'GET' && req.method !== 'HEAD') || path.extname(req.path)) {
    return res.status(404).type('text').send('Not found');
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Error handler: bad JSON, oversized bodies and anything unexpected
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'Invalid request.');
  if (err.type === 'entity.too.large') return fail(res, 413, 'Request too large.');
  console.error('❌ Unhandled error:', err);
  return fail(res, err.status || 500, 'Server error.');
});

/* -------------------------------------------------------------------------
 * Start & graceful shutdown
 * ---------------------------------------------------------------------- */
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}`);
  console.log(`📡 Listening for appointment bookings (from this site and from Live Server)...`);
  console.log(`💾 Booking copies are saved to: ${BOOKINGS_FILE}\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`❌ Port ${PORT} is already in use. Stop the other server or set PORT in .env.`);
  else console.error('❌ Server error:', err.message);
  process.exit(1);
});

const shutdown = (signal) => {
  console.log(`\n${signal} received, shutting down.`);
  server.close(() => {
    transporter?.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
['SIGINT', 'SIGTERM'].forEach((signal) => process.on(signal, () => shutdown(signal)));
process.on('unhandledRejection', (reason) => console.error('❌ Unhandled rejection:', reason));
