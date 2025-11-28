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

// Helper function to get user info from request headers
const getUserFromRequest = (req) => {
  // Try to get user info from headers (sent by CMS frontend)
  const userId = req.headers['x-cms-user-id'] || req.body?.cmsUserId || null;
  const userName = req.headers['x-cms-user-name'] || req.body?.cmsUserName || null;
  const userRole = req.headers['x-cms-user-role'] || req.body?.cmsUserRole || null;
  
  return {
    userId: userId ? parseInt(userId) : null,
    userName: userName || 'System',
    userRole: userRole || null,
  };
};

// Helper function to log activity (can be imported by other routes)
const logActivity = async (activityData, req = null) => {
  try {
    let { type, action, userId, userName, userRole, entityType, entityId, entityName, details } = activityData;

    // If request is provided and user info not in activityData, get from request
    if (req && (!userId && !userName)) {
      const userInfo = getUserFromRequest(req);
      userId = userId || userInfo.userId;
      userName = userName || userInfo.userName;
      userRole = userRole || userInfo.userRole;
    }

    const { error } = await supabase.from('activities').insert({
      type,
      action,
      user_id: userId || null,
      user_name: userName || null,
      user_role: userRole || null,
      entity_type: entityType || null,
      entity_id: entityId ? String(entityId) : null,
      entity_name: entityName || null,
      details: details || null,
    });

    if (error) {
      console.error('Failed to log activity:', error);
      // Don't throw error - activity logging shouldn't break the main operation
    }
  } catch (err) {
    console.error('Activity logging error:', err);
    // Don't throw error - activity logging shouldn't break the main operation
  }
};

// Get all activities
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Failed to fetch activities:', error);
      return res.status(500).json({ error: 'Failed to fetch activities', details: error.message });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Get activities error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Get single activity by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Activity not found' });
      }
      return res.status(500).json({ error: 'Failed to fetch activity', details: error.message });
    }

    res.json(data);
  } catch (err) {
    console.error('Get activity error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message });
  }
});

// Create an export object that includes both router and helpers
const activitiesModule = router;
activitiesModule.logActivity = logActivity;
activitiesModule.getUserFromRequest = getUserFromRequest;

// Export the router (with helpers attached) as the main export
module.exports = activitiesModule;

