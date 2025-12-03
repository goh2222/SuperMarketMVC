// models/Supermarket.js
const db = require('../db');   // make sure this points to your db.js

const Supermarket = {
  getAll: (callback) => {
    db.query('SELECT * FROM supermarket', (err, results) => {
      if (err) {
        console.error('DB ERROR:', err);
        return callback(err);
      }
      callback(null, results);
    });
  },

  getById: (id, callback) => {
    db.query('SELECT * FROM supermarket WHERE productId = ?', [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results[0]);
    });
  },
  
  add: (product, callback) => {
    const { name, quantity, price, image } = product;
    db.query(
      'INSERT INTO supermarket (name, quantity, price, image) VALUES (?, ?, ?, ?)',
      [name, quantity, price, image],
      (err, results) => {
        if (err) return callback(err);
        callback(null, { productId: results.insertId, ...product });
      }
    );
  },

  update: (id, updatedData, callback) => {
    const { name, quantity, price, image } = updatedData;
    db.query(
      'UPDATE supermarket SET name=?, quantity=?, price=?, image=? WHERE productId=?',
      [name, quantity, price, image, id],
      (err, results) => {
        if (err) return callback(err);
        callback(null, results);
      }
    );
  },

  delete: (id, callback) => {
    db.query('DELETE FROM supermarket WHERE productId = ?', [id], (err, results) => {
      if (err) return callback(err);
      callback(null, results);
    });
  },
};

module.exports = Supermarket;
