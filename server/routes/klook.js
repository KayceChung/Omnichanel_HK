const router = require('express').Router();
const { pool } = require('../db');

// Return distinct SKU IDs already stored in the DB
router.get('/skus', async (req, res) => {
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.json([]);

    const { rows } = await pool.query(
      `SELECT DISTINCT
         pl.platform_data->>'sku_id'       AS sku_id,
         pl.platform_data->>'activity_id'  AS activity_id,
         MAX(pl.last_synced_at)            AS last_synced_at,
         COUNT(*)::int                     AS slot_count
       FROM platform_listings pl
       WHERE pl.platform_id = $1
         AND pl.platform_data->>'sku_id' IS NOT NULL
       GROUP BY pl.platform_data->>'sku_id', pl.platform_data->>'activity_id'
       ORDER BY MAX(pl.last_synced_at) DESC`,
      [platform[0].id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Return Klook calendar slots stored in the DB, optionally filtered by sku_id
router.get('/calendar', async (req, res) => {
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const params = [platform[0].id];
    let where = 'WHERE pl.platform_id = $1';
    if (req.query.sku_id) {
      where += ` AND pl.platform_data->>'sku_id' = $2`;
      params.push(String(req.query.sku_id));
    }

    const { rows } = await pool.query(
      `SELECT p.id, p.title, p.status,
              pl.external_id, pl.platform_data, pl.last_synced_at
       FROM platform_listings pl
       JOIN products p ON p.id = pl.product_id
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
