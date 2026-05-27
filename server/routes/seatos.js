const router = require('express').Router();
const { pool } = require('../db');

// Enqueue a job for the extension to fetch trips from SeatOS and import them.
// The extension executes the actual SeatOS API call (it holds the JWT).
router.post('/sync', async (req, res) => {
  const { start_date, end_date } = req.body;
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
  }

  try {
    const { rows: platform } = await pool.query(
      "SELECT id FROM platforms WHERE name = 'seatos'"
    );
    if (!platform.length) return res.status(404).json({ error: 'seatos platform not found' });

    const { rows: job } = await pool.query(
      `INSERT INTO jobs (type, platform_id, payload, status)
       VALUES ('sync_trips', $1, $2, 'pending') RETURNING *`,
      [platform[0].id, JSON.stringify({ start_date, end_date })]
    );

    res.status(201).json(job[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Called by the extension after it fetches trips from SeatOS.
// Upserts each trip as a product + platform_listing.
router.post('/import', async (req, res) => {
  const { trips } = req.body;
  if (!Array.isArray(trips)) return res.status(400).json({ error: 'trips must be an array' });

  const { rows: platform } = await pool.query(
    "SELECT id FROM platforms WHERE name = 'seatos'"
  );
  if (!platform.length) return res.status(404).json({ error: 'seatos platform not found' });
  const platformId = platform[0].id;

  const results = { created: 0, updated: 0, errors: [] };

  for (const trip of trips) {
    try {
      const title       = trip.route_name;
      const description = trip.class_name;
      const externalId  = String(trip.id);
      const meta        = JSON.stringify({
        departure:      trip.departureDatetime,
        class_id:       trip.class_id,
        class_code:     trip.class_code,
        route_id:       trip.route_id,
        original_seats: trip.original_seats,
        total_quota:    trip.occupancy?.totalQuota,
        booked:         trip.occupancy?.existedQuota,
        stops:          trip.stops,
      });

      // Upsert product (match on seatos external_id via listing)
      const existing = await pool.query(
        `SELECT p.id FROM products p
         JOIN platform_listings pl ON pl.product_id = p.id
         WHERE pl.platform_id = $1 AND pl.external_id = $2`,
        [platformId, externalId]
      );

      let productId;
      if (existing.rows.length) {
        productId = existing.rows[0].id;
        await pool.query(
          `UPDATE products SET title=$1, description=$2, updated_at=NOW() WHERE id=$3`,
          [title, description, productId]
        );
        results.updated++;
      } else {
        const { rows: prod } = await pool.query(
          `INSERT INTO products (title, description, currency, status)
           VALUES ($1, $2, 'VND', 'active') RETURNING id`,
          [title, description]
        );
        productId = prod[0].id;
        results.created++;
      }

      // Upsert listing
      await pool.query(
        `INSERT INTO platform_listings (product_id, platform_id, external_id, status, platform_data, last_synced_at)
         VALUES ($1, $2, $3, 'live', $4, NOW())
         ON CONFLICT (product_id, platform_id)
         DO UPDATE SET external_id=$3, status='live', platform_data=$4, last_synced_at=NOW(), updated_at=NOW()`,
        [productId, platformId, externalId, meta]
      );
    } catch (err) {
      results.errors.push({ trip_id: trip.id, error: err.message });
    }
  }

  res.json(results);
});

module.exports = router;
