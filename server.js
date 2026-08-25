/**
 * Pinkxraliz Site - server.js
 * Express + SQLite + Paystack + AI helper
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');
const crypto = require('crypto');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!PAYSTACK_SECRET_KEY) {
  console.warn('PAYSTACK_SECRET_KEY not set. Payment calls will fail.');
}

// initialize db
const db = new sqlite3.Database('./ads.db');
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS ads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    owner_name TEXT,
    owner_email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    paid INTEGER DEFAULT 0,
    paystack_reference TEXT,
    active INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0
  )`);
});

// helper: run SQL with Promise
function runQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function allQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getQuery(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// pricing
const PRICE_NGN = 500; // base price for 7 days
const FEATURE_NGN = 200; // extra for featured ad
const PRICE_KOBO = PRICE_NGN * 100;
const FEATURE_KOBO = FEATURE_NGN * 100;

// Routes

// Create ad (no payment yet)
app.post('/ads', async (req, res) => {
  const { title, description, owner_name, owner_email, featured } = req.body;
  if (!title || !description || !owner_email) {
    return res.status(400).json({ error: 'title, description and owner_email required' });
  }
  try {
    const feat = featured === 'on' || featured === '1' || featured === 1 || featured === true ? 1 : 0;
    const result = await runQuery(
      `INSERT INTO ads (title, description, owner_name, owner_email, paid, active, featured) VALUES (?, ?, ?, ?, 0, 0, ?)`,
      [title, description, owner_name || '', owner_email, feat]
    );
    const adId = result.lastID;
    res.json({ success: true, id: adId, pay_url: `/ads/${adId}/pay` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

// Initialize Paystack transaction and return authorization URL
app.get('/ads/:id/pay', async (req, res) => {
  const id = req.params.id;
  try {
    const ad = await getQuery('SELECT * FROM ads WHERE id = ?', [id]);
    if (!ad) return res.status(404).send('Ad not found');
    const isFeatured = ad.featured ? 1 : 0;
    const amountKobo = PRICE_KOBO + (isFeatured ? FEATURE_KOBO : 0);
    // create transaction
    const payload = {
      email: ad.owner_email,
      amount: amountKobo,
      callback_url: `${BASE_URL}/ads/${id}/pay/callback`,
      metadata: { ad_id: id, featured: isFeatured }
    };
    const r = await axios.post('https://api.paystack.co/transaction/initialize', payload, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` }
    });
    const { authorization_url, reference } = r.data.data;
    // store reference (optional)
    await runQuery('UPDATE ads SET paystack_reference = ? WHERE id = ?', [reference, id]);
    // redirect user to Paystack payment page (or send URL to frontend)
    res.redirect(authorization_url);
  } catch (err) {
    console.error(err.response?.data || err.message || err);
    res.status(500).send('Payment initialization failed');
  }
});

// Optional callback page after payment redirect (Paystack will redirect here)
app.get('/ads/:id/pay/callback', async (req, res) => {
  res.send('Payment completed (you will receive an update). If your ad isn\'t visible yet, wait a minute for webhook processing.');
});

// Paystack webhook endpoint
app.post('/webhook/paystack', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const signature = req.headers['x-paystack-signature'];
  const bodyStr = req.body.toString();
  // verify signature
  if (!PAYSTACK_WEBHOOK_SECRET) {
    console.warn('PAYSTACK_WEBHOOK_SECRET not set; skipping signature verification');
  } else {
    const hmac = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET).update(bodyStr).digest('hex');
    if (hmac !== signature) {
      console.warn('Invalid signature on webhook');
      return res.status(400).send('Invalid signature');
    }
  }

  let payload;
  try {
    payload = JSON.parse(bodyStr);
  } catch (err) {
    console.error('invalid JSON payload');
    return res.status(400).send('invalid JSON');
  }

  const event = payload.event;
  // handle charge.success
  if (event === 'charge.success' || event === 'transaction.success') {
    const data = payload.data;
    const metadata = data.metadata || {};
    const adId = metadata.ad_id || null;
    const reference = data.reference || data.trxref || null;
    // If adId present, mark ad paid and set expires_at
    if (adId) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // +7 days
      try {
        await runQuery(
          'UPDATE ads SET paid = 1, active = 1, expires_at = ?, paystack_reference = ? WHERE id = ?',
          [expiresAt.toISOString(), reference, adId]
        );
        console.log(`Ad ${adId} marked paid and active until ${expiresAt.toISOString()}`);
      } catch (err) {
        console.error('db update error', err);
      }
    } else {
      console.log('Webhook charge.success received but no ad id in metadata');
    }
  }
  // Always respond 200 to Paystack quickly
  res.sendStatus(200);
});

// List ads (visible ones). Featured ads first.
app.get('/ads', async (req, res) => {
  const ads = await allQuery('SELECT id, title, description, owner_name, created_at, expires_at, featured FROM ads WHERE active = 1 AND paid = 1 ORDER BY featured DESC, created_at DESC');
  res.json(ads);
});

// View single ad (increment view count)
app.get('/ads/:id', async (req, res) => {
  const id = req.params.id;
  const ad = await getQuery('SELECT * FROM ads WHERE id = ?', [id]);
  if (!ad) return res.status(404).json({ error: 'not found' });
  try {
    await runQuery('UPDATE ads SET views = views + 1 WHERE id = ?', [id]);
  } catch (err) { console.error('could not increment views', err); }
  res.json(ad);
});

// Admin: list all ads (for moderation)
app.get('/admin/ads', async (req, res) => {
  const all = await allQuery('SELECT * FROM ads ORDER BY created_at DESC');
  res.json(all);
});

// Cron job: run daily to expire ads
cron.schedule('0 0 * * *', async () => {
  const nowISO = new Date().toISOString();
  try {
    const result = await runQuery('UPDATE ads SET active = 0 WHERE expires_at IS NOT NULL AND expires_at <= ?', [nowISO]);
    console.log('Daily expiry job ran at', new Date().toISOString());
  } catch (err) {
    console.error('cron expiry error', err);
  }
});

// Also expire ads on server start (in case cron has not run)
(async () => {
  const nowISO = new Date().toISOString();
  try {
    await runQuery('UPDATE ads SET active = 0 WHERE expires_at IS NOT NULL AND expires_at <= ?', [nowISO]);
  } catch (err) {
    console.error('initial expiry pass failed', err);
  }
})();

// AI helper endpoint: POST { message }
app.post('/ai', async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'message required' });

  if (OPENAI_API_KEY) {
    try {
      const resp = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are an assistant that helps users write concise, persuasive classified ads. Keep responses short and give a title suggestion and a 1-2 sentence description plus 3 quick tips.' },
          { role: 'user', content: message }
        ],
        max_tokens: 300
      }, {
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }
      });
      const reply = resp.data.choices[0].message.content;
      return res.json({ reply });
    } catch (err) {
      console.error('OpenAI error', err.response?.data || err.message || err);
      return res.status(500).json({ error: 'AI service error' });
    }
  }

  // fallback simple helper when no API key
  const title = message.split('\n')[0].slice(0, 60);
  const description = message.split('\n').slice(1).join(' ').slice(0, 300) || message.slice(0, 200);
  const tips = ['Put the price and location in the first line.', 'Use clear photos and a short, benefit-focused description.', 'Respond quickly to interested buyers.'];
  const reply = `Title suggestion: ${title}\n\nSuggested description: ${description}\n\nTips:\n- ${tips.join('\n- ')}`;
  res.json({ reply });
});

app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}, BASE_URL=${BASE_URL}`);
});
