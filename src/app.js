const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || '1.0.0';

app.use(express.json());

// ─── Utils ───────────────────────────────────────────────────────────────────

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (base, spread = 80) => base + Math.floor(Math.random() * spread);

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fakePaginate(data, page = 1, limit = 10) {
  const p = Math.max(1, parseInt(page));
  const l = Math.min(100, Math.max(1, parseInt(limit)));
  const start = (p - 1) * l;
  const items = data.slice(start, start + l);
  return {
    data: items,
    meta: {
      page: p,
      limit: l,
      total: data.length,
      pages: Math.ceil(data.length / l),
    },
  };
}

// ─── Fake Data ────────────────────────────────────────────────────────────────

const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis'];
const ROLES       = ['admin', 'user', 'moderator', 'viewer'];
const STATUSES    = ['active', 'inactive', 'pending'];
const CATEGORIES  = ['electronics', 'clothing', 'food', 'books', 'sports', 'home'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];

const users = Array.from({ length: 50 }, (_, i) => ({
  id: `usr_${String(i + 1).padStart(4, '0')}`,
  name: `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`,
  email: `user${i + 1}@example.com`,
  role: randomItem(ROLES),
  status: randomItem(STATUSES),
  createdAt: new Date(Date.now() - Math.random() * 1e10).toISOString(),
}));

