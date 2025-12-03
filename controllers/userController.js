// User controller
const db = require('../db');
const crypto = require('crypto');

// In-memory fallback users (kept for dev convenience)
const users = [
  { username: 'Admin', email: 'admin@gmail.com', password: 'admin', role: 'admin' },
  { username: 'User', email: 'user@gmail.com', password: 'user', role: 'user' },
];

exports.renderRegister = (req, res) => {
  res.render('register', {
    messages: req.flash('error'),
    formData: req.flash('formData')[0] || {},
  });
};

exports.register = (req, res) => {
  const { username, email, password, address, contact, role } = req.body;
  const errs = [];
  if (!username || !email || !password || !address || !contact || !role) {
    errs.push('All fields are required.');
  } else {
    if (String(password).length < 6) {
      errs.push('Password must be at least 6 characters.');
    }
    if (String(contact).trim().length < 8) {
      errs.push('Contact must be at least 8 characters.');
    }
  }
  if (errs.length) {
    req.flash('error', errs);
    req.flash('formData', req.body);
    return res.redirect('/register');
  }

  // Check DB for existing email
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) {
      console.error('Error checking existing user:', err);
      req.flash('error', 'Server error');
      return res.redirect('/register');
    }
    if (results && results.length) {
      req.flash('error', 'Email is already registered.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    // Hash password with SHA1 to match existing DB entries (legacy)
    const hashed = crypto.createHash('sha1').update(String(password)).digest('hex');
    db.query(
      'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)',
      [username, email, hashed, address, contact, role],
      (insertErr) => {
        if (insertErr) {
          console.error('Error inserting user:', insertErr);
          req.flash('error', 'Error registering user');
          return res.redirect('/register');
        }
        req.flash('success', 'Registration successful! Please log in.');
        return res.redirect('/login');
      }
    );
  });
};

exports.renderLogin = (req, res) => {
  res.render('login', {
    messages: req.flash('success'),
    errors: req.flash('error'),
  });
};

exports.login = (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  // First, try to find user in DB
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) {
      console.error('Error fetching user for login:', err);
      req.flash('error', 'Server error');
      return res.redirect('/login');
    }

    let found = null;
      if (results && results.length) {
      const user = results[0];
      const stored = String(user.password || '');
      const hashedAttempt = crypto.createHash('sha1').update(password).digest('hex');
      // Accept either direct match (legacy plaintext) or SHA1 hash match
      if (password === stored || hashedAttempt === stored) {
        found = {
          username: user.username || user.name || user.email,
          email: user.email,
          role: user.role || 'user',
          // include address/contact so session carries these values
          address: user.address || null,
          contact: user.contact || null,
        };
      }
    }

    // Fallback to in-memory users if not found in DB
    if (!found) {
      const mem = users.find((u) => u.email.toLowerCase() === email && u.password === password);
      if (mem) found = mem;
    }

    if (!found) {
      req.flash('error', 'Invalid credentials');
      return res.redirect('/login');
    }

    req.session.regenerate((err) => {
      if (err) {
        req.flash('error', 'Session error, please try again.');
        return res.redirect('/login');
      }
      req.session.user = {
        username: found.username,
        role: found.role,
        email: found.email,
        address: found.address || null,
        contact: found.contact || null,
      };
      req.session.save(() => {
        if (found.role === 'admin') return res.redirect('/inventory');
        return res.redirect('/shopping');
      });
    });
  });
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/'));
};

// Render profile edit page
exports.renderProfile = (req, res) => {
  const user = req.session.user || {};
  const returnTo = String(req.query.returnTo || '').trim() || '';
  res.render('profile', { user, messages: { success: req.flash('success'), error: req.flash('error') }, returnTo });
};

// Update profile details (username, address, contact)
exports.updateProfile = (req, res) => {
  const username = String(req.body.username || '').trim();
  const address = String(req.body.address || '').trim();
  const contact = String(req.body.contact || '').trim();
  const returnTo = String(req.body.returnTo || '').trim() || '/profile';
  const email = req.session && req.session.user && req.session.user.email;
  if (!email) {
    req.flash('error', 'Not authenticated. Please log in.');
    return res.redirect('/login');
  }
  // Update DB
  db.query('UPDATE users SET username = ?, address = ?, contact = ? WHERE email = ?', [username, address, contact, email], (err, result) => {
    if (err) {
      console.error('Error updating user profile:', err);
      req.flash('error', 'Failed to update profile.');
      return res.redirect('/profile');
    }
    // Update session copy so views reflect new data immediately
    if (!req.session.user) req.session.user = {};
    req.session.user.username = username || req.session.user.username;
    req.session.user.address = address || req.session.user.address;
    req.session.user.contact = contact || req.session.user.contact;
    req.flash('success', 'Profile updated.');
    return res.redirect(returnTo);
  });
};
