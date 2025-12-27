const express = require('express');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const compression = require('compression');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
const db = require('./db_supabase');

require('dotenv').config();

const app = express();
app.disable('x-powered-by');

const PORT = process.env.PORT || 3002;
const IS_PROD = process.env.NODE_ENV === 'production';

const dataDir = path.join(__dirname, 'data');
const portfolioFile = path.join(dataDir, 'portfolio_data.json');
const messagesFile = path.join(dataDir, 'messages.json');
const invoicesFile = path.join(dataDir, 'invoices.json');
const adminAuthFile = path.join(dataDir, 'admin_auth.json');

const uploadsDir = path.join(__dirname, 'uploads');
const publicDir = path.join(__dirname, 'public');
const adminDir = path.join(__dirname, 'admin');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Secrets
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set (see .env.example)');
}

// Supabase (media storage)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'media';

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });
    console.log('[storage] Supabase Storage client initialised');
  } catch (e) {
    console.error('[storage] Failed to initialise Supabase client, falling back to local uploads:', e);
    supabase = null;
  }
} else {
  console.warn('[storage] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set; using local uploads/ folder');
}

// Helper: Client Reviews persistence in Supabase
async function getClientReviewsFromDB() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('client_reviews')
    .select('title, platform, post_url, comment_text, comment_author, thumbnail, created_at')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[reviews] getClientReviewsFromDB failed:', error);
    return [];
  }
  return (data || []).map(r => ({
    title: r.title || '',
    platform: r.platform || '',
    postUrl: r.post_url || '',
    commentText: r.comment_text || '',
    commentAuthor: r.comment_author || '',
    thumbnail: r.thumbnail || ''
  }));
}

async function syncClientHighlightsToDB(items) {
  if (!supabase || !Array.isArray(items)) return;
  // Replace all rows with current items to keep it simple and deterministic
  const { error: delError } = await supabase
    .from('client_reviews')
    .delete()
    .gte('id', 0); // delete all rows safely (ids are positive identity)
  if (delError) {
    console.error('[reviews] Failed to clear client_reviews table:', delError);
    return;
  }
  if (!items.length) return;
  const rows = items.map(it => ({
    title: it.title || '',
    platform: it.platform || '',
    post_url: it.postUrl || '',
    comment_text: it.commentText || '',
    comment_author: it.commentAuthor || '',
    thumbnail: it.thumbnail || ''
  }));
  const { error: insError } = await supabase.from('client_reviews').insert(rows);
  if (insError) {
    console.error('[reviews] Failed to insert client_reviews:', insError);
  }
}

