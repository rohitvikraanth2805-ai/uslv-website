import express from 'express';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { promises as fs, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* -------------------------------------------------------------------------
 * Load .env
 * dotenv normally reads .env from the folder you start Node in, and it never
 * replaces a variable that already exists in your terminal. Either one can make
 * the server keep using an OLD email login. So we look in the usual places and
 * let the .env file win.
 * ---------------------------------------------------------------------- */
const ENV_CANDIDATES = [...new Set([
  path.join(__dirname, '.env'),
  path.join(process.cwd(), '.env'),
  path.join(__dirname, '..', '.env'),
])];
const ENV_FILE = ENV_CANDIDATES.find((file) => existsSync(file));
if (ENV_FILE) dotenv.config({ path: ENV_FILE, override: true });
else dotenv.config();

/* -------------------------------------------------------------------------
 * Configuration
 * ---------------------------------------------------------------------- */
const env = process.env;
const IS_PROD = env.NODE_ENV === 'production';
const PORT = Number(env.PORT) || 8080;

// Strip stray spaces and quotes: Google shows App Passwords as "abcd efgh ijkl mnop"
const unquote = (v) => String(v ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const EMAIL_USER = unquote(env.EMAIL_USER);
const EMAIL_PASS = unquote(env.EMAIL_PASS).replace(/\s+/g, '');
const OWNER_EMAIL = unquote(env.OWNER_EMAIL) || EMAIL_USER;
const CUSTOMER_CONFIRMATION = (env.CUSTOMER_CONFIRMATION || 'on').toLowerCase() !== 'off';

const mask = (email) => email.replace(/^(.{2}).*(@.*)$/, '$1•••$2');

const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = Number(env.RATE_LIMIT_MAX) || 10; // bookings per visitor per 15 minutes

// Every booking is also saved here, so a lead is never lost if email fails.
// The default is OUTSIDE your project folder on purpose: if the file were inside it,
// VS Code Live Server would notice the change and reload the page right after a booking.
const BOOKINGS_FILE = env.BOOKINGS_FILE
  ? path.resolve(env.BOOKINGS_FILE)
  : path.join(os.homedir(), 'uslv-bookings', 'bookings.jsonl');

const EMAIL_ENABLED = Boolean(EMAIL_USER && EMAIL_PASS);

const SERVICES = ['Career Counselling', 'Financial Advisory', 'Educational Advisory', 'Corporate Training'];
const SERVICE_ALIASES = { Career: SERVICES[0], Finance: SERVICES[1], Education: SERVICES[2] }; // older form values

console.log(`⚙️  Settings file : ${ENV_FILE || 'none found (using system environment)'}`);
if (EMAIL_ENABLED) {
  console.log(`📧 Mail account  : ${mask(EMAIL_USER)}  →  alerts go to ${mask(OWNER_EMAIL)}`);
  console.log(`🔑 App password  : ${EMAIL_PASS.length} characters`);
  if (EMAIL_PASS.length !== 16) {
    console.warn('⚠️  A Gmail App Password is exactly 16 characters. Create a new one and paste it again.');
  }
} else {
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
      auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null;

const explainMailError = (error) => {
  if (error?.code === 'EAUTH') {
    return [
      error.message,
      `   → Gmail rejected the login for ${mask(EMAIL_USER)}. Check all of these:`,
      '     1. The App Password was created while signed in to THIS exact account (not an old or test account).',
      '     2. 2-Step Verification is switched ON for this account (App Passwords need it).',
      '     3. The password in .env is the newest one (an old or deleted one stops working).',
      '     4. Google Workspace accounts: your admin must allow App Passwords.',
      '     5. Restart the server after editing .env.',
    ].join('\n');
  }
  if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNECTION' || error?.code === 'ESOCKET') {
    return `${error.message} → The server could not reach Gmail (port 465). Check the internet connection, VPN or firewall.`;
  }
  return error?.message;
};

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

/* Confirmation sent to the person who booked (only when they gave an email address) */
function buildCustomerEmail(d, timestamp) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; background:#f4f6f8; margin:0; padding:20px;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden;">
        <div style="background:#0f3d3e; color:#ffffff; padding:22px; text-align:center;">
          <h2 style="margin:0; font-size:20px;">Your appointment request is confirmed</h2>
        </div>
        <div style="padding:24px; color:#1e293b; font-size:15px; line-height:1.6;">
          <p>Dear ${esc(d.name)},</p>
          <p>Thank you for booking with <strong>US &amp; LV India (OPC) Pvt Ltd</strong>. We have received your request for <strong>${esc(d.service)}</strong> and will contact you shortly on <strong>${esc(d.phone)}</strong> to confirm your session.</p>
          <p style="margin:18px 0 4px;"><strong>Your details</strong></p>
          <p style="margin:0;">Service: ${esc(d.service)}<br>Phone: ${esc(d.phone)}<br>Requested on: ${esc(timestamp)} IST</p>
          <p style="margin-top:18px;">For anything urgent, call us on <a href="tel:+919380376767" style="color:#8a6414;">+91 93803 76767</a> (Monday to Saturday, 9:00 AM to 6:00 PM).</p>
          <p>Warm regards,<br>US &amp; LV India<br><em>The Growth Transformers</em></p>
        </div>
      </div>
    </body>
    </html>
    `;
}

/* -------------------------------------------------------------------------
 * Mail test:  node src/server.js --test-mail
 * Sends one test email to OWNER_EMAIL and exits, so you can check your
 * Gmail settings without opening the website.
 * ---------------------------------------------------------------------- */
if (process.argv.includes('--test-mail')) {
  (async () => {
    if (!transporter) {
      console.error('❌ Set EMAIL_USER and EMAIL_PASS in .env first.');
      process.exit(1);
    }
    try {
      await transporter.sendMail({
        from: `"US & LV Website" <${EMAIL_USER}>`,
        to: OWNER_EMAIL,
        subject: '✅ Test email from the US & LV website',
        text: 'If you can read this, your Gmail settings are correct and booking alerts will arrive.',
      });
      console.log(`✅ Test email sent to ${mask(OWNER_EMAIL)}. Check the inbox (and spam).`);
      process.exit(0);
    } catch (error) {
      console.error('❌ Test email failed:', explainMailError(error));
      process.exit(1);
    }
  })();
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

  // 2. SAVE A COPY, EMAIL THE OWNER, CONFIRM TO THE CUSTOMER: independent, so one failing never loses the booking
  const saveCopy = async () => {
    await fs.mkdir(path.dirname(BOOKINGS_FILE), { recursive: true });
    await fs.appendFile(BOOKINGS_FILE, `${JSON.stringify({ ...data, receivedAt: new Date().toISOString() })}\n`, 'utf8');
  };

  const sendOwnerEmail = async () => {
    if (!transporter) throw new Error('Email is not configured');
    return transporter.sendMail({
      from: `"US & LV Website" <${EMAIL_USER}>`,
      to: OWNER_EMAIL,
      replyTo: data.email || undefined,
      subject: truncate(`🚨 New Booking: ${data.name} (${data.service})`, 150),
      html: buildHtmlEmail(data, timestamp),
      text: `New appointment request\n\nName: ${data.name}\nPhone: ${data.phone}\nEmail: ${data.email || 'Not Provided'}\nAge: ${
        data.age ?? 'Not Provided'
      }\nService: ${data.service}\nMessage: ${data.message || 'None'}\nTime: ${timestamp} IST\n`,
    });
  };

  const sendCustomerEmail = async () => {
    if (!transporter || !CUSTOMER_CONFIRMATION || !data.email) return null;
    return transporter.sendMail({
      from: `"US & LV India" <${EMAIL_USER}>`,
      to: data.email,
      replyTo: OWNER_EMAIL,
      subject: 'Your appointment request is confirmed | US & LV India',
      html: buildCustomerEmail(data, timestamp),
      text: `Dear ${data.name},\n\nThank you for booking with US & LV India. We have received your request for ${data.service} and will contact you shortly on ${data.phone} to confirm your session.\n\nFor anything urgent, call +91 93803 76767 (Monday to Saturday, 9:00 AM to 6:00 PM).\n\nWarm regards,\nUS & LV India\nThe Growth Transformers\n`,
    });
  };

  const [saved, ownerMail, customerMail] = await Promise.allSettled([saveCopy(), sendOwnerEmail(), sendCustomerEmail()]);

  if (ownerMail.status === 'fulfilled') console.log('✅ Booking email sent to the owner. Message ID:', ownerMail.value.messageId);
  else if (EMAIL_ENABLED) console.error('❌ Failed to send email alert:', explainMailError(ownerMail.reason));

  if (customerMail.status === 'fulfilled' && customerMail.value) console.log(`✅ Confirmation email sent to ${mask(data.email)}.`);
  else if (customerMail.status === 'rejected') console.error('❌ Failed to send customer confirmation:', explainMailError(customerMail.reason));

  if (saved.status === 'rejected') console.error('❌ Failed to save booking copy:', saved.reason?.message);

  if (ownerMail.status === 'fulfilled') {
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
if (!process.argv.includes('--test-mail')) {
  const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log('📡 Listening for appointment bookings (from this site and from Live Server)...');
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
}

process.on('unhandledRejection', (reason) => console.error('❌ Unhandled rejection:', reason));
// At the bottom of src/server.js:
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 8080;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

// REQUIRED for Vercel:
export default app;
// Add this at the VERY BOTTOM of src/server.js
app.post('/book-appointment-fallback', async (req, res) => {
  try {
    const { name, phone, email, service, message } = req.body;
    
    // Direct email logic without touching previous code
    await transporter.sendMail({
      from: process.env.EMAIL_USER || 'rohitvikraanth2805@gmail.com',
      to: process.env.OWNER_EMAIL || 'rohitvikraanth2805@gmail.com',
      subject: `New Appointment Booking: ${name || 'Client'}`,
      text: `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nService: ${service}\nMessage: ${message}`
    });

    return res.status(200).json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Error sending email:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
import { Resend } from 'resend';
// 1. Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// 2. Erase the old Nodemailer route from the server's memory
app._router.stack = app._router.stack.filter(layer => !(layer.route && layer.route.path === '/book-appointment'));

// 3. Create the new, working Resend route
app.post('/book-appointment', async (req, res) => {
  try {
    const { name, email, phone, date, time } = req.body;
    
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev', 
      to: 'rohitvikraanth2805@gmail.com', // Must be your registered Resend email
      subject: 'New Appointment Booking',
      html: `<p>New booking from <b>${name}</b></p>
             <p>Email: ${email}</p>
             <p>Phone: ${phone}</p>
             <p>Date: ${date} at ${time}</p>`
    });

    if (error) {
      return res.status(400).json({ error });
    }

    res.status(200).json({ message: 'Booking successful', data });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

app.post('/book-appointment', async (req, res) => {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { name, email, phone, age, service, message } = req.body;

    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'rohitvikraanth2805@gmail.com',
      subject: `New Appointment Booking: ${name || 'Client'}`,
      html: `
        <h3>New Appointment Request</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Age:</strong> ${age}</p>
        <p><strong>Service:</strong> ${service}</p>
        <p><strong>Message:</strong> ${message}</p>
      `
    });

    return res.status(200).json({ success: true, message: 'Email sent successfully!' });
  } catch (error) {
    console.error('Resend Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});