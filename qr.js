const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { authenticate } = require('../middleware/auth');
const db = require('../db');

const BASE_URL = process.env.FRONTEND_URL || 'https://scanme.app';

// POST /api/qr/generate — create a new QR code for a restaurant/table
router.post('/generate', authenticate, async (req, res) => {
  const { label } = req.body; // e.g. "Table 4", "Counter", "Takeaway"

  try {
    // Insert QR record first to get UUID
    const { rows: [qr] } = await db.query(`
      INSERT INTO qr_codes (restaurant_id, label)
      VALUES ($1, $2) RETURNING id
    `, [req.restaurant.id, label || 'Main']);

    // The URL the QR points to — includes qr_id for scan tracking
    const menuUrl = `${BASE_URL}/menu/${req.restaurant.slug}?qr=${qr.id}`;

    // Generate QR as base64 PNG and as SVG string
    const [pngDataUrl, svgString] = await Promise.all([
      QRCode.toDataURL(menuUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#1a1a1a', light: '#ffffff' },
        errorCorrectionLevel: 'H'
      }),
      QRCode.toString(menuUrl, { type: 'svg', margin: 2 })
    ]);

    // Store the data URL (in production, upload to Cloudinary instead)
    await db.query(
      'UPDATE qr_codes SET qr_image_url = $1 WHERE id = $2',
      [pngDataUrl, qr.id]
    );

    res.json({
      qr_code_id: qr.id,
      menu_url: menuUrl,
      label: label || 'Main',
      qr_png: pngDataUrl,    // base64 PNG — render as <img src={qr_png} />
      qr_svg: svgString,     // SVG markup — embed directly or save as .svg
    });
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed', detail: err.message });
  }
});

// GET /api/qr/list — all QR codes for a restaurant
router.get('/list', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, label, qr_image_url, scan_count, created_at
      FROM qr_codes WHERE restaurant_id = $1
      ORDER BY created_at DESC
    `, [req.restaurant.id]);
    res.json({ qr_codes: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list QR codes' });
  }
});

// DELETE /api/qr/:id — delete a QR code
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM qr_codes WHERE id=$1 AND restaurant_id=$2',
      [req.params.id, req.restaurant.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'QR code not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete QR code' });
  }
});

module.exports = router;