// Brevo Email via HTTP API (contact-form email notifications)
const MAIL_FROM = String(process.env.MAIL_FROM || '').trim().replace(/^["']|["']$/g, '');
const MAIL_FROM_NAME = String(process.env.MAIL_FROM_NAME || '').trim();
const MAIL_TO = process.env.MAIL_TO || '';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '';

if (BREVO_API_KEY) {
  console.log('[mail] Brevo API key detected; emails will be sent via HTTP API');
} else {
  console.warn('[mail] BREVO_API_KEY not set; contact-form emails will be skipped');
}

// Helper for sending emails via Brevo HTTP API
function sendBrevoEmail({ toEmail, subject, text, html }) {
  if (!BREVO_API_KEY || !MAIL_FROM) {
    return Promise.reject(new Error('BREVO_API_KEY or MAIL_FROM missing'));
  }

  const payload = {
    sender: { name: MAIL_FROM_NAME || 'VR Productiox', email: MAIL_FROM },
    replyTo: { email: MAIL_FROM },
    to: [{ email: toEmail }],
    subject,
    textContent: text,
    htmlContent: html
  };

  const url = 'https://api.brevo.com/v3/smtp/email';
  const headers = {
    'api-key': BREVO_API_KEY,
    'Content-Type': 'application/json'
  };

  const maxAttempts = 3;

  async function attemptSend() {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        clearTimeout(timeout);

        const bodyText = await res.text();
        if (res.ok) {
          try {
            return bodyText ? JSON.parse(bodyText) : {};
          } catch {
            return {};
          }
        } else {
          console.error('[mail] Brevo send failed', res.status, bodyText);
          throw new Error(`Brevo send failed: ${res.status}`);
        }
      } catch (err) {
        lastErr = err;
        const transient =
          err && (err.name === 'AbortError' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT');

        if (attempt < maxAttempts && transient) {
          const backoffMs = 500 * attempt;
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        console.error('[mail] Brevo send error', err);
        throw err;
      }
    }
    throw lastErr || new Error('Unknown Brevo send error');
  }

  return attemptSend();
}

// Admin password storage: bcrypt hash persisted to data/admin_auth.json
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Failed to read', file, e);
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Supabase-backed admin auth (fallbacks to JSON if Supabase not configured)
async function ensureAdminAuth() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('admin_auth')
        .select('id, password_hash, updated_at')
        .eq('id', 1)
        .maybeSingle();

      if (error) {
        console.warn('[auth] Supabase admin_auth select failed (table missing or RLS?):', error.message || error);
      }

      if (data && data.password_hash) {
        return { passwordHash: data.password_hash, updatedAt: data.updated_at };
      }

      // Seed into Supabase from local JSON or ADMIN_PASSWORD
      const local = readJson(adminAuthFile, null);
      let passwordHash;
      if (local && typeof local.passwordHash === 'string' && local.passwordHash.length > 20) {
        passwordHash = local.passwordHash;
      } else {
        const initialPassword = process.env.ADMIN_PASSWORD;
        if (!initialPassword) {
          throw new Error('ADMIN_PASSWORD must be set to seed Supabase admin_auth');
        }
        passwordHash = bcrypt.hashSync(String(initialPassword), 12);
      }

      const now = new Date().toISOString();
      const { error: upsertError } = await supabase
        .from('admin_auth')
        .upsert({ id: 1, password_hash: passwordHash, updated_at: now }, { onConflict: 'id' });

      if (upsertError) {
        console.error('[auth] Supabase upsert admin_auth failed:', upsertError);
        throw new Error('Supabase admin_auth table missing or misconfigured');
      }

      console.log('[auth] Seeded admin_auth in Supabase (id=1)');
      return { passwordHash, updatedAt: now };
    } catch (e) {
      console.error('[auth] ensureAdminAuth (Supabase) crashed:', e);
      throw e;
    }
  }

  // Fallback to JSON file (local/dev)
  const stored = readJson(adminAuthFile, null);
  if (stored && typeof stored.passwordHash === 'string' && stored.passwordHash.length > 20) {
    return stored;
  }

  const initialPassword = process.env.ADMIN_PASSWORD;
  if (!initialPassword) {
    throw new Error('ADMIN_PASSWORD must be set for first run (it will be hashed into data/admin_auth.json)');
  }

  const passwordHash = bcrypt.hashSync(String(initialPassword), 12);
  const next = { passwordHash, updatedAt: new Date().toISOString() };
  writeJsonAtomic(adminAuthFile, next);
  console.log('[init] Created data/admin_auth.json from ADMIN_PASSWORD');
  return next;
}

async function verifyAdminPassword(password) {
  try {
    const auth = await ensureAdminAuth();
    return bcrypt.compareSync(String(password || ''), auth.passwordHash);
  } catch {
    return false;
  }
}

async function setAdminPassword(newPassword) {
  const passwordHash = bcrypt.hashSync(String(newPassword), 12);
  const next = { passwordHash, updatedAt: new Date().toISOString() };

  if (supabase) {
    const { error } = await supabase
      .from('admin_auth')
      .upsert({ id: 1, password_hash: next.passwordHash, updated_at: next.updatedAt }, { onConflict: 'id' });
    if (error) {
      console.error('[auth] Supabase setAdminPassword failed:', error);
      throw new Error('Failed to save admin password to Supabase');
    }
  } else {
    writeJsonAtomic(adminAuthFile, next);
  }

  return next;
}

// Middleware
// Compression should run before other middleware and routes so responses are gzipped where supported.
app.use(compression());

