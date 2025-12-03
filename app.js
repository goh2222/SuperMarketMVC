// app.js
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const path = require('path');
// Use shared DB connection from ./db.js to avoid duplicate connections/logs
const db = require('./db');


const app = express();

/* -------------------- View engine & middleware -------------------- */
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));
// Simple request logger to help debug routing issues
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});
app.use(
  session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
  })
);
app.use(flash());

/* -------------------- Multer setup -------------------- */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/images'),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });


// Import auth and shopping controllers
function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (err) {
    console.error(`Failed to require ${modulePath}:`, err && err.stack ? err.stack : err);
    // Return a dummy object where any function property sends a helpful 500 response
    return new Proxy({}, {
      get() {
        return (req, res) => res.status(500).send(`Controller load error for ${modulePath}`);
      }
    });
  }
}

const authController = safeRequire('./controllers/authController');
const shoppingController = safeRequire('./controllers/shoppingController');


// Import controllers (safe)
const productController = safeRequire('./controllers/productController');
const cartController = safeRequire('./controllers/cartController');
const userController = safeRequire('./controllers/userController');
const sessionController = safeRequire('./controllers/sessionController');
const adminController = safeRequire('./controllers/adminController');
const imageController = safeRequire('./controllers/imageController');
const homeController = safeRequire('./controllers/homeController');

/* -------------------- Home -------------------- */
app.get('/', homeController.index);


/* -------------------- Register -------------------- */
app.get('/register', userController.renderRegister);
app.post('/register', userController.register);


/* -------------------- Login / Logout -------------------- */
app.get('/login', userController.renderLogin);
app.post('/login', userController.login);
app.get('/logout', sessionController.logout);

// Profile edit routes
app.get('/profile', authController.checkAuthenticated, userController.renderProfile);
app.post('/profile', authController.checkAuthenticated, userController.updateProfile);

// Temporary unprotected profile test route for debugging (renders profile view without auth)
app.get('/profile-test', (req, res) => {
  const sampleUser = { username: 'Test User', email: 'test@example.com', address: '123 Main St', contact: '555-0100' };
  res.render('profile', { user: sampleUser, messages: { success: [], error: [] }, returnTo: '/confirm-payment' });
});


/* -------------------- Product Routes -------------------- */
app.get('/inventory', authController.checkAuthenticated, authController.checkAdmin, productController.listInventory);
app.get('/product/:id', authController.checkAuthenticated, productController.showProduct);
app.get('/addProduct', authController.checkAuthenticated, authController.checkAdmin, adminController.renderAddProduct);
app.post('/addProduct', authController.checkAuthenticated, authController.checkAdmin, imageController.upload.single('image'), adminController.addProduct);
app.get('/updateProduct/:id', authController.checkAuthenticated, authController.checkAdmin, adminController.renderUpdateProduct);
app.post('/updateProduct/:id', authController.checkAuthenticated, authController.checkAdmin, imageController.upload.single('image'), adminController.updateProduct);
app.get('/deleteProduct/:id', authController.checkAuthenticated, authController.checkAdmin, adminController.deleteProduct);
// Accept POST from forms that submit deletion (some views use POST)
app.post('/deleteProduct/:id', authController.checkAuthenticated, authController.checkAdmin, adminController.deleteProduct);


/* ---- User shopping view (basic) ---- */
app.get('/shopping', authController.checkAuthenticated, shoppingController.shoppingView);

// Add to cart
app.post('/add-to-cart/:id', authController.checkAuthenticated, cartController.addToCart);
app.get('/add-to-cart/:id', authController.checkAuthenticated, cartController.addToCartGet);

app.get('/cart', authController.checkAuthenticated, cartController.viewCart);

