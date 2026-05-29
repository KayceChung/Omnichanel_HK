const router = require('express').Router();
const { pool } = require('../db');

// Extension polls this endpoint
router.get('/pending', async (req, res) => {
  const { platform } = req.query;
  try {
    const params = [];
    let where = "WHERE j.status = 'pending'";
    if (platform) {
      params.push(platform);
      where += ` AND p.name = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT j.*, p.name AS platform_name, p.display_name AS platform_display_name,
              pr.title AS product_title
       FROM jobs j
       JOIN platforms p ON p.id = j.platform_id
       LEFT JOIN products pr ON pr.id = j.product_id
       ${where}
       ORDER BY j.created_at ASC
       LIMIT 10`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extension claims a job (atomic: only succeeds if still pending)
router.post('/:id/claim', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE jobs SET status='running', claimed_at=NOW()
       WHERE id=$1 AND status='pending' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Job already claimed or not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Extension reports outcome
router.post('/:id/complete', async (req, res) => {
  const { result, error, external_id } = req.body;
  const status = error ? 'failed' : 'done';
  try {
    const { rows } = await pool.query(
      `UPDATE jobs
       SET status=$1, result=$2, error=$3, completed_at=NOW()
       WHERE id=$4 RETURNING *`,
      [status, result ? JSON.stringify(result) : null, error || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Job not found' });

    const listingId = rows[0].listing_id;
    if (listingId) {
      if (!error) {
        await pool.query(
          `UPDATE platform_listings
           SET status='live', external_id=$1, last_synced_at=NOW(), updated_at=NOW()
           WHERE id=$2`,
          [external_id || null, listingId]
        );
      } else {
        await pool.query(
          `UPDATE platform_listings SET status='error', updated_at=NOW() WHERE id=$1`,
          [listingId]
        );
      }
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recent jobs of a given type (for progress tracking)
router.get('/recent', async (req, res) => {
  const { type, after } = req.query;
  if (!type) return res.status(400).json({ error: 'type required' });
  try {
    const afterTs = after ? new Date(Number(after)) : new Date(Date.now() - 30 * 60 * 1000);
    const { rows } = await pool.query(
      `SELECT id, type, status, error, result, created_at, completed_at
       FROM jobs
       WHERE type = $1 AND created_at >= $2
       ORDER BY created_at DESC LIMIT 50`,
      [type, afterTs]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dashboard job list
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT j.*,
             p.name         AS platform_name,
             p.display_name AS platform_display_name,
             pr.title       AS product_title
      FROM jobs j
      JOIN platforms p ON p.id = j.platform_id
      LEFT JOIN products pr ON pr.id = j.product_id
      ORDER BY j.created_at DESC
      LIMIT 100
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