const products = Array.from({ length: 80 }, (_, i) => ({
  id: `prod_${String(i + 1).padStart(4, '0')}`,
  name: `Product ${i + 1}`,
  category: randomItem(CATEGORIES),
  price: parseFloat((Math.random() * 500 + 5).toFixed(2)),
  stock: Math.floor(Math.random() * 200),
  sku: `SKU-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
  available: Math.random() > 0.15,
}));

const orders = Array.from({ length: 120 }, (_, i) => ({
  id: `ord_${String(i + 1).padStart(5, '0')}`,
  userId: randomItem(users).id,
  items: Array.from({ length: Math.floor(Math.random() * 4) + 1 }, () => ({
    productId: randomItem(products).id,
    qty: Math.floor(Math.random() * 5) + 1,
    unitPrice: parseFloat((Math.random() * 200 + 5).toFixed(2)),
  })),
  status: randomItem(ORDER_STATUSES),
  total: parseFloat((Math.random() * 1000 + 10).toFixed(2)),
  createdAt: new Date(Date.now() - Math.random() * 5e9).toISOString(),
}));

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use((req, _res, next) => {
  req._startAt = Date.now();
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Info
app.get('/', (_req, res) => {
  res.json({
    service: 'fake-api',
    version: APP_VERSION,
    status: 'running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET  /health',
      'GET  /metrics',
      'GET  /users',
      'GET  /users/:id',
      'POST /users',
      'PUT  /users/:id',
      'DELETE /users/:id',
      'GET  /products',
      'GET  /products/:id',
      'GET  /orders',
      'GET  /orders/:id',
      'POST /orders',
      'POST /process',
      'GET  /slow',
      'GET  /flaky',
    ],
  });
});

// Health
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Metrics (fake Prometheus-style as JSON)
app.get('/metrics', async (req, res) => {
  await delay(jitter(50, 30));
  res.json({
    http_requests_total: Math.floor(Math.random() * 100000),
    http_request_duration_p50_ms: jitter(80, 40),
    http_request_duration_p99_ms: jitter(400, 200),
    active_connections: Math.floor(Math.random() * 150),
    db_pool_used: Math.floor(Math.random() * 20),
    db_pool_idle: Math.floor(Math.random() * 30),
    cache_hit_rate: parseFloat((Math.random()).toFixed(4)),
    memory_heap_used_bytes: process.memoryUsage().heapUsed,
    memory_heap_total_bytes: process.memoryUsage().heapTotal,
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ── Users ──────────────────────────────────────────────────────────────────

app.get('/users', async (req, res) => {
  await delay(jitter(180, 80));
  const { page = 1, limit = 10, status, role } = req.query;

  let filtered = users;
  if (status) filtered = filtered.filter((u) => u.status === status);
  if (role)   filtered = filtered.filter((u) => u.role === role);

  res.json(fakePaginate(filtered, page, limit));
});

app.get('/users/:id', async (req, res) => {
  await delay(jitter(100, 60));
  const user = users.find((u) => u.id === req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found', id: req.params.id });
  res.json(user);
});

app.post('/users', async (req, res) => {
  await delay(jitter(320, 120));
  const { name, email, role = 'user' } = req.body;
  if (!name || !email) {
    return res.status(422).json({ error: 'name and email are required' });
  }
  const newUser = {
    id: `usr_${uuidv4().split('-')[0]}`,
    name,
    email,
    role,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  users.push(newUser);
  res.status(201).json(newUser);
});

app.put('/users/:id', async (req, res) => {
  await delay(jitter(250, 80));
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users[idx] = { ...users[idx], ...req.body, id: users[idx].id };
  res.json(users[idx]);
});

app.delete('/users/:id', async (req, res) => {
  await delay(jitter(150, 60));
  const idx = users.findIndex((u) => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'User not found' });
  users.splice(idx, 1);
  res.status(204).send();
});

// ── Products ───────────────────────────────────────────────────────────────

app.get('/products', async (req, res) => {
  await delay(jitter(160, 70));
  const { page = 1, limit = 10, category, available } = req.query;

  let filtered = products;
  if (category)  filtered = filtered.filter((p) => p.category === category);
  if (available !== undefined)
    filtered = filtered.filter((p) => p.available === (available === 'true'));

  res.json(fakePaginate(filtered, page, limit));
});

app.get('/products/:id', async (req, res) => {
  await delay(jitter(110, 50));
  const product = products.find((p) => p.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found', id: req.params.id });
  res.json(product);
});

// ── Orders ─────────────────────────────────────────────────────────────────

app.get('/orders', async (req, res) => {
  // Simulates a heavier DB join
  await delay(jitter(480, 150));
  const { page = 1, limit = 10, status, userId } = req.query;

  let filtered = orders;
  if (status) filtered = filtered.filter((o) => o.status === status);
  if (userId) filtered = filtered.filter((o) => o.userId === userId);

  res.json(fakePaginate(filtered, page, limit));
});

app.get('/orders/:id', async (req, res) => {
  await delay(jitter(200, 80));
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found', id: req.params.id });
  res.json(order);
});

app.post('/orders', async (req, res) => {
  // Simulates payment processing + inventory check
  await delay(jitter(850, 300));
  const { userId, items } = req.body;
  if (!userId || !items?.length) {
    return res.status(422).json({ error: 'userId and items[] are required' });
  }
  const newOrder = {
    id: `ord_${uuidv4().split('-')[0]}`,
    userId,
    items,
    status: 'pending',
    total: items.reduce((s, i) => s + (i.unitPrice || 0) * (i.qty || 1), 0).toFixed(2),
    createdAt: new Date().toISOString(),
  };
  orders.push(newOrder);
  res.status(201).json(newOrder);
});

// ── Heavy process ──────────────────────────────────────────────────────────

app.post('/process', async (req, res) => {
  const ms = jitter(1200, 1800); // 1.2s – 3s
  const jobId = uuidv4();
  await delay(ms);

  res.json({
    jobId,
    status: 'completed',
    input: req.body,
    result: {
      processed: true,
      records: Math.floor(Math.random() * 50000) + 1000,
      durationMs: ms,
      checksum: Math.random().toString(36).substring(2),
    },
    completedAt: new Date().toISOString(),
  });
});

// ── Slow endpoint ──────────────────────────────────────────────────────────

app.get('/slow', async (_req, res) => {
  await delay(2000);
  res.json({ message: 'finally!', durationMs: 2000 });
});

// ── Flaky endpoint (random 30% error rate) ─────────────────────────────────

app.get('/flaky', async (_req, res) => {
  await delay(jitter(100, 100));
  if (Math.random() < 0.3) {
    return res.status(503).json({
      error: 'Service temporarily unavailable',
      retryAfter: 1,
    });
  }
  res.json({ message: 'lucky you!', timestamp: new Date().toISOString() });
});

// ─── 404 & Error handlers ─────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`fake-api v${APP_VERSION} running on port ${PORT}`);
});