// Order history: read from DB and merge with session orders
app.get('/orders', authController.checkAuthenticated, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  try {
    const userEmail = req.session && req.session.user && req.session.user.email;
    let dbOrders = [];
    if (userEmail) {
      let ordersRows;
      try {
        ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total, created_at FROM orders WHERE user_email = ? ORDER BY created_at DESC', [userEmail]);
      } catch (ordersSelectErr) {
        console.warn('orders SELECT with created_at failed, falling back to select without created_at:', ordersSelectErr && ordersSelectErr.message ? ordersSelectErr.message : ordersSelectErr);
        ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total FROM orders WHERE user_email = ? ORDER BY id DESC', [userEmail]);
      }
      const orderIds = ordersRows.map(r => r.id);
      let items = [];
      if (orderIds.length) {
        items = await q('SELECT order_id_fk, product_id, product_name, quantity, price, image FROM order_items WHERE order_id_fk IN (?)', [orderIds]);
      }
      const itemsByOrder = new Map();
      items.forEach(it => {
        const k = String(it.order_id_fk);
        if (!itemsByOrder.has(k)) itemsByOrder.set(k, []);
        itemsByOrder.get(k).push({ id: it.product_id, productName: it.product_name, quantity: it.quantity, price: it.price, image: it.image });
      });
      dbOrders = ordersRows.map(r => ({
        orderId: r.order_id,
        user: { email: r.user_email, username: r.user_name, address: r.address, contact: r.contact },
        total: (r.total !== null && r.total !== undefined) ? Number(r.total).toFixed(2) : '0.00',
        items: itemsByOrder.get(String(r.id)) || [],
        createdAt: r.created_at
      }));
    }

    const sessionOrders = req.session.orderHistory || [];
    // merge DB orders and session orders (session can contain very recent purchases not yet in DB)
    const map = new Map();
    [...dbOrders, ...sessionOrders].forEach(o => { if (o && o.orderId) map.set(String(o.orderId), o); });
    const orders = Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const last = req.session.lastPurchase || null;
    return res.render('order', { orders, last, selected: null, user: req.session.user || null });
  } catch (e) {
    console.error('Failed to load user orders from DB', e);
    // fall back to session-only orders to avoid blocking user
    const orders = req.session.orderHistory || [];
    const last = req.session.lastPurchase || null;
    req.flash('error', 'Could not load order history from server. Showing recent session orders.');
    return res.render('order', { orders, last, selected: null, user: req.session.user || null });
  }
});

// Payment confirmation step: show cart, total, and user's address/contact before finalizing
app.get('/confirm-payment', authController.checkAuthenticated, (req, res) => {
  const cart = req.session.cart || [];
  const user = req.session.user || null;
  res.render('confirmPayment', { cart, user });
});

// Temporary debug route (unprotected) to verify the confirmation view loads
// Use this to test when authentication or routing seems to fail: /confirm-payment-test
app.get('/confirm-payment-test', (req, res) => {
  const cart = req.session ? (req.session.cart || []) : [];
  const user = req.session ? (req.session.user || null) : null;
  res.render('confirmPayment', { cart, user });
});

// New single-order view route. If ?orderId is provided, show that order, else show history/last
app.get('/order', authController.checkAuthenticated, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  try {
    const userEmail = req.session && req.session.user && req.session.user.email;
    let dbOrders = [];
    if (userEmail) {
      let ordersRows;
      try {
        ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total, created_at FROM orders WHERE user_email = ? ORDER BY created_at DESC', [userEmail]);
      } catch (ordersSelectErr) {
        console.warn('orders SELECT with created_at failed, falling back to select without created_at:', ordersSelectErr && ordersSelectErr.message ? ordersSelectErr.message : ordersSelectErr);
        ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total FROM orders WHERE user_email = ? ORDER BY id DESC', [userEmail]);
      }
      const orderIds = ordersRows.map(r => r.id);
      let items = [];
      if (orderIds.length) {
        items = await q('SELECT order_id_fk, product_id, product_name, quantity, price, image FROM order_items WHERE order_id_fk IN (?)', [orderIds]);
      }
      const itemsByOrder = new Map();
      items.forEach(it => {
        const k = String(it.order_id_fk);
        if (!itemsByOrder.has(k)) itemsByOrder.set(k, []);
        itemsByOrder.get(k).push({ id: it.product_id, productName: it.product_name, quantity: it.quantity, price: it.price, image: it.image });
      });
      dbOrders = ordersRows.map(r => ({
        orderId: r.order_id,
        user: { email: r.user_email, username: r.user_name, address: r.address, contact: r.contact },
        total: (r.total !== null && r.total !== undefined) ? Number(r.total).toFixed(2) : '0.00',
        items: itemsByOrder.get(String(r.id)) || [],
        createdAt: r.created_at
      }));
    }

    const sessionOrders = req.session.orderHistory || [];
    const map = new Map();
    [...dbOrders, ...sessionOrders].forEach(o => { if (o && o.orderId) map.set(String(o.orderId), o); });
    const orders = Array.from(map.values()).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));

    const last = req.session.lastPurchase || null;
    const orderId = req.query.orderId;
    let selected = null;
    if (orderId) selected = orders.find(o => String(o.orderId) === String(orderId)) || null;

    return res.render('order', { orders, last, selected, user: req.session.user || null });
  } catch (e) {
    console.error('Failed to load single order view from DB', e);
    const orders = req.session.orderHistory || [];
    const last = req.session.lastPurchase || null;
    req.flash('error', 'Could not load orders from server. Showing recent session orders.');
    const orderId = req.query.orderId;
    let selected = null;
    if (orderId) selected = orders.find(o => String(o.orderId) === String(orderId)) || null;
    return res.render('order', { orders, last, selected, user: req.session.user || null });
  }
});

