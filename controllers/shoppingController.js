// shoppingController.js
const db = require('../db');

exports.shoppingView = (req, res) => {
  const selectedCategory = req.query.category || 'All';
  const minPriceRaw = req.query.minPrice;
  const maxPriceRaw = req.query.maxPrice;

  const staticCategories = ['Fruits', 'Vegetables', 'Drinks', 'Snacks', 'Others'];

  // Try to get distinct categories from DB, but always fall back to static list
  db.query('SELECT DISTINCT category FROM products', (catErr, catResults) => {
    let dbCategories = [];
    if (!catErr && Array.isArray(catResults)) {
      // Trim and normalize DB categories (remove null/empty, trim spaces)
      dbCategories = (catResults || [])
        .map(r => (r.category == null ? '' : String(r.category).trim()))
        .filter(c => c !== '')
        .map(c => {
          // normalize specific singular/plural cases to plural form
          const low = c.toLowerCase();
          if (low === 'snack' || low === 'snacks') return 'Snacks';
          if (low === 'other' || low === 'others') return 'Others';
          // default: keep original trimmed value
          return c;
        });
    }

    // Merge DB categories with static ones and deduplicate
    const categoriesSet = new Set([...staticCategories.map(s => String(s).trim()), ...dbCategories]);
    const categories = Array.from(categoriesSet);

    // Validate and parse price range values
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
      // swap to be forgiving
      const t = minPrice; minPrice = maxPrice; maxPrice = t;
    }

    // Build product query depending on selected category and price filters
    let sql = 'SELECT * FROM products';
    const where = [];
    const params = [];
    // Log incoming query for easier debugging
    console.log('[shoppingController] req.query:', req.query);
    if (selectedCategory && selectedCategory !== 'All') {
      // Accept plural/singular variants (e.g. 'Snacks' vs 'Snack') and match case-insensitive trimmed
      const target = String(selectedCategory).trim();
      const lowTarget = target.toLowerCase();
      const variants = new Set([lowTarget]);
      if (lowTarget.endsWith('s')) variants.add(lowTarget.slice(0, -1)); else variants.add(lowTarget + 's');

      // Keywords to match against productName when category column is missing or inconsistent
      const keywordMap = {
        'snacks': ['chip', 'crisps', 'snack', 'cookie', 'cake', 'chocolate', 'chips', 'ruffle', 'pringle', 'dorito', 'lays'],
        'fruits': ['apple', 'banana', 'orange', 'grape', 'pear', 'mango', 'pineapple', 'melon', 'berry', 'strawberry'],
        'vegetables': ['tomato', 'broccoli', 'lettuce', 'spinach', 'cabbage', 'carrot', 'potato', 'onion', 'pepper', 'corn', 'beans'],
        'drinks': ['milk', 'water', 'juice', 'soda', 'cola', 'beer', 'wine', 'coffee', 'tea', 'sparkling'],
        'others': ['bread', 'rice', 'noodle', 'pasta', 'sauce', 'cereal', 'seasoning', 'spice', 'condiment', 'soap', 'cleaner']
      };

      const nameKeywords = keywordMap[lowTarget] || [];

      // Build clause that checks category IN (variants) OR productName LIKE keywords
      const variantsArr = Array.from(variants);
      const clauseParts = [];
      if (variantsArr.length) {
        const placeholders = variantsArr.map(() => '?').join(',');
        clauseParts.push(`LOWER(TRIM(category)) IN (${placeholders})`);
        variantsArr.forEach(v => params.push(v));
      }
      // Add name-based LIKE comparisons
      nameKeywords.forEach((kw) => {
        clauseParts.push('LOWER(productName) LIKE ?');
        params.push('%' + kw.toLowerCase() + '%');
      });

      if (clauseParts.length) {
        where.push('(' + clauseParts.join(' OR ') + ')');
      }
      console.log('[shoppingController] category filter variants:', variantsArr);
      console.log('[shoppingController] name keywords used:', nameKeywords);
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

    // Debug: log query and params for troubleshooting category filtering
    console.log('[shoppingController] SQL:', sql);
    console.log('[shoppingController] params:', params);

    db.query(sql, params, (error, results) => {
      if (error) {
        // If the error indicates missing category column, try again without category filter
        if ((error.code === 'ER_BAD_FIELD_ERROR' || /Unknown column/i.test(error.message || '')) && /category/i.test(error.message || '')) {
          console.warn('Category column missing; retrying without category filter. Error:', error.message || error);
          // rebuild query without category but keep price filters
          const where2 = [];
          const params2 = [];
          if (minPrice !== null) {
            where2.push('price >= ?');
            params2.push(minPrice);
          }
          if (maxPrice !== null) {
            where2.push('price <= ?');
            params2.push(maxPrice);
          }
          let sql2 = 'SELECT * FROM products';
          if (where2.length) sql2 += ' WHERE ' + where2.join(' AND ');
          db.query(sql2, params2, (err2, results2) => {
            if (err2) {
              console.error('Error fetching products after fallback:', err2);
              return res.status(500).send('Error loading products');
            }
            // Attempt server-side normalization/filtering so users can still filter even if DB column is missing
              let finalProducts = results2;
              if (selectedCategory && selectedCategory !== 'All') {
                const target = String(selectedCategory).trim().toLowerCase();
                const variants = new Set([target]);
                if (target.endsWith('s')) variants.add(target.slice(0, -1)); else variants.add(target + 's');
                const nameKeywords = (function() {
                  const km = {
                    'snacks': ['chip','crisps','snack','cookie','cake','chocolate','chips','ruffle','pringle','dorito','lays'],
                    'fruits': ['apple','banana','orange','grape','pear','mango','pineapple','melon','berry','strawberry'],
                    'vegetables': ['tomato','broccoli','lettuce','spinach','cabbage','carrot','potato','onion','pepper','corn','beans'],
                    'drinks': ['milk','water','juice','soda','cola','beer','wine','coffee','tea','sparkling'],
                    'others': ['bread','rice','noodle','pasta','sauce','cereal','seasoning','spice','condiment','soap','cleaner']
                  };
                  return km[target] || [];
                })();
                finalProducts = results2.filter(p => {
                  const cat = (p.category == null ? '' : String(p.category).trim().toLowerCase());
                  const name = (p.productName == null ? '' : String(p.productName).toLowerCase());
                  const catMatch = Array.from(variants).some(v => cat === v);
                  const nameMatch = nameKeywords.some(kw => name.indexOf(kw) !== -1);
                  return catMatch || nameMatch;
                });
                console.log('[shoppingController] fallback post-filter: before=', results2.length, 'after=', finalProducts.length);
              }
            return res.render('shopping', {
              products: finalProducts,
              user: req.session.user,
              categories,
              selectedCategory: selectedCategory,
              minPrice: minPrice !== null ? minPrice : undefined,
              maxPrice: maxPrice !== null ? maxPrice : undefined,
            });
          });
          return;
        }
        console.error('Error fetching products:', error);
        return res.status(500).send('Error loading products');
      }
      // Apply a server-side post-filter for category to handle DB value inconsistencies
      let finalResults = results;
      if (selectedCategory && selectedCategory !== 'All') {
        const target = String(selectedCategory).trim().toLowerCase();
        const variants = new Set([target]);
        if (target.endsWith('s')) variants.add(target.slice(0, -1)); else variants.add(target + 's');
        // compute nameKeywords same as above
        const nameKeywords = (function() {
          const km = {
            'snacks': ['chip','crisps','snack','cookie','cake','chocolate','chips','ruffle','pringle','dorito','lays'],
            'fruits': ['apple','banana','orange','grape','pear','mango','pineapple','melon','berry','strawberry'],
            'vegetables': ['tomato','broccoli','lettuce','spinach','cabbage','carrot','potato','onion','pepper','corn','beans'],
            'drinks': ['milk','water','juice','soda','cola','beer','wine','coffee','tea','sparkling'],
            'others': ['bread','rice','noodle','pasta','sauce','cereal','seasoning','spice','condiment','soap','cleaner']
          };
          return km[target] || [];
        })();
        finalResults = (results || []).filter(p => {
          const cat = (p.category == null ? '' : String(p.category).trim().toLowerCase());
          const name = (p.productName == null ? '' : String(p.productName).toLowerCase());
          const catMatch = Array.from(variants).some(v => cat === v);
          const nameMatch = nameKeywords.some(kw => name.indexOf(kw) !== -1);
          return catMatch || nameMatch;
        });
        console.log('[shoppingController] post-filter: before=', (results || []).length, 'after=', finalResults.length);
      }
      return res.render('shopping', {
        products: finalResults,
        user: req.session.user,
        categories,
        selectedCategory,
        minPrice: minPrice !== null ? minPrice : undefined,
        maxPrice: maxPrice !== null ? maxPrice : undefined,
      });
    });
  });
};
