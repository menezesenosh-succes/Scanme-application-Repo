const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const db = require('../db');

// ── PUBLIC ROUTES ────────────────────────────────────────────────────────────

// GET /api/menu/:slug  — full menu for a restaurant (QR scan landing)
router.get('/:slug', async (req, res) => {
  try {
    // Track scan if qr_code_id provided in query
    const { qr_code_id } = req.query;

    const { rows: [restaurant] } = await db.query(`
      SELECT id, name, slug, description, cuisine_type, address, city, phone,
             logo_url, cover_image_url, google_place_id
      FROM restaurants WHERE slug = $1 AND is_active = true
    `, [req.params.slug]);

    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    // Get categories with items
    const { rows: categories } = await db.query(`
      SELECT id, name, sort_order FROM categories
      WHERE restaurant_id = $1
      ORDER BY sort_order ASC, name ASC
    `, [restaurant.id]);

    const { rows: items } = await db.query(`
      SELECT id, category_id, name, description, price, image_url,
             is_vegetarian, is_vegan, is_gluten_free, spice_level,
             calories, allergens, tags, is_available
      FROM menu_items
      WHERE restaurant_id = $1
      ORDER BY sort_order ASC, name ASC
    `, [restaurant.id]);

    // Nest items under categories
    const menu = categories.map(cat => ({
      ...cat,
      items: items.filter(i => i.category_id === cat.id && i.is_available)
    }));

    // Log scan event (fire and forget)
    if (qr_code_id) {
      db.query(`
        INSERT INTO scan_events (qr_code_id, restaurant_id, user_agent, ip_address)
        VALUES ($1, $2, $3, $4)
      `, [qr_code_id, restaurant.id, req.headers['user-agent'], req.ip]).catch(() => {});

      db.query('UPDATE qr_codes SET scan_count = scan_count + 1 WHERE id = $1', [qr_code_id]).catch(() => {});
    }

    res.json({ restaurant, menu });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load menu', detail: err.message });
  }
});

// GET /api/menu/:slug/items — filterable item list
router.get('/:slug/items', async (req, res) => {
  const { veg, spice_max, price_max, price_min, category, search } = req.query;

  try {
    const { rows: [r] } = await db.query(
      'SELECT id FROM restaurants WHERE slug=$1 AND is_active=true', [req.params.slug]
    );
    if (!r) return res.status(404).json({ error: 'Restaurant not found' });

    let q = `
      SELECT mi.*, c.name AS category_name
      FROM menu_items mi
      LEFT JOIN categories c ON c.id = mi.category_id
      WHERE mi.restaurant_id = $1 AND mi.is_available = true
    `;
    const params = [r.id];

    if (veg === 'true') { params.push(true); q += ` AND mi.is_vegetarian = $${params.length}`; }
    if (spice_max)       { params.push(parseInt(spice_max)); q += ` AND mi.spice_level <= $${params.length}`; }
    if (price_min)       { params.push(parseFloat(price_min)); q += ` AND mi.price >= $${params.length}`; }
    if (price_max)       { params.push(parseFloat(price_max)); q += ` AND mi.price <= $${params.length}`; }
    if (category)        { params.push(category); q += ` AND c.name ILIKE $${params.length}`; }
    if (search)          { params.push(`%${search}%`); q += ` AND (mi.name ILIKE $${params.length} OR mi.description ILIKE $${params.length})`; }

    q += ' ORDER BY mi.sort_order ASC, mi.name ASC';

    const { rows } = await db.query(q, params);
    res.json({ items: rows, count: rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to filter items' });
  }
});

// ── ADMIN ROUTES (require JWT) ───────────────────────────────────────────────

// GET /api/menu/admin/items
router.get('/admin/items', authenticate, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT mi.*, c.name AS category_name
      FROM menu_items mi
      LEFT JOIN categories c ON c.id = mi.category_id
      WHERE mi.restaurant_id = $1
      ORDER BY c.sort_order, mi.sort_order, mi.name
    `, [req.restaurant.id]);
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load items' });
  }
});

// POST /api/menu/admin/items  — add item
router.post('/admin/items', authenticate, [
  body('name').notEmpty().trim(),
  body('price').isFloat({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    category_id, name, description, price, image_url,
    is_vegetarian, is_vegan, is_gluten_free, spice_level,
    calories, allergens, tags
  } = req.body;

  try {
    const { rows: [item] } = await db.query(`
      INSERT INTO menu_items
        (restaurant_id, category_id, name, description, price, image_url,
         is_vegetarian, is_vegan, is_gluten_free, spice_level, calories, allergens, tags)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      req.restaurant.id, category_id, name, description, price, image_url,
      is_vegetarian ?? false, is_vegan ?? false, is_gluten_free ?? false,
      spice_level ?? 0, calories, allergens ?? [], tags ?? []
    ]);
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create item', detail: err.message });
  }
});

// PATCH /api/menu/admin/items/:id
router.patch('/admin/items/:id', authenticate, async (req, res) => {
  const allowed = ['name','description','price','image_url','is_vegetarian','is_vegan',
                   'is_gluten_free','spice_level','calories','allergens','tags','is_available','sort_order'];
  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'No valid fields to update' });

  const sets = updates.map(([k], i) => `${k} = $${i + 3}`).join(', ');
  const vals = updates.map(([, v]) => v);

  try {
    const { rows: [item] } = await db.query(
      `UPDATE menu_items SET ${sets}, updated_at = NOW()
       WHERE id = $1 AND restaurant_id = $2 RETURNING *`,
      [req.params.id, req.restaurant.id, ...vals]
    );
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// DELETE /api/menu/admin/items/:id
router.delete('/admin/items/:id', authenticate, async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM menu_items WHERE id=$1 AND restaurant_id=$2',
      [req.params.id, req.restaurant.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Item not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// ── Categories admin ─────────────────────────────────────────────────────────

// GET /api/menu/admin/categories
router.get('/admin/categories', authenticate, async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM categories WHERE restaurant_id=$1 ORDER BY sort_order',
    [req.restaurant.id]
  );
  res.json({ categories: rows });
});

// POST /api/menu/admin/categories
router.post('/admin/categories', authenticate, [body('name').notEmpty()], async (req, res) => {
  const { name, sort_order } = req.body;
  try {
    const { rows: [cat] } = await db.query(
      'INSERT INTO categories (restaurant_id, name, sort_order) VALUES ($1,$2,$3) RETURNING *',
      [req.restaurant.id, name, sort_order ?? 0]
    );
    res.status(201).json({ category: cat });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create category' });
  }
});

module.exports = router;
