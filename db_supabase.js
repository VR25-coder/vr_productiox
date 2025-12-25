const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

require('dotenv').config();

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
    console.error('[db_supabase] Failed to read JSON', file, e);
    return fallback;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || 'public';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to use Supabase persistence');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

async function migratePortfolioIfEmpty() {
  try {
    const { data, error } = await supabase
      .from('portfolio')
      .select('id')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.error('[db_supabase] Failed to query portfolio for migration', error);
      return;
    }
    if (data) return; // already seeded

    const json = safeReadJson(portfolioFile, {});
    const now = new Date().toISOString();
    const row = { id: 1, data: json, updated_at: now };

    const { error: insertError } = await supabase
      .from('portfolio')
      .upsert(row, { onConflict: 'id' });

    if (insertError) {
      console.error('[db_supabase] Failed to migrate portfolio from JSON', insertError);
    } else {
      console.log('[db_supabase] Migrated initial portfolio_data.json into Supabase');
    }
  } catch (e) {
    console.error('[db_supabase] migratePortfolioIfEmpty crashed', e);
  }
}

async function migrateMessagesIfEmpty() {
  try {
    const { data, error } = await supabase
      .from('messages')
      .select('id')
      .limit(1);

    if (error) {
      console.error('[db_supabase] Failed to query messages for migration', error);
      return;
    }
    if (data && data.length) return; // already seeded

    const arr = safeReadJson(messagesFile, []);
    if (!Array.isArray(arr) || !arr.length) return;

    const rows = arr
      .filter((m) => m && m.id)
      .map((m) => ({
        id: m.id,
        first_name: m.first_name || '',
        last_name: m.last_name || '',
        email: m.email || '',
        subject: m.subject || '',
        message: m.message || '',
        read: !!m.read,
        created_at: m.createdAt || new Date().toISOString()
      }));

    if (!rows.length) return;

    const { error: insertError } = await supabase
      .from('messages')
      .insert(rows, { onConflict: 'id', ignoreDuplicates: true });

    if (insertError) {
      console.error('[db_supabase] Failed to migrate messages from JSON', insertError);
    } else {
      console.log('[db_supabase] Migrated initial messages.json into Supabase');
    }
  } catch (e) {
    console.error('[db_supabase] migrateMessagesIfEmpty crashed', e);
  }
}

async function migrateInvoicesIfEmpty() {
  try {
    const { data, error } = await supabase
      .from('invoices')
      .select('id')
      .limit(1);

    if (error) {
      console.error('[db_supabase] Failed to query invoices for migration', error);
      return;
    }
    if (data && data.length) return; // already seeded

    const arr = safeReadJson(invoicesFile, []);
    if (!Array.isArray(arr) || !arr.length) return;

    const rows = arr
      .filter((inv) => inv && inv.id)
      .map((inv) => {
        const summary = inv.summary || {};
        const total = Number(summary.total || 0) || 0;
        return {
          id: inv.id,
          created_at: inv.createdAt || new Date().toISOString(),
          status: inv.status || inv.paymentStatus || 'unpaid',
          payment_status: inv.paymentStatus || inv.status || 'unpaid',
          payment_method: inv.paymentMethod || '',
          currency: inv.currency || '',
          total,
          data: inv
        };
      });

    if (!rows.length) return;

    const { error: insertError } = await supabase
      .from('invoices')
      .insert(rows, { onConflict: 'id', ignoreDuplicates: true });

    if (insertError) {
      console.error('[db_supabase] Failed to migrate invoices from JSON', insertError);
    } else {
      console.log('[db_supabase] Migrated initial invoices.json into Supabase');
    }
  } catch (e) {
    console.error('[db_supabase] migrateInvoicesIfEmpty crashed', e);
  }
}

// Fire-and-forget migrations on startup
(async () => {
  await migratePortfolioIfEmpty();
  await migrateMessagesIfEmpty();
  await migrateInvoicesIfEmpty();
})();

