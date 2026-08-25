-- Run this once (or the server auto-creates the table if missing)
CREATE TABLE IF NOT EXISTS ads (
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
);
