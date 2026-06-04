const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const db = require('../db');

// GET /api/analytics/dashboard — main dashboard stats
router.get('/dashboard', authenticate, async (req, res) => {
  const rid = req.restaurant.id;
  try {
    const [scans, topItems, hourly, qrStats] = await Promise.all([
      // Total scans + last 7 days
      db.query(`
        SELECT
          COUNT(*) AS total_scans,
          COUNT(*) FILTER (WHERE scanned_at > NOW() - INTERVAL '7 days') AS scans_7d,
          COUNT(*) FILTER (WHERE scanned_at > NOW() - INTERVAL '24 hours') AS scans_24h
        FROM scan_events WHERE restaurant_id = $1
      `, [rid]),

      // Item click counts are tracked via separate events; here we show item availability
      db.query(`
        SELECT name, price, is_available,
               (SELECT COUNT(*) FROM ai_recommendations WHERE restaurant_id = $1) AS ai_recs_total
        FROM menu_items WHERE restaurant_id = $1 LIMIT 10
      `, [rid]),

      // Scans by hour of day (last 30 days)
      db.query(`
        SELECT EXTRACT(HOUR FROM scanned_at) AS hour, COUNT(*) AS count
        FROM scan_events
        WHERE restaurant_id = $1 AND scanned_at > NOW() - INTERVAL '30 days'
        GROUP BY hour ORDER BY hour
      `, [rid]),

      // Per QR stats
      db.query(`
        SELECT label, scan_count, created_at
        FROM qr_codes WHERE restaurant_id = $1
        ORDER BY scan_count DESC
      `, [rid]),
    ]);

    res.json({
      scans: scans.rows[0],
      top_items: topItems.rows,
      scans_by_hour: hourly.rows,
      qr_codes: qrStats.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load analytics', detail: err.message });
  }
});

// GET /api/analytics/scans/daily — scans per day (last 30 days)
router.get('/scans/daily', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT DATE(scanned_at) AS day, COUNT(*) AS scans
      FROM scan_events
      WHERE restaurant_id = $1 AND scanned_at > NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day ASC
    `, [req.restaurant.id]);
    res.json({ daily: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load daily scans' });
  }
});

module.exports = router;
