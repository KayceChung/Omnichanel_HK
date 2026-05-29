const router = require('express').Router();
const { pool } = require('../db');

// ── Debug endpoint (stores raw packages API response for field-name analysis) ─

let _packagesDebug = null; // in-memory, cleared on restart

router.post('/debug-packages', (req, res) => {
  _packagesDebug = { received_at: new Date().toISOString(), body: req.body };
  res.json({ ok: true });
});

router.get('/debug-packages', (req, res) => {
  res.json(_packagesDebug || null);
});

// ── Activity ID management ────────────────────────────────────────────────────

router.get('/activities', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM klook_activities ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/activities', async (req, res) => {
  const { activity_id, name } = req.body;
  if (!activity_id) return res.status(400).json({ error: 'activity_id required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO klook_activities (activity_id, name)
       VALUES ($1, $2)
       ON CONFLICT (activity_id) DO UPDATE SET name = COALESCE($2, klook_activities.name)
       RETURNING *`,
      [String(activity_id).trim(), name || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk upsert activities detected by the extension
router.post('/activities/bulk', async (req, res) => {
  const { activities } = req.body;
  if (!Array.isArray(activities) || activities.length === 0) {
    return res.status(400).json({ error: 'activities array required' });
  }
  try {
    let upserted = 0;
    for (const { activity_id, name } of activities) {
      if (!activity_id) continue;
      await pool.query(
        `INSERT INTO klook_activities (activity_id, name)
         VALUES ($1, $2)
         ON CONFLICT (activity_id) DO UPDATE
           SET name = COALESCE($2, klook_activities.name)`,
        [String(activity_id).trim(), name || null]
      );
      upserted++;
    }
    res.json({ upserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/activities/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM klook_activities WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enqueue one klook_sync_activity job per stored activity
router.post('/sync-all', async (req, res) => {
  const { start_date, end_date } = req.body;
  if (!start_date || !end_date) return res.status(400).json({ error: 'start_date and end_date required' });
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const { rows: activities } = await pool.query('SELECT * FROM klook_activities');
    if (!activities.length) return res.status(400).json({ error: 'No activities stored. Add activity IDs first.' });

    const jobs = [];
    for (const act of activities) {
      const { rows: job } = await pool.query(
        `INSERT INTO jobs (type, platform_id, payload, status)
         VALUES ('klook_sync_activity', $1, $2, 'pending') RETURNING *`,
        [platform[0].id, JSON.stringify({ activity_id: act.activity_id, activity_name: act.name, start_date, end_date })]
      );
      jobs.push(job[0]);
    }
    res.status(201).json({ queued: jobs.length, jobs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Return distinct SKU IDs already stored in the DB ─────────────────────────

// Return distinct SKU IDs already stored in the DB
router.get('/skus', async (req, res) => {
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.json([]);

    const { rows } = await pool.query(
      `SELECT
         pl.platform_data->>'sku_id'                                          AS sku_id,
         MAX(pl.platform_data->>'activity_id')                                AS activity_id,
         MAX(pl.platform_data->>'product_name')                               AS product_name,
         MAX(pl.last_synced_at)                                               AS last_synced_at,
         COUNT(*)::int                                                         AS slot_count
       FROM platform_listings pl
       WHERE pl.platform_id = $1
         AND pl.platform_data->>'sku_id' IS NOT NULL
       GROUP BY pl.platform_data->>'sku_id'
       ORDER BY MAX(pl.last_synced_at) DESC`,
      [platform[0].id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Return Klook calendar slots stored in the DB, optionally filtered by sku_id / date range
router.get('/calendar', async (req, res) => {
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const params = [platform[0].id];
    let where = 'WHERE pl.platform_id = $1';
    if (req.query.sku_id) {
      where += ` AND pl.platform_data->>'sku_id' = $${params.length + 1}`;
      params.push(String(req.query.sku_id));
    }
    if (req.query.date_from) {
      where += ` AND pl.platform_data->>'start_time' >= $${params.length + 1}`;
      params.push(req.query.date_from + ' 00:00:00');
    }
    if (req.query.date_to) {
      where += ` AND pl.platform_data->>'start_time' <= $${params.length + 1}`;
      params.push(req.query.date_to + ' 23:59:59');
    }

    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.status,
              pl.external_id, pl.platform_data, pl.last_synced_at,
              ka.name AS activity_name
       FROM platform_listings pl
       JOIN products p ON p.id = pl.product_id
       LEFT JOIN klook_activities ka
         ON ka.activity_id = pl.platform_data->>'activity_id'
       ${where}
       ORDER BY pl.platform_data->>'start_time' ASC NULLS LAST`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-set product_name for all slots of a given sku_id (no re-sync needed)
router.post('/set-product-name', async (req, res) => {
  const { sku_id, product_name } = req.body;
  if (!sku_id || !product_name) {
    return res.status(400).json({ error: 'sku_id and product_name required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    // Update platform_data.product_name for every listing of this SKU
    const { rowCount } = await pool.query(
      `UPDATE platform_listings
       SET platform_data = platform_data || jsonb_build_object('product_name', $1::text),
           updated_at = NOW()
       WHERE platform_id = $2
         AND platform_data->>'sku_id' = $3`,
      [product_name, platform[0].id, String(sku_id)]
    );

    // Also update the product title for those rows
    await pool.query(
      `UPDATE products p
       SET title = $1, updated_at = NOW()
       FROM platform_listings pl
       WHERE pl.product_id = p.id
         AND pl.platform_id = $2
         AND pl.platform_data->>'sku_id' = $3`,
      [product_name, platform[0].id, String(sku_id)]
    );

    res.json({ updated: rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enqueue a job for the extension to read Klook calendar
router.post('/sync-calendar', async (req, res) => {
  const { sku_id, activity_id, start_date, end_date, product_name } = req.body;
  if (!sku_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'sku_id, start_date, end_date required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const { rows: job } = await pool.query(
      `INSERT INTO jobs (type, platform_id, payload, status)
       VALUES ('klook_sync_calendar', $1, $2, 'pending') RETURNING *`,
      [platform[0].id, JSON.stringify({ sku_id, activity_id, start_date, end_date, product_name })]
    );
    res.status(201).json(job[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enqueue a job to activate/deactivate a timeslot
router.post('/update-schedule', async (req, res) => {
  const { sku_id, start_time, published, inv_quantity, price, cut_off_time } = req.body;
  if (!sku_id || !start_time || published === undefined) {
    return res.status(400).json({ error: 'sku_id, start_time, published required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const { rows: job } = await pool.query(
      `INSERT INTO jobs (type, platform_id, payload, status)
       VALUES ('klook_update_schedule', $1, $2, 'pending') RETURNING *`,
      [platform[0].id, JSON.stringify({ sku_id, start_time, published, inv_quantity, price, cut_off_time })]
    );
    res.status(201).json(job[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Store imported Klook calendar data
router.post('/import-calendar', async (req, res) => {
  const { sku_id, activity_id, calendar, product_name } = req.body;
  if (!sku_id || !Array.isArray(calendar)) {
    return res.status(400).json({ error: 'sku_id and calendar array required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });
    const platformId = platform[0].id;

    // Use provided product name, or keep existing, or fall back to SKU number
    const skuLabel = product_name || `SKU ${sku_id}`;

    let upserted = 0;
    for (const slot of calendar) {
      const title       = skuLabel;
      const externalId  = `${sku_id}::${slot.start_time}`;
      const meta        = JSON.stringify({
        sku_id,
        activity_id,
        product_name:   product_name || null,
        start_time:     slot.start_time,
        published:      slot.published,
        inv_quantity:   slot.inv_quantity,
        sales:          slot.sales,
        publish_status: slot.publish_status,
        price:          slot.price,
        cut_off_time:   slot.cut_off_time,
      });

      const existing = await pool.query(
        `SELECT p.id FROM products p
         JOIN platform_listings pl ON pl.product_id = p.id
         WHERE pl.platform_id=$1 AND pl.external_id=$2`,
        [platformId, externalId]
      );

      let productId;
      if (existing.rows.length) {
        productId = existing.rows[0].id;
        await pool.query(
          `UPDATE products SET title=$1, updated_at=NOW() WHERE id=$2`,
          [title, productId]
        );
      } else {
        const { rows: prod } = await pool.query(
          `INSERT INTO products (title, currency, status)
           VALUES ($1, 'VND', $2) RETURNING id`,
          [title, slot.published ? 'active' : 'inactive']
        );
        productId = prod[0].id;
      }

      await pool.query(
        `INSERT INTO platform_listings (product_id, platform_id, external_id, status, platform_data, last_synced_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (product_id, platform_id)
         DO UPDATE SET external_id=$3, status=$4, platform_data=$5, last_synced_at=NOW(), updated_at=NOW()`,
        [productId, platformId, externalId, slot.published ? 'live' : 'inactive', meta]
      );
      upserted++;
    }
    res.json({ upserted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
