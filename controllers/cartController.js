// Cart controller
exports.addToCart = (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const quantity = parseInt(req.body.quantity, 10) || 1;
  const db = require('../db');
  db.query('SELECT * FROM products WHERE id = ?', [productId], (err, results) => {
    if (err) {
      console.error('Error fetching product for cart:', err);
      return res.status(500).send('Error adding to cart');
    }
    if (!results.length) return res.status(404).send('Product not found');
    const product = results[0];
    // compute effective price after product-level discount (if any)
    const disc = (typeof product.discount !== 'undefined' && product.discount !== null) ? Number(product.discount) : 0;
    const effectivePrice = (isFinite(product.price) ? Number(product.price) : 0) * (1 - (isFinite(disc) ? disc / 100 : 0));
    if (!req.session.cart) req.session.cart = [];
    const existing = req.session.cart.find((item) => item.id === product.id);
    const available = product.quantity;
    let newQuantity = quantity;
    if (existing) {
      newQuantity = Math.min(existing.quantity + quantity, available);
      existing.quantity = newQuantity;
    } else {
      newQuantity = Math.min(quantity, available);
      req.session.cart.push({
        id: product.id,
        productName: product.productName,
        price: Number(effectivePrice.toFixed(2)),
        originalPrice: Number(product.price),
        discount: disc,
        quantity: newQuantity,
        image: product.image,
      });
    }
    if (quantity > available || (existing && existing.quantity + quantity > available)) {
      req.flash('error', `Only ${available} available in stock. Quantity limited.`);
    } else {
      req.flash('success', `${product.productName} added to cart.`);
    }
    // Redirect back to referring page (shopping) instead of always going to /cart
    const back = req.get('Referer') || '/shopping';
    return res.redirect(back);
  });
};

exports.addToCartGet = (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const quantity = parseInt(req.query.quantity, 10) || 1;
  const db = require('../db');
  db.query('SELECT * FROM products WHERE id = ?', [productId], (err, results) => {
    if (err) {
      console.error('Error fetching product for cart (GET):', err);
      return res.status(500).send('Error adding to cart');
    }
    if (!results.length) return res.status(404).send('Product not found');
    const product = results[0];
    const disc = (typeof product.discount !== 'undefined' && product.discount !== null) ? Number(product.discount) : 0;
    const effectivePrice = (isFinite(product.price) ? Number(product.price) : 0) * (1 - (isFinite(disc) ? disc / 100 : 0));
    if (!req.session.cart) req.session.cart = [];
    const existing = req.session.cart.find((item) => item.id === product.id);
    const available = product.quantity;
    let newQuantity = quantity;
    if (existing) {
      newQuantity = Math.min(existing.quantity + quantity, available);
      existing.quantity = newQuantity;
    } else {
      newQuantity = Math.min(quantity, available);
      req.session.cart.push({
        id: product.id,
        productName: product.productName,
        price: Number(effectivePrice.toFixed(2)),
        originalPrice: Number(product.price),
        discount: disc,
        quantity: newQuantity,
        image: product.image,
      });
    }
    if (quantity > available || (existing && existing.quantity + quantity > available)) {
      req.flash('error', `Only ${available} available in stock. Quantity limited.`);
    } else {
      req.flash('success', `${product.productName} added to cart.`);
    }
    const back = req.get('Referer') || '/shopping';
    return res.redirect(back);
  });
};

exports.viewCart = (req, res) => {
  const cart = req.session.cart || [];
  res.render('cart', { cart, user: req.session.user });
};

