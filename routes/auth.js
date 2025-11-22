const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://svyrkggjjkbxsbvumfxj.supabase.co';
// Use service role key for server-side operations (bypasses RLS)
// If not set, fall back to anon key (but may fail if RLS is enabled)
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2eXJrZ2dqamtieHNidnVtZnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyODgyNTEsImV4cCI6MjA3Nzg2NDI1MX0.1aRKA1GT8nM2eNKF6-bqQV9K40vP7cRSxuj-QtbpO0g';

console.log('Initializing Supabase client with URL:', supabaseUrl);
console.log('Using key type:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Service Role Key' : 'Anon Key (fallback)');

// Configure Supabase client with better error handling
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Test connection on startup
(async () => {
  try {
    console.log('Testing Supabase connection...');
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) {
      console.error('❌ Supabase connection test failed:', error.message);
      console.error('Error code:', error.code);
      console.error('Error details:', error);
    } else {
      console.log('✅ Supabase connection successful');
      console.log('✅ Users table is accessible');
    }
  } catch (err) {
    console.error('❌ Supabase connection error:', err.message);
    console.error('Error stack:', err.stack);
  }
})();

// Login endpoint - Authenticate against custom users table
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    console.log('Login attempt:', { email: email?.trim(), passwordLength: password?.length });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const originalEmail = email.trim();
    console.log('Normalized email:', normalizedEmail);

    // First, try to fetch all users and filter manually (most reliable for text columns)
    // This ensures we can handle case-insensitive matching properly
    console.log('Attempting to query users table...');
    
    let allUsers, fetchError;
    try {
      const result = await supabase
        .from('users')
        .select('*');
      allUsers = result.data;
      fetchError = result.error;
    } catch (networkError) {
      // Handle network/connection errors (e.g., fetch failed)
      console.error('❌ Network error connecting to Supabase:', networkError);
      console.error('Error type:', networkError.name);
      console.error('Error message:', networkError.message);
      console.error('Error stack:', networkError.stack);
      console.error('Supabase URL:', supabaseUrl);
      
      const isDnsError = networkError.message?.includes('resolve') || 
                        networkError.message?.includes('ENOTFOUND') ||
                        networkError.code === 'ENOTFOUND';
      
      return res.status(500).json({ 
        error: 'Database error occurred: ' + networkError.message,
        details: isDnsError 
          ? 'DNS resolution failed - cannot resolve Supabase hostname. Please check:\n' +
            '- Your internet connection\n' +
            '- DNS server configuration\n' +
            '- If the Supabase URL is correct: ' + supabaseUrl
          : 'Unable to connect to Supabase. Please check your internet connection and Supabase URL configuration.',
        type: 'network_error',
        url: supabaseUrl
      });
    }

    if (fetchError) {
      console.error('❌ Database query error:', fetchError);
      console.error('Error code:', fetchError.code);
      console.error('Error message:', fetchError.message);
      console.error('Error hint:', fetchError.hint);
      console.error('Error details:', fetchError.details);
      console.error('Supabase URL:', supabaseUrl);
      
      // Check for network/fetch errors
      const errorMessage = fetchError.message || '';
      const errorDetails = fetchError.details || '';
      const errorString = JSON.stringify(fetchError).toLowerCase();
      
      // Check for various network error patterns
      const isNetworkError = 
        errorMessage.includes('fetch failed') || 
        errorMessage.includes('TypeError') || 
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ENOTFOUND') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('resolve host') ||
        errorDetails.includes('fetch failed') || 
        errorDetails.includes('TypeError') ||
        errorString.includes('fetch failed') ||
        errorString.includes('could not resolve');
      
      if (isNetworkError) {
        return res.status(500).json({ 
          error: 'Database error occurred: ' + (errorMessage || 'Network connection failed'),
          details: 'Unable to connect to Supabase database. This could be due to:\n' +
                   '- DNS resolution failure (cannot resolve Supabase hostname)\n' +
                   '- No internet connection\n' +
                   '- Firewall blocking outbound HTTPS connections\n' +
                   '- Incorrect Supabase URL configuration\n' +
                   'Please verify your Supabase URL is correct and your network connection is working.',
          type: 'network_error',
          url: supabaseUrl,
          suggestion: 'Try running: curl -I ' + supabaseUrl + ' to test connectivity'
        });
      }
      
      // More specific error messages
      if (fetchError.code === 'PGRST301' || errorMessage.includes('permission denied')) {
        return res.status(500).json({ 
          error: 'Permission denied. Please check your Supabase API key permissions or disable RLS on the users table.',
          details: errorMessage 
        });
      } else if (errorMessage.includes('relation') || errorMessage.includes('does not exist')) {
        return res.status(500).json({ 
          error: 'Users table not found. Please check if the table name is correct.',
          details: errorMessage 
        });
      } else {
        return res.status(500).json({ 
          error: 'Database connection failed. Please check your Supabase configuration.',
          details: errorMessage || errorDetails || 'Unknown error'
        });
      }
    }

    if (!allUsers || allUsers.length === 0) {
      console.log('No users found in database');
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Find user with case-insensitive email match
    const user = allUsers.find(u => {
      if (!u.email) return false;
      const userEmail = u.email.trim().toLowerCase();
      return userEmail === normalizedEmail || userEmail === originalEmail.toLowerCase();
    });

    const users = user ? [user] : [];

    if (!users || users.length === 0) {
      console.log('User not found for email:', normalizedEmail);
      console.log('Available emails in database:', allUsers.map(u => u.email).slice(0, 5));
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const foundUser = users[0];
    console.log('User found:', { id: foundUser.id, email: foundUser.email, hasPassword: !!foundUser.password });

    // Compare password - direct text comparison since both are text columns
    const storedPassword = foundUser.password;
    
    if (!storedPassword) {
      console.error('No password field found in user record');
      return res.status(500).json({ error: 'User record is missing password field' });
    }

    // Direct text comparison (trim both for safety)
    const inputPassword = password.trim();
    const dbPassword = storedPassword.trim();
    
    console.log('Password comparison:', {
      inputLength: inputPassword.length,
      dbLength: dbPassword.length,
      match: inputPassword === dbPassword
    });

    if (inputPassword !== dbPassword) {
      console.log('Password mismatch for user:', foundUser.email);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    console.log('Login successful for user:', foundUser.email);

    // Remove password from response for security
    const { password: userPassword, password_hash, ...userData } = foundUser;

    // Create a simple session object
    const session = {
      access_token: 'custom_token_' + Date.now(),
      user: {
        id: foundUser.id,
        email: foundUser.email,
      },
    };

    res.json({
      user: {
        id: foundUser.id,
        email: foundUser.email,
      },
      session: session,
      userData: userData,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Register endpoint - Store directly in users table
router.post('/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name } = req.body;

    console.log('Registration attempt:', { email: email?.trim(), first_name: first_name?.trim(), last_name: last_name?.trim(), passwordLength: password?.length });

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const originalEmail = email.trim();

    // Check if user already exists by fetching all users
    console.log('Checking if user already exists...');
    
    let allUsers, fetchError;
    try {
      const result = await supabase
        .from('users')
        .select('*');
      allUsers = result.data;
      fetchError = result.error;
    } catch (networkError) {
      console.error('❌ Network error connecting to Supabase:', networkError);
      console.error('Error type:', networkError.name);
      console.error('Error message:', networkError.message);
      console.error('Supabase URL:', supabaseUrl);
      
      const isDnsError = networkError.message?.includes('resolve') || 
                        networkError.message?.includes('ENOTFOUND') ||
                        networkError.code === 'ENOTFOUND';
      
      return res.status(500).json({ 
        error: 'Database error occurred: ' + networkError.message,
        details: isDnsError 
          ? 'DNS resolution failed - cannot resolve Supabase hostname. Please check:\n' +
            '- Your internet connection\n' +
            '- DNS server configuration\n' +
            '- If the Supabase URL is correct: ' + supabaseUrl
          : 'Unable to connect to Supabase. Please check your internet connection and Supabase URL configuration.',
        type: 'network_error',
        url: supabaseUrl
      });
    }

    if (fetchError) {
      console.error('❌ Database query error:', fetchError);
      return res.status(500).json({ 
        error: 'Database connection failed. Please check your Supabase configuration.',
        details: fetchError.message 
      });
    }

    // Check if email already exists (case-insensitive)
    const existingUser = allUsers?.find(u => {
      if (!u.email) return false;
      const userEmail = u.email.trim().toLowerCase();
      return userEmail === normalizedEmail;
    });

    if (existingUser) {
      console.log('User already exists with email:', normalizedEmail);
      return res.status(400).json({ error: 'An account with this email already exists' });
    }

    // Insert new user into users table (let database auto-generate ID if it's auto-increment)
    console.log('Inserting new user into database...');
    console.log('User data to insert:', {
      email: originalEmail,
      password: '***' + password.trim().substring(password.length - 2),
      first_name: first_name ? first_name.trim() : null,
      last_name: last_name ? last_name.trim() : null,
    });
    
    let insertResult, insertError;
    try {
      // Try insert without .single() first to see if that's the issue
      let result = await supabase
        .from('users')
        .insert({
          email: originalEmail,
          password: password.trim(), // Store password as plain text (matching login logic)
          first_name: first_name ? first_name.trim() : null,
          last_name: last_name ? last_name.trim() : null,
        })
        .select();
      
      console.log('Insert result (without .single()):', JSON.stringify(result, null, 2));
      
      insertError = result.error;
      
      // If no error, try to get the data
      if (!insertError && result.data && result.data.length > 0) {
        insertResult = result.data[0];
        console.log('✅ Got user data from insert:', insertResult);
      } else if (!insertError && result.data && result.data.length === 0) {
        console.error('❌ Insert returned empty array - no data inserted');
        // Try with .single() to get better error message
        result = await supabase
          .from('users')
          .insert({
            email: originalEmail,
            password: password.trim(),
            first_name: first_name ? first_name.trim() : null,
            last_name: last_name ? last_name.trim() : null,
          })
          .select()
          .single();
        
        insertResult = result.data;
        insertError = result.error;
      }
      
      if (insertError) {
        console.error('❌ Supabase insert error:', insertError);
        console.error('Error code:', insertError.code);
        console.error('Error message:', insertError.message);
        console.error('Error details:', insertError.details);
        console.error('Error hint:', insertError.hint);
      } else if (!insertResult) {
        console.error('❌ No data returned from insert, but no error either');
      }
    } catch (networkError) {
      console.error('❌ Network error inserting user:', networkError);
      console.error('Error type:', networkError.name);
      console.error('Error message:', networkError.message);
      console.error('Error stack:', networkError.stack);
      return res.status(500).json({ 
        error: 'Database error occurred: ' + networkError.message,
        details: 'Unable to connect to Supabase. Please check your internet connection.',
        type: 'network_error'
      });
    }

    if (insertError) {
      console.error('❌ Error inserting user:', insertError);
      return res.status(500).json({ 
        error: 'Failed to create account. Please try again.',
        details: insertError.message || JSON.stringify(insertError),
        code: insertError.code
      });
    }

    if (!insertResult) {
      console.error('❌ Insert succeeded but no data returned');
      return res.status(500).json({ 
        error: 'User was created but data could not be retrieved. Please try logging in.',
      });
    }

    console.log('✅ Registration successful for user:', originalEmail);
    console.log('✅ Inserted user ID:', insertResult.id);

    // Remove password from response for security
    const { password: userPassword, ...userData } = insertResult;

    // Create a simple session object (matching login format)
    const session = {
      access_token: 'custom_token_' + Date.now(),
      user: {
        id: insertResult.id,
        email: insertResult.email,
      },
    };

    res.json({
      user: {
        id: insertResult.id,
        email: insertResult.email,
        first_name: insertResult.first_name || null,
        last_name: insertResult.last_name || null,
      },
      session: session,
      userData: userData,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint
router.post('/logout', async (req, res) => {
  try {
    const { session } = req.body;

    if (!session) {
      return res.status(400).json({ error: 'Session is required' });
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Forgot password endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email, redirectTo } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectTo || `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password`,
    });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json({ message: 'Password reset email sent successfully' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Reset password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { email, password, token } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Find user by email
    const normalizedEmail = email.trim().toLowerCase();
    const { data: allUsers, error: fetchError } = await supabase
      .from('users')
      .select('*');

    if (fetchError) {
      console.error('Database query error:', fetchError);
      return res.status(500).json({ 
        error: 'Database connection failed. Please check your Supabase configuration.',
        details: fetchError.message 
      });
    }

    const user = allUsers?.find(u => {
      if (!u.email) return false;
      const userEmail = u.email.trim().toLowerCase();
      return userEmail === normalizedEmail;
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update password in users table
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ password: password.trim() })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('Password update error:', updateError);
      return res.status(500).json({ 
        error: 'Failed to update password. Please try again.',
        details: updateError.message 
      });
    }

    // Remove password from response
    const { password: userPassword, ...userData } = updatedUser;

    res.json({ 
      message: 'Password reset successfully',
      user: userData
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verify token endpoint
router.post('/verify-token', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({ user: data.user });
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