// HTTP request logging (skip health checks in production to reduce noise)
if (!IS_PROD) {
  app.use(morgan('dev'));
} else {
  app.use(
    morgan('combined', {
      skip: (req, res) => req.path === '/healthz'
    })
  );
}

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        // Allow inline styles (admin uses style="..."); keep scripts strict
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        "font-src": ["'self'", 'https://fonts.gstatic.com', 'data:'],
        "img-src": ["'self'", 'data:', 'https:'],
        "media-src": ["'self'", 'https:']
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Needs to be large enough for base64 uploads (admin panel). The upload route
// also enforces a decoded max-size check server-side.
app.use(express.json({ limit: '30mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false
});

// Messages limiter removed so every contact form submission reaches admin without rate limiting.
// const messagesLimiter = rateLimit({
//   windowMs: 10 * 60 * 1000,
//   limit: 25,
//   standardHeaders: true,
//   legacyHeaders: false
// });

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false
});

// Auth middleware (JWT)
function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}


const messageSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(10).max(4000)
});

function hasProhibitedLanguage(text) {
  if (!text) return false;
  const value = String(text).toLowerCase();
  const banned = [
    'fuck', 'f***', 'shit', 'bitch', 'bastard', 'slut', 'whore',
    'nigger', 'chutiya', 'madarchod', 'bhenchod', 'gaand', 'harami', 'BSDK', 'BC', 'Nudes', 'bsdk', 'bc', 'mkc', 'land ke', 'bad'
  ];
  return banned.some(word => value.includes(word));
}

const portfolioSchema = z.object({}).passthrough();

const messagePatchSchema = z
  .object({
    read: z.boolean().optional()
  })
  .strict();

const invoiceServiceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(800).optional().default(''),
  quantity: z.number().nonnegative().optional().default(0),
  rate: z.number().nonnegative().optional().default(0),
  amount: z.number().nonnegative().optional().default(0)
});

const invoiceCreateSchema = z
  .object({
    clientName: z.string().trim().min(1).max(200),
    clientEmail: z.string().trim().email().max(200).optional().or(z.literal('')).optional(),
    clientPhone: z.string().trim().max(80).optional().or(z.literal('')).optional(),
    clientAddress: z.string().trim().max(240).optional().or(z.literal('')).optional(),
    clientCity: z.string().trim().max(140).optional().or(z.literal('')).optional(),

    projectName: z.string().trim().min(1).max(200),
    projectId: z.string().trim().max(80).optional().or(z.literal('')).optional(),
    reference: z.string().trim().max(80).optional().or(z.literal('')).optional(),
    dueDate: z.string().trim().max(80).optional().or(z.literal('')).optional(),

    services: z.array(invoiceServiceSchema).min(1),

    additionalCharges: z
      .object({
        extraRevision: z.number().nonnegative().optional().default(0),
        expressDelivery: z.number().nonnegative().optional().default(0),
        addonsAmount: z.number().nonnegative().optional().default(0),
        addonsDescription: z.string().trim().max(300).optional().default('')
      })
      .optional()
      .default({}),

    summary: z
      .object({
        subtotal: z.number().nonnegative().optional().default(0),
        taxPercent: z.number().nonnegative().optional().default(0),
        taxAmount: z.number().nonnegative().optional().default(0),
        discount: z.number().nonnegative().optional().default(0),
        total: z.number().nonnegative().optional().default(0)
      })
      .optional()
      .default({}),

    currency: z.string().trim().max(10).optional().default(''),
    paymentStatus: z.enum(['unpaid', 'paid', 'partial']).optional().default('unpaid'),
    status: z.enum(['unpaid', 'paid', 'partial']).optional().default('unpaid'),
    paymentMethod: z.string().trim().max(80).optional().default(''),
    notes: z.string().trim().max(1200).optional().default(''),

    footer: z
      .object({
        businessName: z.string().trim().max(200).optional().default(''),
        contact: z.string().trim().max(300).optional().default(''),
        address: z.string().trim().max(240).optional().default(''),
        city: z.string().trim().max(140).optional().default(''),
        taxId: z.string().trim().max(80).optional().default(''),
        website: z.string().trim().max(120).optional().default(''),
        email: z.string().trim().max(120).optional().default(''),
        phone: z.string().trim().max(80).optional().default(''),
        terms: z.string().trim().max(2000).optional().default(''),
        refundPolicy: z.string().trim().max(2000).optional().default('')
      })
      .optional()
      .default({})
  })
  .passthrough();

const invoicePatchSchema = z
  .object({
    status: z.enum(['unpaid', 'paid', 'partial']).optional(),
    paymentStatus: z.enum(['unpaid', 'paid', 'partial']).optional(),
    paymentMethod: z.string().trim().max(80).optional(),
    notes: z.string().trim().max(1200).optional()
  })
  .strict();

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z.string().min(8).max(200)
  })
  .strict();