// Process a purchase: compute total, persist order, clear cart, render success page
exports.purchase = async (req, res) => {
  const cart = req.session.cart || [];
  console.log('[cartController] ENTER purchase handler - sessionID=', req && req.sessionID ? req.sessionID : 'no-session');
  try {
    console.log('[cartController] headers.cookie=', req && req.headers ? req.headers.cookie : 'no-headers');
  } catch (e) {
    console.warn('[cartController] could not log cookies', e);
  }
  try {
    console.log('[cartController] session.cart length=', Array.isArray(req.session && req.session.cart) ? req.session.cart.length : 'no-cart');
  } catch (e) {
    console.warn('[cartController] failed to inspect cart for debug log', e);
  }

  if (!cart.length) {
    // No items to purchase. If a lastPurchase exists, show success; otherwise redirect to cart.
    if (req.session && req.session.lastPurchase) {
      try {
        return req.session.save(() => res.redirect('/success'));
      } catch (e) {
        return res.redirect('/success');
      }
    }
    req.flash('error', 'Your cart is empty.');
    try {
      return req.session.save(() => res.redirect('/cart'));
    } catch (e) {
      return res.redirect('/cart');
    }
  }

  const total = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);
  const db = require('../db');
  const util = require('util');
  const query = util.promisify(db.query).bind(db);
  const beginTransaction = util.promisify(db.beginTransaction).bind(db);
  const commit = util.promisify(db.commit).bind(db);
  const rollback = util.promisify(db.rollback).bind(db);

  const purchasedItems = cart.map(i => ({ id: i.id, productName: i.productName, quantity: i.quantity, price: i.price, image: i.image || null }));

  // helper to save session then redirect
  const redirectWithFlash = (path) => {
    try {
      return req.session.save(() => res.redirect(path));
    } catch (e) {
      console.warn('[cartController] session.save failed while redirecting:', e);
      return res.redirect(path);
    }
  };

  const redirectPreferSuccessIfAvailable = () => {
    if (req.session && req.session.lastPurchase) {
      try {
        return req.session.save(() => res.redirect('/success'));
      } catch (e) {
        return res.redirect('/success');
      }
    }
    return redirectWithFlash('/cart');
  };

  try {
    console.log('[cartController] beginning transaction');
    await beginTransaction();

    for (const item of purchasedItems) {
      const rows = await query('SELECT quantity, productName FROM products WHERE id = ? FOR UPDATE', [item.id]);
      if (!rows || rows.length === 0) {
        await rollback();
        req.flash('error', `Product not found (${item.productName || item.id}). Purchase aborted.`);
        return redirectPreferSuccessIfAvailable();
      }
      const available = rows[0].quantity;
      if (available < item.quantity) {
        await rollback();
        req.flash('error', `Insufficient stock for ${item.productName || item.id}. Only ${available} left.`);
        return redirectPreferSuccessIfAvailable();
      }
    }

    const orderId = `ord_${Date.now()}_${Math.floor(Math.random()*10000)}`;

    // enrich user from DB if possible
    let orderUser = req.session.user || null;
    if (orderUser && orderUser.email) {
      try {
        const utilLocal = require('util');
        const dbLocal = require('../db');
        const qLocal = utilLocal.promisify(dbLocal.query).bind(dbLocal);
        const rows = await qLocal('SELECT username, email, address, contact FROM users WHERE email = ?', [orderUser.email]);
        if (rows && rows.length) {
          const u = rows[0];
          orderUser = {
            username: u.username || orderUser.username,
            email: u.email || orderUser.email,
            address: u.address || null,
            contact: u.contact || null,
          };
        }
      } catch (e) {
        console.warn('[cartController] could not enrich user info for order record', e);
      }
    }

    const insertOrderSql = 'INSERT INTO orders (order_id, user_email, user_name, address, contact, total) VALUES (?, ?, ?, ?, ?, ?)';
    const orderResult = await query(insertOrderSql, [orderId, orderUser && orderUser.email ? orderUser.email : null, orderUser && orderUser.username ? orderUser.username : null, orderUser && orderUser.address ? orderUser.address : null, orderUser && orderUser.contact ? orderUser.contact : null, total.toFixed(2)]);
    const orderPk = orderResult && (orderResult.insertId || (orderResult[0] && orderResult[0].insertId)) ? (orderResult.insertId || orderResult[0].insertId) : null;
    if (!orderPk) {
      await rollback();
      console.error('[cartController] order insert did not return insertId for', orderId, orderResult);
      req.flash('error', 'Failed to save order. Purchase aborted.');
      return redirectPreferSuccessIfAvailable();
    }

    for (const it of purchasedItems) {
      try {
        await query('INSERT INTO order_items (order_id_fk, product_id, product_name, quantity, price, image) VALUES (?, ?, ?, ?, ?, ?)', [orderPk, it.id, it.productName, it.quantity, it.price || 0, it.image || null]);
      } catch (e) {
        console.warn('[cartController] failed to insert order item for order', orderId, it.id, e);
        await rollback();
        req.flash('error', 'Failed to save order items. Purchase aborted.');
        return redirectPreferSuccessIfAvailable();
      }
    }

    for (const item of purchasedItems) {
      try {
        const before = await query('SELECT quantity FROM products WHERE id = ? FOR UPDATE', [item.id]);
        console.log('[cartController] before update product', item.id, 'available=', before && before[0] ? before[0].quantity : 'unknown');
      } catch (e) {
        console.warn('[cartController] could not read pre-update qty for', item.id, e);
      }
      await query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.id]);
      try {
        const after = await query('SELECT quantity FROM products WHERE id = ?', [item.id]);
        console.log('[cartController] after update product', item.id, 'available=', after && after[0] ? after[0].quantity : 'unknown');
      } catch (e) {
        console.warn('[cartController] could not read post-update qty for', item.id, e);
      }
    }

    await commit();
    console.log('[cartController] COMMIT OK - orderId=', orderId);

    // update session-only order history and lastPurchase
    try {
      const orderRecord = {
        orderId,
        user: orderUser,
        total: total.toFixed(2),
        items: purchasedItems,
        createdAt: new Date().toISOString()
      };
      if (!req.session.orderHistory) req.session.orderHistory = [];
      req.session.orderHistory.push(orderRecord);
      req.session.lastPurchase = orderRecord;
    } catch (e) {
      console.warn('[cartController] failed to update session orderHistory', e);
    }

    try {
      console.log('[cartController] purchase complete - sessionID=', req.sessionID, 'orderId=', orderId, 'items=', purchasedItems.map(i=>i.id), 'total=', total.toFixed(2));
    } catch (e) {
      console.log('[cartController] purchase complete (error serializing)');
    }

    // Clear cart and save session before redirecting to ensure session persistence
    req.session.cart = [];
    req.session.save((saveErr) => {
      if (saveErr) console.warn('[cartController] session save error after purchase:', saveErr);
      console.log('[cartController] redirecting to /success - orderId=', orderId);
      return res.redirect('/success');
    });
  } catch (err) {
    try { await rollback(); } catch (e) { /* ignore rollback errors */ }
    // Log detailed error info to help debugging (stack, session snapshot, request body and headers)
    try {
      console.error('[cartController] Error during transactional purchase: ', err && err.stack ? err.stack : err);
    } catch (e) {
      console.error('[cartController] Error during transactional purchase (could not serialize stack):', err);
    }
    try {
      console.error('[cartController] Request body:', JSON.stringify(req.body || {}));
    } catch (e) {
      console.error('[cartController] Could not stringify request body', e);
    }
    try {
      console.error('[cartController] Request headers (cookie may be present):', JSON.stringify(req.headers || {}));
    } catch (e) {
      console.error('[cartController] Could not stringify request headers', e);
    }
    try {
      // Avoid leaking full session to logs in production, but include useful keys for debugging
      const sessionSnapshot = {
        sessionID: req.sessionID,
        cartLength: Array.isArray(req.session && req.session.cart) ? req.session.cart.length : 0,
        orderHistoryLength: Array.isArray(req.session && req.session.orderHistory) ? req.session.orderHistory.length : 0,
        lastPurchase: req.session && req.session.lastPurchase ? req.session.lastPurchase.orderId || true : false,
        user: req.session && req.session.user ? { email: req.session.user.email || null, username: req.session.user.username || null } : null
      };
      console.error('[cartController] Session snapshot:', JSON.stringify(sessionSnapshot));
    } catch (e) {
      console.error('[cartController] Could not stringify session snapshot', e);
    }

    req.flash('error', 'Purchase failed due to server error. Please try again. (' + (err && err.message ? err.message : String(err)) + ')');
    console.log('[cartController] redirecting to /cart due to error');
    return redirectPreferSuccessIfAvailable();
  }
};

// Remove an item from the session cart by product id
exports.removeFromCart = (req, res) => {
  const rawId = req.params.id;
  const productId = Number(rawId);
  console.log('[cartController] removeFromCart called for id=', rawId);
  if (req.session && Array.isArray(req.session.cart)) {
    // Compare as strings to be robust if stored ids are strings
    req.session.cart = req.session.cart.filter(item => String(item.id) !== String(rawId) && String(item.id) !== String(productId));
  }
  // Render a small confirmation page with navigation options
  return res.render('remove-from-cart', { user: req.session.user });
};
