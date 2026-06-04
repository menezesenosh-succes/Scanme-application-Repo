const express = require('express');
const router = express.Router();
const db = require('../db');

const PLACES_API_BASE = 'https://places.googleapis.com/v1/places';
const CACHE_TTL_HOURS = 6; // Refresh reviews every 6 hours

async function fetchFromGoogle(placeId) {
  const url = `${PLACES_API_BASE}/${placeId}`;
  const response = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,rating,userRatingCount,reviews,regularOpeningHours,photos',
    }
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Places API error ${response.status}: ${err}`);
  }
  return response.json();
}

// GET /api/reviews/:slug — get Google reviews for a restaurant
router.get('/:slug', async (req, res) => {
  try {
    const { rows: [restaurant] } = await db.query(
      'SELECT id, google_place_id FROM restaurants WHERE slug=$1 AND is_active=true',
      [req.params.slug]
    );

    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });
    if (!restaurant.google_place_id) {
      return res.status(404).json({ error: 'No Google Place ID configured for this restaurant' });
    }

    // Check cache
    const { rows: [cached] } = await db.query(`
      SELECT overall_rating, total_reviews, reviews_json, cached_at
      FROM google_reviews_cache
      WHERE restaurant_id = $1
        AND cached_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'
    `, [restaurant.id]);

    if (cached) {
      return res.json({
        source: 'cache',
        cached_at: cached.cached_at,
        overall_rating: cached.overall_rating,
        total_reviews: cached.total_reviews,
        reviews: cached.reviews_json,
      });
    }

    // Fetch fresh from Google
    const data = await fetchFromGoogle(restaurant.google_place_id);

    const reviews = (data.reviews || []).map(r => ({
      author: r.authorAttribution?.displayName || 'Anonymous',
      rating: r.rating,
      text: r.text?.text || '',
      relative_time: r.relativePublishTimeDescription,
      profile_photo: r.authorAttribution?.photoUri || null,
    }));

    // Upsert cache
    await db.query(`
      INSERT INTO google_reviews_cache
        (restaurant_id, place_id, overall_rating, total_reviews, reviews_json)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (restaurant_id) DO UPDATE SET
        overall_rating = EXCLUDED.overall_rating,
        total_reviews  = EXCLUDED.total_reviews,
        reviews_json   = EXCLUDED.reviews_json,
        cached_at      = NOW()
    `, [
      restaurant.id,
      restaurant.google_place_id,
      data.rating || null,
      data.userRatingCount || 0,
      JSON.stringify(reviews)
    ]);

    res.json({
      source: 'google',
      overall_rating: data.rating,
      total_reviews: data.userRatingCount,
      opening_hours: data.regularOpeningHours?.weekdayDescriptions || [],
      reviews,
    });
  } catch (err) {
    console.error('Reviews fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch reviews', detail: err.message });
  }
});

// POST /api/reviews/refresh/:slug — force-refresh cache (admin use)
router.post('/refresh/:slug', async (req, res) => {
  try {
    const { rows: [restaurant] } = await db.query(
      'SELECT id, google_place_id FROM restaurants WHERE slug=$1',
      [req.params.slug]
    );
    if (!restaurant?.google_place_id) return res.status(404).json({ error: 'Not found' });

    await db.query('DELETE FROM google_reviews_cache WHERE restaurant_id=$1', [restaurant.id]);
    res.json({ message: 'Cache cleared. Next request will fetch fresh data.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh' });
  }
});

module.exports = router;
