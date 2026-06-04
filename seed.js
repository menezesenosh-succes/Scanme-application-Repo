require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./index');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱  Seeding database...');

    // Create demo restaurant (Kabab Souq)
    const hash = await bcrypt.hash('demo1234', 10);
    const { rows: [restaurant] } = await client.query(`
      INSERT INTO restaurants (name, slug, description, cuisine_type, address, city, phone, email, password_hash, google_place_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `, [
      'Kabab Souq',
      'kabab-souq',
      'Authentic Middle Eastern grills and kebabs in the heart of Bengaluru.',
      'Middle Eastern',
      'Whitefield, Bengaluru',
      'Bengaluru',
      '+91 98765 43210',
      'admin@kabab-souq.com',
      hash,
      'ChIJ...1ptxfbdzr'  // Replace with real Google Place ID
    ]);

    const rid = restaurant.id;

    // Categories
    const cats = ['Starters', 'Grills & Kebabs', 'Rice & Breads', 'Beverages', 'Desserts'];
    const catIds = {};
    for (const name of cats) {
      const { rows: [cat] } = await client.query(`
        INSERT INTO categories (restaurant_id, name, sort_order)
        VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id, name
      `, [rid, name, cats.indexOf(name)]);
      if (cat) catIds[name] = cat.id;
    }

    // Re-fetch cat IDs if they already existed
    const { rows: existingCats } = await client.query(
      'SELECT id, name FROM categories WHERE restaurant_id = $1', [rid]
    );
    existingCats.forEach(c => { catIds[c.name] = c.id; });

    // Menu items
    const items = [
      { cat: 'Starters',        name: 'Hummus & Pita',        price: 199, desc: 'Creamy chickpea dip with warm pita bread', veg: true,  spice: 0, cal: 280, tags: ['bestseller'] },
      { cat: 'Starters',        name: 'Falafel Platter',      price: 249, desc: 'Crispy fried chickpea patties with tahini', veg: true, vegan: true, spice: 1, cal: 320 },
      { cat: 'Starters',        name: 'Lamb Kibbeh',          price: 299, desc: 'Minced lamb with bulgur wheat and spices', veg: false, spice: 2, cal: 380 },
      { cat: 'Grills & Kebabs', name: 'Seekh Kebab',          price: 449, desc: 'Minced lamb skewers with aromatic spices', veg: false, spice: 3, tags: ['bestseller', 'spicy'] },
      { cat: 'Grills & Kebabs', name: 'Chicken Shish Tawook', price: 399, desc: 'Marinated chicken cubes grilled on skewer', veg: false, spice: 2, cal: 420 },
      { cat: 'Grills & Kebabs', name: 'Adana Kebab',          price: 499, desc: 'Spiced minced meat with red chilli flakes', veg: false, spice: 4, tags: ['spicy'] },
      { cat: 'Grills & Kebabs', name: 'Mixed Grill Platter',  price: 799, desc: 'Assorted kebabs for two with sauces', veg: false, spice: 3, tags: ['bestseller', 'for-two'] },
      { cat: 'Rice & Breads',   name: 'Lamb Mandi',           price: 549, desc: 'Slow-cooked lamb over fragrant Yemeni rice', veg: false, spice: 2, cal: 720 },
      { cat: 'Rice & Breads',   name: 'Vegetarian Biryani',   price: 349, desc: 'Aromatic basmati with vegetables and spices', veg: true, spice: 2, cal: 580 },
      { cat: 'Rice & Breads',   name: 'Cheese Naan',          price: 129, desc: 'Fluffy naan stuffed with melted cheese', veg: true, spice: 0, cal: 310 },
      { cat: 'Beverages',       name: 'Mint Lemonade',        price: 149, desc: 'Fresh-squeezed lemon with garden mint', veg: true, vegan: true, spice: 0, cal: 90 },
      { cat: 'Beverages',       name: 'Jallab',               price: 169, desc: 'Rose water, grape juice and pine nuts', veg: true, spice: 0, cal: 140, tags: ['new'] },
      { cat: 'Desserts',        name: 'Baklava',              price: 199, desc: 'Flaky pastry with honey, nuts and rose water', veg: true, spice: 0, cal: 350, allergens: ['nuts', 'gluten'] },
      { cat: 'Desserts',        name: 'Umm Ali',              price: 249, desc: 'Egyptian bread pudding with cream and nuts', veg: true, spice: 0, allergens: ['nuts', 'dairy'] },
    ];

    for (const item of items) {
      await client.query(`
        INSERT INTO menu_items (restaurant_id, category_id, name, description, price,
          is_vegetarian, is_vegan, spice_level, calories, allergens, tags)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT DO NOTHING
      `, [
        rid, catIds[item.cat], item.name, item.desc, item.price,
        item.veg ?? false, item.vegan ?? false, item.spice, item.cal ?? null,
        item.allergens ?? [], item.tags ?? []
      ]);
    }

    console.log('✅  Seed complete. Restaurant: Kabab Souq | Login: admin@kabab-souq.com / demo1234');
  } catch (err) {
    console.error('❌  Seed failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
