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

const parseBooleanQuery = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    if (['true', '1', 'yes', 'on', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', 'n'].includes(normalized)) return false;
  }
  return null;
};

// GET /api/scanners - Fetch all scanners
router.get('/', async (req, res) => {
  try {
    const { featured, limit, brand, sort } = req.query;

    let query = supabase.from('scanners').select('*').order('id', { ascending: true });

    // Filter by featured if provided
    const featuredFilter = parseBooleanQuery(featured);
    if (featuredFilter !== null) {
      query = query.eq('featured', featuredFilter);
    }

    // Filter by brand if provided
    if (brand) {
      const brandValue = brand.toString().trim();
      if (brandValue) {
        query = query.eq('brand', brandValue);
      }
    }

    // Apply sorting
    if (sort) {
      const sortLower = sort.toString().trim().toLowerCase();
      if (sortLower === 'price_asc' || sortLower === 'price-low-high') {
        query = query.order('price', { ascending: true });
      } else if (sortLower === 'price_desc' || sortLower === 'price-high-low') {
        query = query.order('price', { ascending: false });
      }
    }

    // Apply limit if provided
    const parsedLimit = Number(limit);
    if (Number.isFinite(parsedLimit) && parsedLimit > 0) {
      query = query.limit(parsedLimit);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch scanners:', error);
      return res.status(500).json({ error: 'Failed to fetch scanners' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Unexpected error fetching scanners:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/scanners/:id - Fetch a single scanner by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.from('scanners').select('*').eq('id', id).single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Scanner not found' });
      }
      console.error('Failed to fetch scanner by id:', error);
      return res.status(500).json({ error: 'Failed to fetch scanner' });
    }

    res.json(data);
  } catch (err) {
    console.error('Unexpected error fetching scanner by id:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

