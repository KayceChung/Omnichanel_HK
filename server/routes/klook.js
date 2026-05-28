const router = require('express').Router();
const { pool } = require('../db');

// Enqueue a job for the extension to read Klook calendar
router.post('/sync-calendar', async (req, res) => {
  const { sku_id, activity_id, start_date, end_date } = req.body;
  if (!sku_id || !start_date || !end_date) {
    return res.status(400).json({ error: 'sku_id, start_date, end_date required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });

    const { rows: job } = await pool.query(
      `INSERT INTO jobs (type, platform_id, payload, status)
       VALUES ('klook_sync_calendar', $1, $2, 'pending') RETURNING *`,
      [platform[0].id, JSON.stringify({ sku_id, activity_id, start_date, end_date })]
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
  const { sku_id, activity_id, calendar } = req.body;
  if (!sku_id || !Array.isArray(calendar)) {
    return res.status(400).json({ error: 'sku_id and calendar array required' });
  }
  try {
    const { rows: platform } = await pool.query("SELECT id FROM platforms WHERE name='klook'");
    if (!platform.length) return res.status(404).json({ error: 'klook platform not found' });
    const platformId = platform[0].id;

    let upserted = 0;
    for (const slot of calendar) {
      const title       = `SKU ${sku_id} — ${slot.start_time}`;
      const externalId  = `${sku_id}::${slot.start_time}`;
      const meta        = JSON.stringify({
        sku_id,
        activity_id,
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
