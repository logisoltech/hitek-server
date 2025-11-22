const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://svyrkggjjkbxsbvumfxj.supabase.co';
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2eXJrZ2dqamtieHNidnVtZnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODgyNTEsImV4cCI6MjA3Nzg2NDI1MX0.1aRKA1GT8nM2eNKF6-bqQV9K40vP7cRSxuj-QtbpO0g';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const normalize = (value) => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

router.post('/login', async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    const normalizedIdentifier = normalize(identifier);

    const { data, error } = await supabase.from('cmsusers').select('*');

    if (error) {
      console.error('Failed to fetch CMS users:', error);
      return res.status(500).json({ error: 'Failed to authenticate. Please try again.' });
    }

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = data.find((user) => {
      const possibleIdentifiers = [
        user.email,
        user.username,
        user.user_name,
        user.handle,
        user.login,
      ]
        .map(normalize)
        .filter(Boolean);
      return possibleIdentifiers.includes(normalizedIdentifier);
    });

    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const storedPassword = typeof match.password === 'string' ? match.password.trim() : '';
    if (storedPassword.length === 0) {
      console.error('CMS user record missing password field.');
      return res.status(500).json({ error: 'CMS user record is misconfigured.' });
    }

    const incomingPassword = password.trim();
    if (incomingPassword !== storedPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { password: _password, ...cmsUser } = match;
    const session = {
      access_token: `cms_${Date.now()}`,
      user: {
        id: cmsUser.id,
        email: cmsUser.email || null,
        username: cmsUser.username || cmsUser.user_name || null,
      },
    };

    return res.json({
      user: cmsUser,
      session,
    });
  } catch (err) {
    console.error('Unexpected CMS login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;