async function getPortfolio() {
  const { data, error } = await supabase
    .from('portfolio')
    .select('data')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[db_supabase] getPortfolio failed', error);
    return {};
  }
  if (!data || !data.data || typeof data.data !== 'object') return {};
  return data.data;
}

async function setPortfolio(value) {
  const now = new Date().toISOString();
  const row = { id: 1, data: value || {}, updated_at: now };
  const { error } = await supabase
    .from('portfolio')
    .upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('[db_supabase] setPortfolio failed', error);
    throw error;
  }
}

async function getMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[db_supabase] getMessages failed', error);
    return [];
  }

  return (data || []).map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    subject: r.subject,
    message: r.message,
    read: !!r.read,
    createdAt: r.created_at
  }));
}

async function insertMessage(msg) {
  const row = {
    id: msg.id,
    first_name: msg.first_name || '',
    last_name: msg.last_name || '',
    email: msg.email || '',
    subject: msg.subject || '',
    message: msg.message || '',
    read: !!msg.read,
    created_at: msg.createdAt || new Date().toISOString()
  };

  const { error } = await supabase
    .from('messages')
    .insert(row);

  if (error) {
    console.error('[db_supabase] insertMessage failed', error);
    throw error;
  }
}

async function updateMessage(id, patch) {
  if (!id) return false;

  if (typeof patch.read === 'undefined') return true; // nothing to update

  const updates = { read: !!patch.read };
  const { data, error } = await supabase
    .from('messages')
    .update(updates)
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[db_supabase] updateMessage failed', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

async function deleteMessage(id) {
  if (!id) return false;
  const { data, error } = await supabase
    .from('messages')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[db_supabase] deleteMessage failed', error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

async function getInvoices() {
  const { data, error } = await supabase
    .from('invoices')
    .select('data')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[db_supabase] getInvoices failed', error);
    return [];
  }

  const out = [];
  for (const r of data || []) {
    if (r && r.data && typeof r.data === 'object') {
      out.push(r.data);
    }
  }
  return out;
}

async function getInvoiceById(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('invoices')
    .select('data')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[db_supabase] getInvoiceById failed', error);
    return null;
  }
  if (!data || !data.data || typeof data.data !== 'object') return null;
  return data.data;
}

async function insertInvoice(inv) {
  const summary = inv.summary || {};
  const total = Number(summary.total || 0) || 0;
  const row = {
    id: inv.id,
    created_at: inv.createdAt || new Date().toISOString(),
    status: inv.status || inv.paymentStatus || 'unpaid',
    payment_status: inv.paymentStatus || inv.status || 'unpaid',
    payment_method: inv.paymentMethod || '',
    currency: inv.currency || '',
    total,
    data: inv
  };

  const { error } = await supabase
    .from('invoices')
    .insert(row);

  if (error) {
    console.error('[db_supabase] insertInvoice failed', error);
    throw error;
  }
}

async function patchInvoice(id, patch) {
  if (!id) return false;

  const { data: existing, error: getError } = await supabase
    .from('invoices')
    .select('data')
    .eq('id', id)
    .maybeSingle();

  if (getError) {
    console.error('[db_supabase] patchInvoice fetch failed', getError);
    return false;
  }
  if (!existing || !existing.data || typeof existing.data !== 'object') return false;

  const obj = existing.data;
  const next = { ...obj, ...patch };
  const summary = next.summary || {};
  const total = Number(summary.total || 0) || 0;

  const updateRow = {
    status: next.status || next.paymentStatus || 'unpaid',
    payment_status: next.paymentStatus || next.status || 'unpaid',
    payment_method: next.paymentMethod || '',
    currency: next.currency || '',
    total,
    data: next
  };

  const { data: updated, error: updateError } = await supabase
    .from('invoices')
    .update(updateRow)
    .eq('id', id)
    .select('id');

  if (updateError) {
    console.error('[db_supabase] patchInvoice update failed', updateError);
    return false;
  }

  return Array.isArray(updated) && updated.length > 0;
}

async function deleteInvoice(id) {
  if (!id) return false;
  const { data, error } = await supabase
    .from('invoices')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    console.error('[db_supabase] deleteInvoice failed', error);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
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