// Remove from cart
app.post('/remove-from-cart/:id', authController.checkAuthenticated, cartController.removeFromCart);

// Purchase (simulate payment)
app.post('/purchase', authController.checkAuthenticated, cartController.purchase);

// Support alternate form action: POST /success should perform the purchase
app.post('/success', authController.checkAuthenticated, cartController.purchase);


// Provide a GET /success page so users can visit the success page directly.
app.get('/success', authController.checkAuthenticated, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  try {
    // Prefer session's lastPurchase or the last entry in session.orderHistory
    let last = req.session.lastPurchase || (req.session.orderHistory && req.session.orderHistory.length ? req.session.orderHistory[req.session.orderHistory.length - 1] : null);
    // If no session data, try to fetch latest order from DB for the user
    if (!last) {
      const userEmail = req.session && req.session.user && req.session.user.email;
      if (userEmail) {
        let ordersRows;
        try {
          ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total, created_at FROM orders WHERE user_email = ? ORDER BY created_at DESC LIMIT 1', [userEmail]);
        } catch (ordersSelectErr) {
          console.warn('orders SELECT (single) with created_at failed, falling back to select without created_at:', ordersSelectErr && ordersSelectErr.message ? ordersSelectErr.message : ordersSelectErr);
          ordersRows = await q('SELECT id, order_id, user_email, user_name, address, contact, total FROM orders WHERE user_email = ? ORDER BY id DESC LIMIT 1', [userEmail]);
        }
        if (ordersRows && ordersRows.length) {
          const r = ordersRows[0];
          const items = await q('SELECT product_id, product_name, quantity, price, image FROM order_items WHERE order_id_fk = ?', [r.id]);
          last = {
            orderId: r.order_id,
            user: { email: r.user_email, username: r.user_name, address: r.address, contact: r.contact },
            total: (r.total !== null && r.total !== undefined) ? Number(r.total).toFixed(2) : '0.00',
            items: (items || []).map(it => ({ id: it.product_id, productName: it.product_name, quantity: it.quantity, price: it.price, image: it.image })),
            createdAt: r.created_at
          };
        }
      }
    }

    if (!last) {
      req.flash('error', 'No recent purchase found.');
      return res.redirect('/shopping');
    }

    if (last.orderId) res.setHeader('X-Order-Id', last.orderId);
    return res.render('purchase', { purchase: last, user: req.session.user || null });
  } catch (e) {
    console.error('Failed to render /success', e);
    req.flash('error', 'Could not load success page.');
    return res.redirect('/shopping');
  }
});

// Show purchase confirmation (PRG). Uses `req.session.lastPurchase` saved by POST /purchase
app.get('/purchase', authController.checkAuthenticated, (req, res) => {
  const last = req.session.lastPurchase;
   // Log arrival of GET /purchase and whether a lastPurchase exists
   try {
     if (last && last.orderId) {
       console.log('[app] GET /purchase - sessionID=', req.sessionID, 'orderId=', last.orderId, 'found');
     } else {
       console.log('[app] GET /purchase - sessionID=', req.sessionID, 'no lastPurchase found');
     }
   } catch (e) {
     console.log('[app] GET /purchase - sessionID=', req.sessionID, 'error logging lastPurchase');
   }
   // consume it so refresh won't re-show
   delete req.session.lastPurchase;
   if (!last) {
     req.flash('error', 'No purchase found.');
     return res.redirect('/shopping');
   }
  // add a response header with the orderId to help browser/network debugging
  if (last && last.orderId) res.setHeader('X-Order-Id', last.orderId);
  // Render the (renamed) purchase page
  res.render('purchase', { purchase: last, user: req.session.user || null });
});

/* -------------------- Admin migrations (one-off) -------------------- */
// Add `category` column to `products` table (admin-only)
app.get('/migrate/add-category', authController.checkAuthenticated, authController.checkAdmin, (req, res) => {
  const sql = "ALTER TABLE products ADD COLUMN category VARCHAR(100) DEFAULT 'Snacks'";
  db.query(sql, (err) => {
    if (err) {
      // If column already exists, respond accordingly
      if (err.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(err.message || '')) {
        return res.send('Category column already exists.');
      }
      console.error('Migration error:', err);
      return res.status(500).send('Migration failed: ' + (err.message || err));
    }
    return res.send('Migration complete: category column added to products table.');
  });
});

