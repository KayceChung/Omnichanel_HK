const router = require('express').Router();
const { pool } = require('../db');

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*,
        json_agg(
          json_build_object(
            'platform_id',          pl.platform_id,
            'platform_name',        pt.name,
            'platform_display_name',pt.display_name,
            'external_id',          pl.external_id,
            'status',               pl.status,
            'last_synced_at',       pl.last_synced_at
          )
        ) FILTER (WHERE pl.id IS NOT NULL) AS listings
      FROM products p
      LEFT JOIN platform_listings pl ON pl.product_id = p.id
      LEFT JOIN platforms pt ON pt.id = pl.platform_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { title, description, base_price, currency } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (title, description, base_price, currency)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, description, base_price, currency || 'USD']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { title, description, base_price, currency, status } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products
       SET title=$1, description=$2, base_price=$3, currency=$4, status=$5, updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [title, description, base_price, currency, status, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enqueue a push-to-platform job
router.post('/:id/push', async (req, res) => {
  const { platform_id } = req.body;
  try {
    const { rows: prod } = await pool.query('SELECT * FROM products WHERE id=$1', [req.params.id]);
    if (!prod.length) return res.status(404).json({ error: 'Product not found' });

    const { rows: listing } = await pool.query(
      `INSERT INTO platform_listings (product_id, platform_id, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (product_id, platform_id)
       DO UPDATE SET status='pending', updated_at=NOW()
       RETURNING *`,
      [req.params.id, platform_id]
    );

    const { rows: job } = await pool.query(
      `INSERT INTO jobs (type, platform_id, product_id, listing_id, payload, status)
       VALUES ('push_product', $1, $2, $3, $4, 'pending') RETURNING *`,
      [platform_id, req.params.id, listing[0].id, JSON.stringify(prod[0])]
    );

    res.status(201).json(job[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
