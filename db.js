const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
const portfolioFile = path.join(dataDir, 'portfolio_data.json');
const messagesFile = path.join(dataDir, 'messages.json');
const invoicesFile = path.join(dataDir, 'invoices.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[db] Failed to read JSON', file, e);
    return fallback;
  }
}

const dbPath = path.join(dataDir, 'app.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    subject TEXT,
    message TEXT,
    read INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL,
    status TEXT,
    paymentStatus TEXT,
    paymentMethod TEXT,
    currency TEXT,
    total REAL,
    data TEXT NOT NULL
  );
`);

function migratePortfolioIfEmpty() {
  const row = db.prepare('SELECT id FROM portfolio WHERE id = 1').get();
  if (row) return;

  const json = safeReadJson(portfolioFile, {});
  const now = new Date().toISOString();
  db.prepare('INSERT INTO portfolio (id, data, updatedAt) VALUES (1, ?, ?)')
    .run(JSON.stringify(json), now);
}

function migrateMessagesIfEmpty() {
  const row = db.prepare('SELECT id FROM messages LIMIT 1').get();
  if (row) return;

  const arr = safeReadJson(messagesFile, []);
  if (!Array.isArray(arr) || !arr.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO messages
      (id, first_name, last_name, email, subject, message, read, createdAt)
    VALUES (@id, @first_name, @last_name, @email, @subject, @message, @read, @createdAt)
  `);

  const tx = db.transaction((items) => {
    for (const m of items) {
      const row = {
        id: m.id,
        first_name: m.first_name || '',
        last_name: m.last_name || '',
        email: m.email || '',
        subject: m.subject || '',
        message: m.message || '',
        read: m.read ? 1 : 0,
        createdAt: m.createdAt || new Date().toISOString()
      };
      if (row.id) insert.run(row);
    }
  });

  tx(arr);
}

function migrateInvoicesIfEmpty() {
  const row = db.prepare('SELECT id FROM invoices LIMIT 1').get();
  if (row) return;

  const arr = safeReadJson(invoicesFile, []);
  if (!Array.isArray(arr) || !arr.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO invoices
      (id, createdAt, status, paymentStatus, paymentMethod, currency, total, data)
    VALUES (@id, @createdAt, @status, @paymentStatus, @paymentMethod, @currency, @total, @data)
  `);

  const tx = db.transaction((items) => {
    for (const inv of items) {
      if (!inv || !inv.id) continue;
      const summary = inv.summary || {};
      const total = Number(summary.total || 0) || 0;
      const row = {
        id: inv.id,
        createdAt: inv.createdAt || new Date().toISOString(),
        status: inv.status || inv.paymentStatus || 'unpaid',
        paymentStatus: inv.paymentStatus || inv.status || 'unpaid',
        paymentMethod: inv.paymentMethod || '',
        currency: inv.currency || '',
        total,
        data: JSON.stringify(inv)
      };
      insert.run(row);
    }
  });

  tx(arr);
}

migratePortfolioIfEmpty();
migrateMessagesIfEmpty();
migrateInvoicesIfEmpty();

function getPortfolio() {
  const row = db.prepare('SELECT data FROM portfolio WHERE id = 1').get();
  if (!row) return {};
  try {
    return JSON.parse(row.data);
  } catch {
    return {};
  }
}

function setPortfolio(data) {
  const now = new Date().toISOString();
  const json = JSON.stringify(data || {});
  db.prepare(`
    INSERT INTO portfolio (id, data, updatedAt)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data = excluded.data, updatedAt = excluded.updatedAt
  `).run(json, now);
}

function getMessages() {
  const rows = db.prepare('SELECT * FROM messages ORDER BY datetime(createdAt) ASC').all();
  return rows.map(r => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    subject: r.subject,
    message: r.message,
    read: !!r.read,
    createdAt: r.createdAt
  }));
}

function insertMessage(msg) {
  const row = {
    id: msg.id,
    first_name: msg.first_name || '',
    last_name: msg.last_name || '',
    email: msg.email || '',
    subject: msg.subject || '',
    message: msg.message || '',
    read: msg.read ? 1 : 0,
    createdAt: msg.createdAt || new Date().toISOString()
  };
  db.prepare(`
    INSERT INTO messages
      (id, first_name, last_name, email, subject, message, read, createdAt)
    VALUES (@id, @first_name, @last_name, @email, @subject, @message, @read, @createdAt)
  `).run(row);
}

function updateMessage(id, patch) {
  if (!id) return false;
  const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  if (!row) return false;

  const read = typeof patch.read === 'boolean' ? (patch.read ? 1 : 0) : row.read;
  db.prepare('UPDATE messages SET read = ? WHERE id = ?').run(read, id);
  return true;
}

function deleteMessage(id) {
  if (!id) return false;
  const info = db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  return info.changes > 0;
}

function getInvoices() {
  const rows = db.prepare('SELECT data FROM invoices ORDER BY datetime(createdAt) ASC').all();
  const out = [];
  for (const r of rows) {
    try {
      const obj = JSON.parse(r.data);
      if (obj && typeof obj === 'object') out.push(obj);
    } catch {
      // ignore bad rows
    }
  }
  return out;
}

function getInvoiceById(id) {
  if (!id) return null;
  const row = db.prepare('SELECT data FROM invoices WHERE id = ?').get(id);
  if (!row) return null;
  try {
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function insertInvoice(inv) {
  const summary = inv.summary || {};
  const total = Number(summary.total || 0) || 0;
  const row = {
    id: inv.id,
    createdAt: inv.createdAt || new Date().toISOString(),
    status: inv.status || inv.paymentStatus || 'unpaid',
    paymentStatus: inv.paymentStatus || inv.status || 'unpaid',
    paymentMethod: inv.paymentMethod || '',
    currency: inv.currency || '',
    total,
    data: JSON.stringify(inv)
  };

  db.prepare(`
    INSERT INTO invoices
      (id, createdAt, status, paymentStatus, paymentMethod, currency, total, data)
    VALUES (@id, @createdAt, @status, @paymentStatus, @paymentMethod, @currency, @total, @data)
  `).run(row);
}

function patchInvoice(id, patch) {
  if (!id) return false;
  const row = db.prepare('SELECT data FROM invoices WHERE id = ?').get(id);
  if (!row) return false;
  let obj;
  try {
    obj = JSON.parse(row.data);
  } catch {
    return false;
  }

  const next = { ...obj, ...patch };
  const summary = next.summary || {};
  const total = Number(summary.total || 0) || 0;

  const updateRow = {
    id,
    status: next.status || next.paymentStatus || 'unpaid',
    paymentStatus: next.paymentStatus || next.status || 'unpaid',
    paymentMethod: next.paymentMethod || '',
    currency: next.currency || '',
    total,
    data: JSON.stringify(next)
  };

  db.prepare(`
    UPDATE invoices
    SET status = @status,
        paymentStatus = @paymentStatus,
        paymentMethod = @paymentMethod,
        currency = @currency,
        total = @total,
        data = @data
    WHERE id = @id
  `).run(updateRow);

  return true;
}

function deleteInvoice(id) {
  if (!id) return false;
  const info = db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
  return info.changes > 0;
}

module.exports = {
  getPortfolio,
  setPortfolio,
  getMessages,
  insertMessage,
  updateMessage,
  deleteMessage,
  getInvoices,
  getInvoiceById,
  insertInvoice,
  patchInvoice,
  deleteInvoice
};