// Admin: copy `products` table rows into an admin-only `admin_products` table (idempotent)
app.get('/migrate/copy-products-to-admin', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  try {
    const createSql = `
      CREATE TABLE IF NOT EXISTS admin_products (
        id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        original_id INT NOT NULL,
        productName VARCHAR(255),
        quantity INT DEFAULT 0,
        price DECIMAL(12,2) DEFAULT 0.00,
        image VARCHAR(255),
        category VARCHAR(100),
        discount DECIMAL(5,2) DEFAULT 0.00,
        description TEXT,
        copied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_original_id (original_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await q(createSql);

    // Copy rows from products into admin_products, skipping already-copied rows.
    const copySql = `
      INSERT IGNORE INTO admin_products (original_id, productName, quantity, price, image, category, discount, description)
      SELECT id, productName, quantity, price, image,
             IFNULL(category, ''),
             IFNULL(discount, 0.00),
             IFNULL(description, '')
      FROM products;
    `;
    const result = await q(copySql);
    const added = (result && (result.affectedRows || result.affectedRows === 0)) ? result.affectedRows : null;
    console.log('[migrate] copy-products-to-admin result:', result);
    return res.send(`Products copy complete. Rows inserted: ${added}`);
  } catch (e) {
    console.error('[migrate] Failed to copy products to admin_products:', e && e.stack ? e.stack : e);
    return res.status(500).send('Failed to copy products: ' + (e && e.message ? e.message : String(e)));
  }
});

// Debug: list distinct categories (authenticated users only)
app.get('/debug/categories', authController.checkAuthenticated, (req, res) => {
  db.query('SELECT DISTINCT category FROM products', (err, results) => {
    if (err) {
      console.error('Error fetching categories for debug:', err);
      return res.status(500).json({ error: 'DB error', details: err.message || err });
    }
    const cats = (results || []).map(r => (r.category == null ? '' : String(r.category).trim())).filter(c => c !== '').map(c => {
      const low = c.toLowerCase();
      if (low === 'snack' || low === 'snacks') return 'Snacks';
      if (low === 'other' || low === 'others') return 'Others';
      return c;
    });
    res.json({ categories: Array.from(new Set(cats)) });
  });
});

// Admin-only: auto-assign categories based on productName keywords
app.get('/migrate/assign-categories', authController.checkAuthenticated, (req, res) => {
  db.query('SELECT id, productName, category FROM products', (err, rows) => {
    if (err) {
      console.error('Error fetching products for category assign:', err);
      return res.status(500).send('DB error');
    }
    const updates = [];
    const fruitRe = /apple|banana|orange|grape|pear|mango|pineapple|melon|berry|strawberry/i;
    const vegRe = /tomato|broccoli|lettuce|spinach|cabbage|carrot|potato|onion|pepper|corn|beans/i;
    const drinkRe = /milk|water|juice|soda|cola|drink|beer|wine|coffee|tea/i;
    const snackRe = /chip|crisps|snack|cookie|cake|chocolate|chips|ruffle|ruffles|crisps/i;

    rows.forEach((r) => {
      const name = String(r.productName || '').toLowerCase();
      let newCat = 'Others';
      if (fruitRe.test(name)) newCat = 'Fruits';
      else if (vegRe.test(name)) newCat = 'Vegetables';
      else if (drinkRe.test(name)) newCat = 'Drinks';
      else if (snackRe.test(name)) newCat = 'Snacks';

      const current = (r.category == null ? '' : String(r.category).trim());
      if (current.toLowerCase() !== newCat.toLowerCase()) {
        updates.push({ id: r.id, category: newCat });
      }
    });

    // Support preview/dry-run mode: `?preview=1` or `?preview=true`
    const preview = req.query.preview === '1' || req.query.preview === 'true';
    if (!updates.length) return res.send('No categories needed updating.');

    if (preview) {
      // Return a lightweight preview of planned updates
      return res.json({ pending: updates.length, sample: updates.slice(0, 50) });
    }

    let done = 0;
    let failed = 0;
    updates.forEach((u) => {
      db.query('UPDATE products SET category = ? WHERE id = ?', [u.category, u.id], (upErr) => {
        if (upErr) {
          console.error('Failed to update product', u.id, upErr);
          failed++;
        }
        done++;
        if (done === updates.length) {
          return res.send(`Category assignment complete. Updated: ${updates.length - failed}, Failed: ${failed}`);
        }
      });
    });
  });
});

// Admin-only: create `users` table if missing (safe, idempotent)
app.get('/migrate/create-users', authController.checkAuthenticated, authController.checkAdmin, (req, res) => {
  const sql = `
    CREATE TABLE IF NOT EXISTS users (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(150) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      address TEXT,
      contact VARCHAR(100),
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `;
  db.query(sql, (err) => {
    if (err) {
      console.error('Failed to create users table:', err);
      return res.status(500).send('Failed to create users table: ' + (err.message || err));
    }
    return res.send('Users table ensured (created if missing).');
  });
});

// Admin-only: create orders and order_items tables
app.post('/admin/orders/delete/:orderId', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const fs = require('fs');
  const path = require('path');
  const ordersFile = path.join(__dirname, 'data', 'orders.json');
  const orderId = String(req.params.orderId || '').trim();
  console.log('[admin] DELETE order requested:', { orderId, sessionID: req.sessionID, user: req.session && req.session.user ? req.session.user.email : null });
  if (!orderId) {
    req.flash('error', 'Invalid order id');
    return res.redirect('/admin/orders');
  }

  try {
    // Try deleting from DB first (if orders were persisted there)
    const rows = await q('SELECT id FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    console.log('[admin] DB lookup rows for order_id:', orderId, rows && rows.length ? rows.length : 0);
    if (rows && rows.length) {
      const id = rows[0].id;
      try {
        // delete dependent order_items first
        const delItems = await q('DELETE FROM order_items WHERE order_id_fk = ?', [id]);
        const delOrder = await q('DELETE FROM orders WHERE id = ?', [id]);
        console.log('[admin] Deleted order items/result:', { delItems, delOrder });
        req.flash('success', 'Order removed');
        return res.redirect('/admin/orders');
      } catch (delErr) {
        console.error('[admin] Failed to delete order rows:', delErr && delErr.stack ? delErr.stack : delErr);
        req.flash('error', 'Failed to delete order from database');
        return res.redirect('/admin/orders');
      }
    }
  } catch (dbErr) {
    console.error('[admin] DB error during lookup/delete attempt:', dbErr && dbErr.stack ? dbErr.stack : dbErr);
    // continue to fallback to file-based deletion below
  }

  // Fallback: attempt to delete from data/orders.json (legacy behavior)
  let orders = [];
  try {
    if (fs.existsSync(ordersFile)) {
      const raw = fs.readFileSync(ordersFile, 'utf8');
      orders = raw ? JSON.parse(raw) : [];
    }
  } catch (e) {
    console.error('[admin] Failed to read orders.json for deletion', e && e.stack ? e.stack : e);
    req.flash('error', 'Server error reading orders');
    return res.redirect('/admin/orders');
  }

  const beforeCount = orders.length;
  orders = orders.filter(o => String(o.orderId) !== orderId);
  if (orders.length === beforeCount) {
    req.flash('error', 'Order not found');
    return res.redirect('/admin/orders');
  }

  try {
    // persist updated list
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
    req.flash('success', 'Order removed');
  } catch (e) {
    console.error('[admin] Failed to write orders.json after deletion', e && e.stack ? e.stack : e);
    req.flash('error', 'Failed to delete order');
  }
  return res.redirect('/admin/orders');
});

// Accept deletion via POST body too (form submits orderId in body)
app.post('/admin/orders/delete', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const orderId = String((req.body && req.body.orderId) || '').trim();
  console.log('[admin] DELETE (body) order requested:', { orderId, sessionID: req.sessionID, user: req.session && req.session.user ? req.session.user.email : null });
  if (!orderId) {
    req.flash('error', 'Invalid order id');
    return res.redirect('/admin/orders');
  }
  // Reuse the same deletion logic as the param-based route by calling the param route handler logic inline
  try {
    const util = require('util');
    const q = util.promisify(db.query).bind(db);
    // Try DB deletion
    const rows = await q('SELECT id FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    if (rows && rows.length) {
      const id = rows[0].id;
      await q('DELETE FROM order_items WHERE order_id_fk = ?', [id]);
      await q('DELETE FROM orders WHERE id = ?', [id]);
      req.flash('success', 'Order removed');
      return res.redirect('/admin/orders');
    }
  } catch (e) {
    console.error('[admin] DB delete (body) error:', e && e.stack ? e.stack : e);
    req.flash('error', 'Failed to delete order from database');
    return res.redirect('/admin/orders');
  }

  // Fallback to file deletion
  try {
    const fs = require('fs');
    const path = require('path');
    const ordersFile = path.join(__dirname, 'data', 'orders.json');
    let orders = [];
    if (fs.existsSync(ordersFile)) {
      const raw = fs.readFileSync(ordersFile, 'utf8');
      orders = raw ? JSON.parse(raw) : [];
    }
  } catch (e) {
    console.error('[admin] Failed to read orders.json for deletion (body)', e && e.stack ? e.stack : e);
    req.flash('error', 'Server error reading orders');
    return res.redirect('/admin/orders');
  }

  const beforeCount = orders.length;
  orders = orders.filter(o => String(o.orderId) !== orderId);
  if (orders.length === beforeCount) {
    req.flash('error', 'Order not found');
    return res.redirect('/admin/orders');
  }

  try {
    fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2), 'utf8');
    req.flash('success', 'Order removed');
  } catch (e) {
    console.error('[admin] Failed to write orders.json after deletion (body)', e && e.stack ? e.stack : e);
    req.flash('error', 'Failed to delete order');
  }
  return res.redirect('/admin/orders');
});

// JSON API: return users as JSON for client-side rendering
app.get('/admin/users.json', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  try {
    // Avoid selecting `created_at` to prevent schema-related failures
    let rows = await q('SELECT id, username, email, role, address, contact FROM users ORDER BY id DESC');
    return res.json({ users: rows || [] });
  } catch (e) {
    // If table missing, try to create it and return empty list
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || /doesn't exist|no such table|does not exist/i.test(String(e.message || '')))) {
      try {
        const createSql = `
          CREATE TABLE IF NOT EXISTS users (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(150) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password VARCHAR(255) NOT NULL,
            address TEXT,
            contact VARCHAR(100),
            role VARCHAR(50) DEFAULT 'user',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `;
        await q(createSql);
        console.log('Created `users` table on-the-fly (JSON endpoint).');
        return res.json({ users: [] });
      } catch (ce) {
        console.error('Failed to create users table via JSON endpoint:', ce && ce.stack ? ce.stack : ce);
        return res.status(500).json({ error: 'Failed to create users table' });
      }
    }
    console.error('Error in /admin/users.json:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: (e && e.message) || 'DB error' });
  }
});

// Admin: render edit form for a user
app.get('/admin/users/:id/edit', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const id = parseInt(req.params.id, 10) || 0;
  if (!id) {
    req.flash('error', 'Invalid user id');
    return res.redirect('/admin/users');
  }
  try {
    // Select user row without relying on `created_at` column
    const rows = await q('SELECT id, username, email, role, address, contact FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows || !rows.length) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }
    const successMsgs = req.flash('success') || [];
    const errorMsgs = req.flash('error') || [];
    return res.render('adminUserEdit', { userRow: rows[0], messages: { success: successMsgs, error: errorMsgs } });
  } catch (e) {
    console.error('[admin] GET /admin/users/:id/edit error:', e && e.stack ? e.stack : e);
    req.flash('error', 'Failed to load user');
    return res.redirect('/admin/users');
  }
});

// Admin: update user details
app.post('/admin/users/:id', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const id = parseInt(req.params.id, 10) || 0;
  if (!id) {
    req.flash('error', 'Invalid user id');
    return res.redirect('/admin/users');
  }
  const { username, email, role, address, contact } = req.body || {};
  try {
    const updateSql = 'UPDATE users SET username = ?, email = ?, role = ?, address = ?, contact = ? WHERE id = ?';
    await q(updateSql, [username || null, email || null, role || 'user', address || null, contact || null, id]);
    req.flash('success', 'User updated');
    return res.redirect('/admin/users');
  } catch (e) {
    console.error('[admin] POST /admin/users/:id error:', e && e.stack ? e.stack : e);
    // handle common errors (e.g., table missing or unique email violation)
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || /doesn't exist|no such table|does not exist/i.test(String(e.message || '')))) {
      req.flash('error', 'Users table missing');
      return res.redirect('/admin/users');
    }
    if (e && e.code === 'ER_DUP_ENTRY') {
      req.flash('error', 'Email already in use');
      return res.redirect(`/admin/users/${id}/edit`);
    }
    req.flash('error', 'Failed to update user');
    return res.redirect(`/admin/users/${id}/edit`);
  }
});

// Admin: delete user
app.post('/admin/users/:id/delete', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const id = parseInt(req.params.id, 10) || 0;
  // Log incoming delete attempts to assist debugging when requests appear to not reach this handler
  try {
    console.log('[admin] POST /admin/users/:id/delete requested', { id, sessionID: req.sessionID, userEmail: req.session && req.session.user ? req.session.user.email : null });
  } catch (e) {
    console.log('[admin] failed to log delete request');
  }
  if (!id) {
    req.flash('error', 'Invalid user id');
    return res.redirect('/admin/users');
  }
  try {
    const rows = await q('SELECT id, email FROM users WHERE id = ? LIMIT 1', [id]);
    if (!rows || !rows.length) {
      req.flash('error', 'User not found');
      return res.redirect('/admin/users');
    }
    const target = rows[0];
    // Prevent an admin from deleting their own account via this UI
    if (req.session && req.session.user && req.session.user.email && req.session.user.email === target.email) {
      req.flash('error', 'Cannot delete the currently logged-in admin');
      return res.redirect('/admin/users');
    }
    await q('DELETE FROM users WHERE id = ?', [id]);
    req.flash('success', 'User deleted');
    return res.redirect('/admin/users');
  } catch (e) {
    console.error('[admin] POST /admin/users/:id/delete error:', e && e.stack ? e.stack : e);
    if (e && (e.code === 'ER_NO_SUCH_TABLE' || /doesn't exist|no such table|does not exist/i.test(String(e.message || '')))) {
      req.flash('error', 'Users table missing');
      return res.redirect('/admin/users');
    }
    req.flash('error', 'Failed to delete user');
    return res.redirect('/admin/users');
  }
});

// DEBUG: Accept POST to verify the server receives POST requests (no DB side-effects)
app.post('/debug/test-post', (req, res) => {
  try {
    console.log('[debug] /debug/test-post received', { body: req.body, sessionID: req.sessionID, user: req.session && req.session.user ? req.session.user.email : null });
  } catch (e) {
    console.error('[debug] /debug/test-post logging error', e);
  }
  res.json({ ok: true, body: req.body || {}, session: req.session && req.session.user ? { email: req.session.user.email, username: req.session.user.username } : null });
});

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 3000;
const url = `http://localhost:${PORT}`;
// Diagnostic: list registered routes before starting server
function listRoutes() {
  console.log('--- Registered routes ---');
  if (!app._router) return console.log('(no router)');
  app._router.stack.forEach((middleware) => {
    if (middleware.route) {
      // routes registered directly on the app
      const methods = Object.keys(middleware.route.methods).join(',').toUpperCase();
      console.log(methods.padEnd(8), middleware.route.path);
    } else if (middleware.name === 'router' && middleware.handle && middleware.handle.stack) {
      // router middleware
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          const methods = Object.keys(handler.route.methods).join(',').toUpperCase();
          console.log(methods.padEnd(8), handler.route.path);
        }
      });
    }
  });
  console.log('--- end routes ---');
}

// don't list routes at startup to keep startup output minimal
// listRoutes();

// Global error handlers to make startup/runtime failures visible in logs
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
});

