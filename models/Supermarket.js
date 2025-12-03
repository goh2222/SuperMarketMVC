// models/Supermarket.js
const db = require('../db');

const Supermarket = {
  // Get all products
  getAll: (callback) => {
    const query = 'SELECT * FROM supermarket';
    db.query(query, (err, results) => {
      if (err) {
        console.error('🔥 MYSQL ERROR:', err.message);
        return callback(err);
      }
      callback(null, results);
    });
  },

  // Get product by ID
  getById: (id, callback) => {
    const query = 'SELECT * FROM supermarket WHERE productId = ?';
    db.query(query, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0]);
    });
  },

  // Add new product
  add: (product, callback) => {
    const { name, quantity, price, image } = product;
    const query =
      'INSERT INTO supermarket (name, quantity, price, image) VALUES (?, ?, ?, ?)';
    db.query(query, [name, quantity, price, image], (err, results) => {
      if (err) return callback(err);
      callback(null, { productId: results.insertId, ...product });
    });
  },

  // Update product
  update: (id, updatedData, callback) => {
    const { name, quantity, price, image } = updatedData;
    const query =
      'UPDATE supermarket SET name = ?, quantity = ?, price = ?, image = ? WHERE productId = ?';
    db.query(query, [name, quantity, price, image, id], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },

  // Delete product
  delete: (id, callback) => {
    const query = 'DELETE FROM supermarket WHERE productId = ?';
    db.query(query, [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },
};

module.exports = Supermarket;