// Login route
app.post('/api/login', loginLimiter, async (req, res) => {
  const { password } = req.body || {};
  if (!(await verifyAdminPassword(password))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

// Change admin password (requires current password)
app.post('/api/admin/password', requireAdmin, async (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const { currentPassword, newPassword } = parsed.data;
  if (!(await verifyAdminPassword(currentPassword))) {
    return res.status(401).json({ error: 'Invalid current password' });
  }

  const info = await setAdminPassword(newPassword);
  res.json({ success: true, ...info });
});

// Portfolio: public GET used by script.js
app.get('/portfolio_data.json', async (req, res) => {
  try {
    const data = await db.getPortfolio();

    // Merge DB-backed client reviews if available
    try {
      const reviews = await getClientReviewsFromDB();
      if (Array.isArray(reviews) && reviews.length) {
        data.clientHighlights = reviews;
      }
    } catch (e) {
      console.warn('[reviews] Skipping DB reviews merge due to error:', e);
    }

    res.json(data);
  } catch (e) {
    console.error('Failed to get portfolio', e);
    res.status(500).json({ error: 'Failed to load portfolio' });
  }
});

// Portfolio: admin update
app.put('/api/portfolio', requireAdmin, async (req, res) => {
  const parsed = portfolioSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid portfolio payload' });

  try {
    await db.setPortfolio(parsed.data);

    // Persist client reviews to DB to avoid data loss
    const highlights = Array.isArray(parsed.data.clientHighlights) ? parsed.data.clientHighlights : [];
    syncClientHighlightsToDB(highlights).catch((e) => {
      console.error('[reviews] Sync clientHighlights to DB failed:', e);
    });

    res.json({ success: true });
  } catch (e) {
    console.error('Failed to save portfolio', e);
    res.status(500).json({ error: 'Failed to save portfolio' });
  }
});

// Media upload (images, video, etc.)
// Expects JSON: { fileName, content, folder? } where content is a data URL or base64 string
// If Supabase is configured, files are stored in remote object storage; otherwise local uploads/ is used.
app.post('/api/upload', requireAdmin, uploadLimiter, async (req, res) => {
  try {
    const { fileName, content, folder } = req.body || {};
    if (!fileName || !content) {
      return res.status(400).json({ error: 'fileName and content are required' });
    }

    const ext = String(path.extname(fileName || '')).toLowerCase();
    const allowedExt = new Set(['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif', '.mp4', '.mov', '.pdf']);
    if (!allowedExt.has(ext)) {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    // Basic sanitization of file name
    const safeName = Date.now().toString(36) + '-' + fileName.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // Restrict folders to prevent arbitrary path creation
    const requestedFolder = folder ? String(folder) : '';
    const safeFolder = ['images', 'videos', 'docs', 'branding'].includes(requestedFolder) ? requestedFolder : '';

    let base64 = String(content);
    const commaIndex = base64.indexOf(',');
    if (commaIndex !== -1) {
      base64 = base64.slice(commaIndex + 1);
    }

    const buffer = Buffer.from(base64, 'base64');

    // 15MB max decoded file size
    const maxBytes = 15 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      return res.status(413).json({ error: 'File too large' });
    }

    // If Supabase is configured, prefer remote object storage so media is not lost on redeploy.
    if (supabase) {
      const supabasePath = (safeFolder ? safeFolder + '/' : '') + safeName;

      // Very small mime-type map based on extension
      const mimeMap = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.jfif': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.pdf': 'application/pdf'
      };
      const contentType = mimeMap[ext] || 'application/octet-stream';

      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(supabasePath, buffer, {
          cacheControl: '31536000',
          upsert: false,
          contentType
        });

      if (uploadError) {
        console.error('[storage] Supabase upload failed, falling back to local uploads:', uploadError);
      } else {
        const { data: publicData } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(supabasePath);
        const publicUrl = publicData && publicData.publicUrl ? publicData.publicUrl : null;
        if (publicUrl) {
          return res.json({ success: true, url: publicUrl, fileName: safeName, storage: 'supabase' });
        }
      }
      // If we reach here, we fall through to local filesystem as a backup.
    }

    const targetDir = safeFolder ? path.join(uploadsDir, safeFolder) : uploadsDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, safeName);
    fs.writeFileSync(filePath, buffer);

    // Public URL path relative to site root
    const publicPath = '/uploads' + (safeFolder ? '/' + safeFolder : '') + '/' + safeName;

    res.json({ success: true, url: publicPath, fileName: safeName, storage: 'local' });
  } catch (e) {
    console.error('Upload failed', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Helper: send email notifications for contact messages (Brevo API only)
async function sendContactEmails(message) {
  if (!BREVO_API_KEY || !MAIL_FROM) return;

  const adminRecipient = MAIL_TO || MAIL_FROM;
  const fullName = `${message.first_name || ''} ${message.last_name || ''}`.trim() || 'Portfolio visitor';
  const safeSubject = String(message.subject || '').slice(0, 120) || 'New portfolio enquiry';

  const adminText = [
    'New contact message received from your portfolio site:',
    '',
    `Name: ${fullName}`,
    `Email: ${message.email || '-'}`,
    '',
    `Subject: ${message.subject || '-'}`,
    '',
    'Message:',
    String(message.message || '').trim(),
    '',
    `Received at: ${message.createdAt || new Date().toISOString()}`
  ].join('\n');

  const userBody = `Hello,

Thank you for contacting VR_Productiox.

We’ve received your project enquiry and will get back to you within 24–48 hours with more details.

Looking forward to connecting with you.

Best regards,
Vrutant Ratnapure
Video Editor & Cinematographer
VR_Productiox`;

  const tasks = [];

  // Send admin notification
  if (adminRecipient) {
    tasks.push(
      sendBrevoEmail({
        toEmail: adminRecipient,
        subject: `New portfolio enquiry: ${safeSubject}`,
        text: adminText,
        html: adminText.replace(/\n/g, '<br>')
      }).catch((e) => {
        console.error('[mail] Failed to send admin contact email via Brevo API', e);
      })
    );
  }

  // Send visitor confirmation
  if (message.email) {
    tasks.push(
      sendBrevoEmail({
        toEmail: message.email,
        subject: 'Thank you for contacting VR_Productiox',
        text: userBody,
        html: userBody.replace(/\n/g, '<br>')
      }).catch((e) => {
        console.error('[mail] Failed to send confirmation email to visitor via Brevo API', e);
      })
    );
  }

  await Promise.allSettled(tasks);
}

// Messages API
app.post('/api/messages', async (req, res) => {
  const parsed = messageSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid message payload' });
  }

  // No language filtering or rate limiting so every valid message reaches the admin.
  const id = 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const createdAt = new Date().toISOString();
  const msg = { id, read: false, createdAt, ...parsed.data };

  try {
    await db.insertMessage(msg);

    // Fire-and-forget email notifications; do not fail the request if SMTP is misconfigured
    sendContactEmails(msg).catch((e) => {
      console.error('[mail] Contact email pipeline failed', e);
    });

    res.json({ success: true, id });
  } catch (e) {
    console.error('Failed to save message', e);
    res.status(500).json({ error: 'Failed to save message' });
  }
});

app.get('/api/messages', requireAdmin, async (req, res) => {
  try {
    const messages = await db.getMessages();
    res.json(messages);
  } catch (e) {
    console.error('Failed to load messages', e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

app.patch('/api/messages/:id', requireAdmin, async (req, res) => {
  const parsed = messagePatchSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const { id } = req.params;
  try {
    const ok = await db.updateMessage(id, parsed.data);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to update message', e);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

app.delete('/api/messages/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await db.deleteMessage(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to delete message', e);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

// Invoices API
app.get('/api/invoices', requireAdmin, async (req, res) => {
  try {
    const invoices = await db.getInvoices();
    res.json(invoices);
  } catch (e) {
    console.error('Failed to load invoices', e);
    res.status(500).json({ error: 'Failed to load invoices' });
  }
});

app.post('/api/invoices', requireAdmin, async (req, res) => {
  const parsed = invoiceCreateSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid invoice payload' });

  const now = new Date().toISOString();
  const id = 'inv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const inv = {
    id,
    createdAt: now,
    status: parsed.data.status || parsed.data.paymentStatus || 'unpaid',
    ...parsed.data
  };

  try {
    await db.insertInvoice(inv);
    res.json({ success: true, id });
  } catch (e) {
    console.error('Failed to create invoice', e);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

app.patch('/api/invoices/:id', requireAdmin, async (req, res) => {
  const parsed = invoicePatchSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

  const { id } = req.params;
  try {
    const ok = await db.patchInvoice(id, parsed.data);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to update invoice', e);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// Delete invoice
app.delete('/api/invoices/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await db.deleteInvoice(id);
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (e) {
    console.error('Failed to delete invoice', e);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

// Invoice PDF download with modern A4 SaaS-style layout
app.get('/api/invoices/:id/pdf', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const inv = await db.getInvoiceById(id);
    if (!inv) return res.status(404).json({ error: 'Not found' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.pdf"`);

    const footer = inv.footer || {};
    const logoUrl = footer.logoUrl ? String(footer.logoUrl) : '';
    const logoPathFallback = path.join(publicDir, 'logo.jpg');
    const logoPathFromUploads = (() => {
      if (!logoUrl) return null;
      if (!logoUrl.startsWith('/uploads/')) return null;
      const rel = logoUrl.replace(/^\//, '');
      const resolved = path.resolve(__dirname, rel);
      const uploadsRoot = path.resolve(uploadsDir);
      const withinUploads = resolved === uploadsRoot || resolved.startsWith(uploadsRoot + path.sep);
      if (!withinUploads) return null;
      return resolved;
    })();

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, left: 48, right: 48, bottom: 64 }
    });

    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const marginLeft = doc.page.margins.left;
    const marginRight = doc.page.margins.right;
    const contentWidth = pageWidth - marginLeft - marginRight;

    const primaryBlue = '#4F6EF7';
    const textBlack = '#111827';
    const textSecondary = '#6B7280';
    const borderColor = '#E5E7EB';

    const currencyCode = (inv.currency || 'US$').trim();
    const formatMoney = (value) => `${currencyCode} ${Number(value || 0).toFixed(2)}`;

    const clientName = inv.clientName || '';
    const clientAddress = inv.clientAddress || '';
    const clientCity = inv.clientCity || '';

    const businessName = footer.businessName || 'VR PRODUCTIONS';
    const businessAddress = footer.address || 'Nagpur, Maharashtra, India';
    const businessCity = footer.city || 'Nagpur, Maharashtra, India';
    const footerWebsite = footer.website || '';
    const footerEmail = footer.email || '';
    const footerPhone = footer.phone || '';

    const createdAt = inv.createdAt ? new Date(inv.createdAt) : new Date();
    const invoiceDate = (inv.invoiceDate && String(inv.invoiceDate).trim())
      ? String(inv.invoiceDate).trim()
      : createdAt.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

    const baseDueDate = createdAt;
    const explicitDue = inv.dueDate && String(inv.dueDate).trim();
    const dueDateObj = explicitDue ? new Date(explicitDue) : new Date(baseDueDate.getTime() + 15 * 24 * 60 * 60 * 1000);
    const dueDate = dueDateObj.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

    const invoiceNumber = inv.projectId || inv.id;
    const reference = (inv.reference && String(inv.reference).trim()) || invoiceNumber;

    const services = Array.isArray(inv.services) ? inv.services : [];

    let subtotal = 0;
    services.forEach((s) => {
      const amount = s.amount != null ? Number(s.amount) : (Number(s.quantity || 0) * Number(s.rate || 0));
      if (!Number.isNaN(amount)) subtotal += amount;
    });

    const taxPercent = 10;
    const taxAmount = subtotal * taxPercent / 100;
    const total = subtotal + taxAmount;

    // TOP LEFT: INVOICE title
    let cursorY = doc.page.margins.top;
    doc.fillColor(textBlack).font('Helvetica-Bold').fontSize(26).text('INVOICE', marginLeft, cursorY, {
      width: contentWidth / 2,
      align: 'left'
    });

    // TOP RIGHT: Logo + company info
    const rightBlockWidth = contentWidth / 2;
    const rightBlockX = pageWidth - marginRight - rightBlockWidth;

    let rightY = cursorY;
    try {
      const lp = (logoPathFromUploads && fs.existsSync(logoPathFromUploads))
        ? logoPathFromUploads
        : (fs.existsSync(logoPathFallback) ? logoPathFallback : null);
      if (lp) {
        const logoWidth = 72;
        doc.image(lp, rightBlockX + rightBlockWidth - logoWidth, rightY, { width: logoWidth });
        rightY += 72 + 8;
      }
    } catch {
      // ignore logo errors
    }

    doc.fillColor(primaryBlue).font('Helvetica-Bold').fontSize(12)
      .text(businessName, rightBlockX, rightY, { width: rightBlockWidth, align: 'right' });
    rightY += 18;

    doc.fillColor(textSecondary).font('Helvetica').fontSize(9);
    if (businessAddress) {
      doc.text(businessAddress, rightBlockX, rightY, { width: rightBlockWidth, align: 'right' });
      rightY += 14;
    }
    if (businessCity) {
      doc.text(businessCity, rightBlockX, rightY, { width: rightBlockWidth, align: 'right' });
      rightY += 14;
    }

    // BILLED TO
    cursorY += 64;
    doc.fillColor(textSecondary).font('Helvetica').fontSize(9)
      .text('Billed to', marginLeft, cursorY);
    cursorY += 14;

    doc.fillColor(textBlack).font('Helvetica-Bold').fontSize(11)
      .text(clientName || '', marginLeft, cursorY, { width: contentWidth / 2 });
    cursorY += 16;

    doc.fillColor(textSecondary).font('Helvetica').fontSize(9);
    if (clientAddress) {
      doc.text(clientAddress, marginLeft, cursorY, { width: contentWidth / 2 });
      cursorY += 14;
    }
    if (clientCity) {
      doc.text(clientCity, marginLeft, cursorY, { width: contentWidth / 2 });
      cursorY += 14;
    }

    // LEFT META DATA COLUMN
    cursorY += 12;
    const metaX = marginLeft;
    let metaY = cursorY;

    const metaRow = (label, value) => {
      doc.fillColor(textSecondary).font('Helvetica').fontSize(9)
        .text(label, metaX, metaY);
      metaY += 12;
      doc.fillColor(textBlack).font('Helvetica-Bold').fontSize(10)
        .text(value || '-', metaX, metaY);
      metaY += 20;
    };

    metaRow('Invoice #', invoiceNumber || '-');
    metaRow('Invoice date', invoiceDate || '-');
    metaRow('Reference', reference || '-');
    metaRow('Due date', dueDate || '-');

    // SERVICES TABLE
    // Position table just below the meta block to avoid overlap
    const tableTop = metaY + 16;
    const tableX = marginLeft;
    const rowHeight = 22;
    const headerHeight = 24;

    // Limit number of visible service rows to keep everything on a single page
    const maxRows = 10;
    const visibleServices = services.slice(0, maxRows);
    const bodyHeight = Math.max(1, visibleServices.length) * rowHeight + 8;
    const tableHeight = headerHeight + bodyHeight + 8;

    const servicesColWidth = contentWidth * 0.5;
    const qtyColWidth = contentWidth * 0.1;
    const rateColWidth = contentWidth * 0.2;
    const totalColWidth = contentWidth * 0.2;

    const qtyX = tableX + servicesColWidth;
    const rateX = qtyX + qtyColWidth;
    const lineTotalX = rateX + rateColWidth;

    doc.lineWidth(1).strokeColor(borderColor).roundedRect(tableX, tableTop, contentWidth, tableHeight, 6).stroke();

    const headerY = tableTop + 10;
    doc.fillColor(textSecondary).font('Helvetica-Bold').fontSize(9);
    doc.text('Services', tableX + 12, headerY, { width: servicesColWidth - 24, align: 'left', lineBreak: false });
    doc.text('Qty', qtyX, headerY, { width: qtyColWidth, align: 'center', lineBreak: false });
    doc.text('Rate', rateX, headerY, { width: rateColWidth - 8, align: 'right', lineBreak: false });
    doc.text('Line total', lineTotalX, headerY, { width: totalColWidth - 8, align: 'right', lineBreak: false });

    let rowY = headerY + headerHeight - 6;
    doc.strokeColor(borderColor).moveTo(tableX, rowY).lineTo(tableX + contentWidth, rowY).stroke();

    doc.font('Helvetica').fontSize(9).fillColor(textBlack);
    visibleServices.forEach((s, index) => {
      const y = rowY + 4 + index * rowHeight;
      const name = (s.name || '').trim();
      const qtyVal = s.quantity != null ? String(s.quantity) : '';
      const rateVal = s.rate != null ? formatMoney(s.rate) : '';
      const amountVal = s.amount != null ? formatMoney(s.amount) : formatMoney((s.quantity || 0) * (s.rate || 0));

      doc.text(name, tableX + 12, y, {
        width: servicesColWidth - 24,
        align: 'left',
        lineBreak: false
      });
      doc.fillColor(textSecondary).text(qtyVal, qtyX, y, {
        width: qtyColWidth,
        align: 'center',
        lineBreak: false
      });
      doc.fillColor(textBlack).text(rateVal, rateX, y, {
        width: rateColWidth - 8,
        align: 'right',
        lineBreak: false
      });
      doc.text(amountVal, lineTotalX, y, {
        width: totalColWidth - 8,
        align: 'right',
        lineBreak: false
      });

      doc.strokeColor(borderColor)
        .moveTo(tableX, y + rowHeight)
        .lineTo(tableX + contentWidth, y + rowHeight)
        .stroke();
    });

    // TOTALS (BOTTOM RIGHT)
    const totalsX = tableX + contentWidth - 220;
    const totalsY = tableTop + tableHeight + 24;

    const lineTotals = (label, value, opts = {}) => {
      const { bold = false, color = textSecondary } = opts;
      doc.fillColor(color).font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(label, totalsX, totalsY + (opts.offsetY || 0), { width: 120, align: 'left' });
      doc.text(value, totalsX + 120, totalsY + (opts.offsetY || 0), { width: 100, align: 'right' });
    };

    lineTotals('Subtotal', formatMoney(subtotal), { offsetY: 0, color: textBlack });
    lineTotals(`Tax (${taxPercent}%)`, formatMoney(taxAmount), { offsetY: 18, color: textBlack });
    lineTotals('Total due', formatMoney(total), { offsetY: 40, bold: true, color: primaryBlue });

    // PAYMENT NOTE (CENTERED)
    const noteY = totalsY + 72;
    doc.fillColor(textSecondary).font('Helvetica-Oblique').fontSize(9)
      .text('Please pay within 15 days of receiving this invoice.', marginLeft, noteY, {
        width: contentWidth,
        align: 'center',
        lineBreak: false
      });

    // FOOTER CONTACT (BOTTOM) — keep safely within bottom margin so it never flows to a new page
    const footerY = pageHeight - doc.page.margins.bottom - 20;
    doc.fillColor(textSecondary).font('Helvetica').fontSize(8);

    if (footerWebsite) {
      doc.text(footerWebsite, marginLeft, footerY, { width: contentWidth / 3, align: 'left' });
    }
    if (footerPhone) {
      doc.text(footerPhone, marginLeft + contentWidth / 3, footerY, { width: contentWidth / 3, align: 'center' });
    }
    if (footerEmail) {
      doc.text(footerEmail, marginLeft + (2 * contentWidth) / 3, footerY, { width: contentWidth / 3, align: 'right' });
    }

    doc.end();
  } catch (e) {
    console.error('Failed to generate invoice PDF', e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate invoice PDF' });
    }
  }
});

app.get('/healthz', (req, res) => {
  res.json({ ok: true });
});

// Serve only static assets from /public and the admin UI from /admin.
// This prevents accidentally exposing server.js, package.json, or data/.
app.use('/uploads', express.static(uploadsDir, { fallthrough: true }));
app.use('/admin', express.static(adminDir, { fallthrough: true }));
app.use('/', express.static(publicDir, {
  fallthrough: true,
  setHeaders: (res, filePath) => {
    // Avoid caching HTML so edits reflect quickly
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    // Cache assets for a bit
    res.setHeader('Cache-Control', 'public, max-age=604800');
  }
}));

// Central error handler (must be after all routes/middleware)
// Ensures unexpected errors return a clean JSON response instead of crashing the process.
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`\n[error] Port ${PORT} is already in use.`);
    console.error('Close the other process using this port, or set PORT in .env (e.g. PORT=3001).\n');
    process.exit(1);
  }
  throw err;
});