// Temporary debug route to list registered routes (unprotected)
app.get('/__routes', (req, res) => {
  if (!app._router) return res.json({ routes: [] });
  const routes = [];
  app._router.stack.forEach((mw) => {
    if (mw.route) {
      routes.push({ path: mw.route.path, methods: Object.keys(mw.route.methods) });
    } else if (mw.name === 'router' && mw.handle && mw.handle.stack) {
      mw.handle.stack.forEach((h) => {
        if (h.route) routes.push({ path: h.route.path, methods: Object.keys(h.route.methods) });
      });
    }
  });
  res.json({ routes });
});

// Temporary unprotected debug route to inspect session contents (useful while debugging purchases)
app.get('/debug/session', (req, res) => {
  try {
    // Only include limited session fields to avoid leaking secrets
    const s = req.session || {};
    return res.json({
      sessionID: req.sessionID || null,
      cart: Array.isArray(s.cart) ? s.cart : [],
      orderHistoryLength: Array.isArray(s.orderHistory) ? s.orderHistory.length : 0,
      lastPurchase: s.lastPurchase ? (s.lastPurchase.orderId || true) : null,
      user: s.user ? { email: s.user.email || null, username: s.user.username || null } : null
    });
  } catch (e) {
    console.error('Error in /debug/session', e);
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Admin-only debug route: lookup a persisted order by orderId and return DB rows (order + items)
app.get('/debug/order/:orderId', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const orderId = String(req.params.orderId || '').trim();
  console.log('[debug] lookup order requested:', { orderId, sessionID: req.sessionID, user: req.session && req.session.user ? req.session.user.email : null });
  if (!orderId) return res.status(400).json({ error: 'orderId required' });
  try {
    const rows = await q('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    if (!rows || !rows.length) {
      // If not found in DB, return a friendly HTML page when requested by browser
      if (req.headers && req.headers.accept && req.headers.accept.indexOf('text/html') !== -1) {
        return res.status(404).render('debugOrder', { error: 'Order not found in DB', orderId, order: null, items: [] });
      }
      return res.status(404).json({ error: 'Order not found in DB' });
    }
    const order = rows[0];
    const items = await q('SELECT * FROM order_items WHERE order_id_fk = ?', [order.id]);
    // If browser asked for HTML, render a simple debug view; otherwise return JSON
    if (req.headers && req.headers.accept && req.headers.accept.indexOf('text/html') !== -1) {
      return res.render('debugOrder', { error: null, orderId, order, items, user: req.session.user || null });
    }
    return res.json({ order, items });
  } catch (e) {
    console.error('[debug] error looking up order:', e && e.stack ? e.stack : e);
    if (req.headers && req.headers.accept && req.headers.accept.indexOf('text/html') !== -1) {
      return res.status(500).render('debugOrder', { error: e && e.message ? e.message : String(e), orderId, order: null, items: [] });
    }
    return res.status(500).json({ error: 'DB error', details: e && e.message ? e.message : String(e) });
  }
});

// DEBUG-ONLY: Admin-only quick delete (unsafe GET) to aid debugging deletion issues.
// Removes order_items and orders for the given orderId and returns JSON result.
// WARNING: This is for local debugging only. Remove before production.
app.get('/debug/admin/delete-order/:orderId', authController.checkAuthenticated, authController.checkAdmin, async (req, res) => {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const orderId = String(req.params.orderId || '').trim();
  console.log('[debug-delete] request for orderId:', orderId, 'by', req.session && req.session.user ? req.session.user.email : null);
  if (!orderId) return res.status(400).json({ error: 'orderId required' });
  try {
    const rows = await q('SELECT id FROM orders WHERE order_id = ? LIMIT 1', [orderId]);
    if (!rows || !rows.length) return res.status(404).json({ error: 'Order not found in DB' });
    const id = rows[0].id;
    await q('DELETE FROM order_items WHERE order_id_fk = ?', [id]);
    await q('DELETE FROM orders WHERE id = ?', [id]);
    console.log('[debug-delete] deleted order:', orderId, 'id=', id);
    return res.json({ ok: true, deletedOrderId: orderId });
  } catch (e) {
    console.error('[debug-delete] error deleting order:', e && e.stack ? e.stack : e);
    return res.status(500).json({ error: 'DB error', details: e && e.message ? e.message : String(e) });
  }
});

// Ensure orders tables exist before starting server to avoid runtime errors during purchase
async function ensureOrdersTablesAndStart() {
  const util = require('util');
  const q = util.promisify(db.query).bind(db);
  const sqlOrders = `
    CREATE TABLE IF NOT EXISTS orders (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id VARCHAR(255) NOT NULL,
      user_email VARCHAR(255),
      user_name VARCHAR(255),
      address TEXT,
      contact VARCHAR(100),
      total DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  const sqlItems = `
    CREATE TABLE IF NOT EXISTS order_items (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      order_id_fk INT NOT NULL,
      product_id INT,
      product_name VARCHAR(255),
      quantity INT DEFAULT 0,
      price DECIMAL(12,2) DEFAULT 0,
      image VARCHAR(255),
      FOREIGN KEY (order_id_fk) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  try {
    await q(sqlOrders);
    await q(sqlItems);
    console.log('✅ Orders tables ensured.');
    // Ensure products table has a `discount` column (percentage, e.g. 10.00 for 10%)
    try {
      await q("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount DECIMAL(5,2) DEFAULT 0.00");
      console.log('✅ products.discount column ensured.');
    } catch (e) {
      // Some MySQL versions may not support IF NOT EXISTS for ADD COLUMN — fallback to check and add
      try {
        const rows = await q("SHOW COLUMNS FROM products LIKE 'discount'");
        if (!rows || rows.length === 0) {
          await q("ALTER TABLE products ADD COLUMN discount DECIMAL(5,2) DEFAULT 0.00");
          console.log('✅ products.discount column added.');
        } else {
          console.log('✅ products.discount column already present.');
        }
      } catch (ee) {
        console.warn('Could not ensure products.discount column:', ee && ee.message ? ee.message : ee);
      }
    }
    // Ensure products table has a `description` column (TEXT) to store product descriptions
    try {
      await q("ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT NULL");
      console.log('✅ products.description column ensured.');
    } catch (e) {
      try {
        const rowsDesc = await q("SHOW COLUMNS FROM products LIKE 'description'");
        if (!rowsDesc || rowsDesc.length === 0) {
          await q("ALTER TABLE products ADD COLUMN description TEXT NULL");
          console.log('✅ products.description column added.');
        } else {
          console.log('✅ products.description column already present.');
        }
      } catch (ee) {
        console.warn('Could not ensure products.description column:', ee && ee.message ? ee.message : ee);
      }
    }
  } catch (e) {
    console.error('Failed to ensure orders tables at startup:', e && e.stack ? e.stack : e);
    // continue to start server so developer can still access routes; purchases will fail until tables exist
  }

  app.listen(PORT, () => {
    console.log(`✅ Server running at ${url}`);
  });
}

ensureOrdersTablesAndStart();
