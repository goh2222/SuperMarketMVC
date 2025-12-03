// adminController.js
// Handles admin-only product management
const db = require('../db');

exports.renderAddProduct = (req, res) => {
  res.render('addProduct', { user: req.session.user });
};

exports.addProduct = (req, res) => {
  const { name, quantity, price, category, discount, description } = req.body;
  const image = req.file ? req.file.filename : null;
  const disc = (typeof discount !== 'undefined' && discount !== null && discount !== '') ? parseFloat(discount) : 0.0;
  const desc = (typeof description !== 'undefined' && description !== null) ? description : null;
  db.query(
    'INSERT INTO products (productName, quantity, price, image, category, discount, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [name, quantity, price, image, category, disc, desc],
    (error) => {
      if (error) {
        // If some product columns don't exist (category/discount/description), fallback to simpler insert
        if (error.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(error.message || '')) {
          console.warn('products columns missing — inserting without category/discount/description');
          db.query(
            'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)',
            [name, quantity, price, image],
            (err2) => {
              if (err2) {
                console.error('Error adding product (fallback):', err2);
                return res.status(500).send('Error adding product');
              }
              return res.redirect('/inventory');
            }
          );
          return;
        }
        console.error('Error adding product:', error);
        return res.status(500).send('Error adding product');
      }
      res.redirect('/inventory');
    }
  );
};

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

exports.updateProduct = (req, res) => {
  const { name, quantity, price, category, discount, description } = req.body;
  const image = req.file ? req.file.filename : req.body.currentImage;
  const disc = (typeof discount !== 'undefined' && discount !== null && discount !== '') ? parseFloat(discount) : 0.0;
  const desc = (typeof description !== 'undefined' && description !== null) ? description : null;
  db.query(
    'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ?, category = ?, discount = ?, description = ? WHERE id = ?',
    [name, quantity, price, image, category, disc, desc, req.params.id],
    (error) => {
      if (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(error.message || '')) {
          console.warn('products columns missing — updating without category/discount/description');
          db.query(
            'UPDATE products SET productName = ?, quantity = ?, price = ?, image = ? WHERE id = ?',
            [name, quantity, price, image, req.params.id],
            (err2) => {
              if (err2) {
                console.error('Error updating product (fallback):', err2);
                return res.status(500).send('Error updating product');
              }
              return res.redirect('/inventory');
            }
          );
          return;
        }
        console.error('Error updating product:', error);
        return res.status(500).send('Error updating product');
      }
      res.redirect('/inventory');
    }
  );
};

exports.deleteProduct = (req, res) => {
  db.query('DELETE FROM products WHERE id = ?', [req.params.id], (error) => {
    if (error) {
      console.error('Error deleting product:', error);
      return res.status(500).send('Error deleting product');
    }
    res.redirect('/inventory');
  });
};
