const db = require('../db');

// List products (inventory) with optional category and price filters
exports.listInventory = (req, res) => {
  const selectedCategory = req.query.category || 'All';
  const minPriceRaw = req.query.minPrice;
  const maxPriceRaw = req.query.maxPrice;

  const staticCategories = ['Fruits', 'Vegetables', 'Drinks', 'Snacks', 'Others'];

  // Get DB categories (if column exists) and merge with static set
  db.query('SELECT DISTINCT category FROM products', (catErr, catResults) => {
    let dbCategories = [];
    if (!catErr && Array.isArray(catResults)) {
      dbCategories = (catResults || [])
        .map(r => (r.category == null ? '' : String(r.category).trim()))
        .filter(c => c !== '')
        .map(c => {
          const low = c.toLowerCase();
          if (low === 'snack' || low === 'snacks') return 'Snacks';
          if (low === 'other' || low === 'others') return 'Others';
          return c;
        });
    }
    const categories = Array.from(new Set([...staticCategories.map(s => String(s).trim()), ...dbCategories]));

    // parse price filters
    let minPrice = null;
    let maxPrice = null;
    if (typeof minPriceRaw !== 'undefined' && minPriceRaw !== '') {
      const n = parseFloat(minPriceRaw);
      if (!isNaN(n) && n >= 0) minPrice = n;
    }
    if (typeof maxPriceRaw !== 'undefined' && maxPriceRaw !== '') {
      const n = parseFloat(maxPriceRaw);
      if (!isNaN(n) && n >= 0) maxPrice = n;
    }
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      const t = minPrice; minPrice = maxPrice; maxPrice = t;
    }

    // build query
    let sql = 'SELECT * FROM products';
    const where = [];
    const params = [];
    if (selectedCategory && selectedCategory !== 'All') {
      const target = String(selectedCategory).trim();
      const lowTarget = target.toLowerCase();
      const variants = new Set([lowTarget]);
      if (lowTarget.endsWith('s')) variants.add(lowTarget.slice(0, -1));
      else variants.add(lowTarget + 's');
      const placeholders = Array.from(variants).map(() => 'LOWER(TRIM(?))').join(',');
      where.push(`LOWER(TRIM(category)) IN (${placeholders})`);
      Array.from(variants).forEach(v => params.push(v));
    }
    if (minPrice !== null) {
      where.push('price >= ?');
      params.push(minPrice);
    }
    if (maxPrice !== null) {
      where.push('price <= ?');
      params.push(maxPrice);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');

    // Debug: log query and params for troubleshooting inventory filtering
    console.log('[productController] SQL:', sql);
    console.log('[productController] params:', params);

    db.query(sql, params, (error, results) => {
      if (error) {
        // if category column missing, retry without category but keep price filters
        if ((error.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(error.message || '')) && /category/i.test(error.message || '')) {
          console.warn('Category column missing in products; retrying without category filter.');
          const where2 = [];
          const params2 = [];
          if (minPrice !== null) { where2.push('price >= ?'); params2.push(minPrice); }
          if (maxPrice !== null) { where2.push('price <= ?'); params2.push(maxPrice); }
          let sql2 = 'SELECT * FROM products';
          if (where2.length) sql2 += ' WHERE ' + where2.join(' AND ');
          db.query(sql2, params2, (err2, results2) => {
            if (err2) {
              console.error('Error fetching products after fallback:', err2);
              return res.status(500).send('Error loading products');
            }
            return res.render('inventory', {
              products: results2,
              user: req.session.user,
              categories,
              selectedCategory: 'All',
              minPrice: minPrice !== null ? minPrice : undefined,
              maxPrice: maxPrice !== null ? maxPrice : undefined,
            });
          });
          return;
        }
        console.error('Error fetching products:', error);
        return res.status(500).send('Error loading products');
      }
      return res.render('inventory', {
        products: results,
        user: req.session.user,
        categories,
        selectedCategory,
        minPrice: minPrice !== null ? minPrice : undefined,
        maxPrice: maxPrice !== null ? maxPrice : undefined,
      });
    });
  });
};

// Show product details
exports.showProduct = (req, res) => {
  db.query('SELECT * FROM products WHERE id = ?', [req.params.id], (error, results) => {
    if (error) {
      console.error('Error fetching product:', error);
      return res.status(500).send('Error loading product');
    }
    if (!results.length) return res.status(404).send('Product not found');
    res.render('product', { product: results[0], user: req.session.user });
  });
};

// Render add product form
exports.renderAddProduct = (req, res) => {
  res.render('addProduct', { user: req.session.user });
};

// Add a new product
exports.addProduct = (req, res) => {
  const { name, quantity, price } = req.body;
  const image = req.file ? req.file.filename : null;
  db.query(
    'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)',
    [name, quantity, price, image],
    (error) => {
      if (error) {
        console.error('Error adding product:', error);
        return res.status(500).send('Error adding product');
      }
      res.redirect('/inventory');
    }
  );
};

// Render update product form
exports.renderUpdateProduct = (req, res) => {
  db.query('SELECT * FROM products WHERE id = ?', [req.params.id], (error, results) => {
    if (error) {
      console.error('Error fetching product:', error);
      return res.status(500).send('Error loading product');
    }
    if (!results.length) return res.status(404).send('Product not found');
    res.render('updateProduct', { product: results[0], user: req.session.user });
  });
};

// Update a product
exports.updateProduct = (req, res) => {
  const { name, quantity, price } = req.body;
  const image = req.file ? req.file.filename : req.body.currentImage;
  db.query(
    'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?',
    [name, quantity, price, image, req.params.id],
    (error) => {
      if (error) {
        console.error('Error updating product:', error);
        return res.status(500).send('Error updating product');
      }
      res.redirect('/inventory');
    }
  );
};

// Delete a product
exports.deleteProduct = (req, res) => {
  db.query('DELETE FROM products WHERE id = ?', [req.params.id], (error) => {
    if (error) {
      console.error('Error deleting product:', error);
      return res.status(500).send('Error deleting product');
    }
    res.redirect('/inventory');
  });
};
