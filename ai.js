const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('../db');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// POST /api/ai/recommend
// Body: { restaurant_slug, preferences: { dietary, spice_tolerance, budget_max, mood, party_size } }
router.post('/recommend', async (req, res) => {
  const { restaurant_slug, preferences } = req.body;

  if (!restaurant_slug || !preferences) {
    return res.status(400).json({ error: 'restaurant_slug and preferences are required' });
  }

  try {
    // 1. Fetch restaurant + available menu
    const { rows: [restaurant] } = await db.query(
      'SELECT id, name, cuisine_type FROM restaurants WHERE slug=$1 AND is_active=true',
      [restaurant_slug]
    );
    if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

    const { rows: items } = await db.query(`
      SELECT mi.name, mi.description, mi.price, mi.is_vegetarian, mi.is_vegan,
             mi.spice_level, mi.calories, mi.allergens, mi.tags, c.name AS category
      FROM menu_items mi
      LEFT JOIN categories c ON c.id = mi.category_id
      WHERE mi.restaurant_id = $1 AND mi.is_available = true
      ORDER BY mi.sort_order
    `, [restaurant.id]);

    // 2. Build Gemini prompt
    const menuSummary = items.map(i =>
      `- ${i.name} (${i.category}) | ₹${i.price} | ` +
      `${i.is_vegetarian ? 'Veg' : 'Non-veg'} | ` +
      `Spice: ${i.spice_level}/5 | ` +
      `${i.description || ''}`
    ).join('\n');

    const prefs = preferences;
    const prompt = `
You are a friendly dining assistant at ${restaurant.name}, a ${restaurant.cuisine_type} restaurant.

The customer's preferences:
- Dietary: ${prefs.dietary || 'no restriction'}
- Spice tolerance: ${prefs.spice_tolerance || 'medium'} (scale: none/low/medium/high/extreme)
- Budget per person: ₹${prefs.budget_max || 'flexible'}
- Occasion/mood: ${prefs.mood || 'casual dining'}
- Party size: ${prefs.party_size || 1}

Here is the full menu:
${menuSummary}

Your task:
1. Recommend exactly 3 dishes that best match the customer's preferences.
2. For each dish, give a short (1–2 sentence) friendly explanation of WHY it suits them.
3. Also suggest 1 drink pairing if beverages are available.
4. Keep the tone warm and conversational.

Respond ONLY in this JSON format (no markdown, no extra text):
{
  "recommendations": [
    {
      "dish_name": "exact name from menu",
      "reason": "why this suits the customer",
      "highlight": "one word or short phrase: e.g. Chef's pick, Great value, Mildest option"
    }
  ],
  "drink_pairing": {
    "dish_name": "exact name from menu or null",
    "reason": "short reason"
  },
  "summary": "One sentence warm intro to the recommendations"
}
`;

    // 3. Call Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    // 4. Parse JSON response
    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: 'AI response could not be parsed', raw });
    }

    // 5. Enrich with full item details from DB
    const enrichedRecs = await Promise.all(
      parsed.recommendations.map(async rec => {
        const { rows: [item] } = await db.query(`
          SELECT id, name, price, image_url, spice_level, is_vegetarian, description
          FROM menu_items WHERE restaurant_id=$1 AND name ILIKE $2 LIMIT 1
        `, [restaurant.id, rec.dish_name]);
        return { ...rec, item: item || null };
      })
    );

    // 6. Log recommendation (async)
    db.query(`
      INSERT INTO ai_recommendations (restaurant_id, user_prefs, recommendations)
      VALUES ($1, $2, $3)
    `, [restaurant.id, JSON.stringify(preferences), JSON.stringify(parsed)]).catch(() => {});

    res.json({
      summary: parsed.summary,
      recommendations: enrichedRecs,
      drink_pairing: parsed.drink_pairing,
    });
  } catch (err) {
    console.error('Gemini error:', err.message);
    res.status(500).json({ error: 'AI recommendation failed', detail: err.message });
  }
});

module.exports = router;
