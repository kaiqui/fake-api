/**
 * k6 load test — fake-api
 *
 * Uso:
 *   k6 run scripts/load-test.js
 *   k6 run --env BASE_URL=http://my-host:3000 scripts/load-test.js
 *   k6 run --env SCENARIO=smoke scripts/load-test.js
 *   k6 run --env SCENARIO=stress scripts/load-test.js
 *   k6 run --env SCENARIO=soak scripts/load-test.js
 */

import http from 'k6/http';
import { check, group, sleep, fail } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SCENARIO  = __ENV.SCENARIO  || 'load';

// ─── Custom metrics ───────────────────────────────────────────────────────────

const errorRate          = new Rate('custom_error_rate');
const orderCreateTrend   = new Trend('custom_order_create_ms', true);
const processTrend       = new Trend('custom_process_ms', true);
const flakyFailRate      = new Rate('custom_flaky_fail_rate');
const totalRequests      = new Counter('custom_total_requests');

// ─── Scenarios ────────────────────────────────────────────────────────────────

const SCENARIOS = {
  // Sanidade: 1 VU, 30s, verifica se a API está viva
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },

  // Carga normal: ramp-up → sustentado → spike → ramp-down
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m',  target: 20  },  // ramp-up
      { duration: '3m',  target: 20  },  // sustentado
      { duration: '30s', target: 50  },  // spike
      { duration: '1m',  target: 50  },  // sustentado no pico
      { duration: '30s', target: 20  },  // volta ao normal
      { duration: '2m',  target: 20  },  // sustentado de novo
      { duration: '30s', target: 0   },  // ramp-down
    ],
  },

  // Stress: empurra até quebrar
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '1m',  target: 20  },
      { duration: '1m',  target: 40  },
      { duration: '1m',  target: 60  },
      { duration: '1m',  target: 80  },
      { duration: '1m',  target: 100 },
      { duration: '2m',  target: 100 },  // segura na carga máxima
      { duration: '1m',  target: 0   },  // drena
    ],
  },

  // Soak: carga moderada por bastante tempo (detecta memory leaks etc)
  soak: {
    executor: 'constant-vus',
    vus: 15,
    duration: '20m',
  },
};

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const options = {
  scenarios: { [SCENARIO]: SCENARIOS[SCENARIO] },

  thresholds: {
    // Latência geral
    http_req_duration: [
      'p(50)<500',    // mediana abaixo de 500ms
      'p(90)<1500',   // 90% abaixo de 1.5s
      'p(95)<3000',   // 95% abaixo de 3s
      'p(99)<5000',   // 99% abaixo de 5s
    ],

    // Taxa de erro HTTP (exclui flaky que tem erro esperado)
    http_req_failed: ['rate<0.15'],

    // Métricas customizadas
    custom_error_rate:       ['rate<0.10'],
    custom_order_create_ms:  ['p(95)<2000'],
    custom_process_ms:       ['p(95)<4000'],
    custom_flaky_fail_rate:  ['rate<0.50'],  // endpoint é propositalmente instável

    // Throughput mínimo esperado
    http_reqs: ['rate>5'],
  },

  // Relatório no final
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUserId() {
  return `usr_${pad(randInt(1, 50), 4)}`;
}

function randomProductId() {
  return `prod_${pad(randInt(1, 80), 4)}`;
}

function randomOrderId() {
  return `ord_${pad(randInt(1, 120), 5)}`;
}

const defaultHeaders = { 'Content-Type': 'application/json' };

function get(path, params, tags) {
  totalRequests.add(1);
  const url = params
    ? `${BASE_URL}${path}?${new URLSearchParams(params).toString()}`
    : `${BASE_URL}${path}`;
  return http.get(url, { tags });
}

function post(path, body, tags) {
  totalRequests.add(1);
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: defaultHeaders,
    tags,
  });
}

function put(path, body, tags) {
  totalRequests.add(1);
  return http.put(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: defaultHeaders,
    tags,
  });
}

function del(path, tags) {
  totalRequests.add(1);
  return http.del(`${BASE_URL}${path}`, null, { tags });
}

function recordError(res) {
  errorRate.add(res.status >= 400 && res.status !== 404 && res.status !== 503);
}

// ─── Flows ────────────────────────────────────────────────────────────────────

/**
 * Simula um usuário navegando: lista recursos, detalha um item.
 */
function browseFlow() {
  group('browse › users', () => {
    const listRes = get('/users', { page: randInt(1, 5), limit: 10 }, { flow: 'browse' });
    check(listRes, {
      'users list: status 200':      (r) => r.status === 200,
      'users list: tem data[]':      (r) => JSON.parse(r.body).data !== undefined,
      'users list: tem meta.total':  (r) => JSON.parse(r.body).meta?.total > 0,
    });
    recordError(listRes);

    sleep(randInt(1, 2));

    const detailRes = get(`/users/${randomUserId()}`, null, { flow: 'browse' });
    check(detailRes, {
      'user detail: status 200 ou 404': (r) => [200, 404].includes(r.status),
    });
  });

  sleep(randInt(1, 3));

  group('browse › products', () => {
    const listRes = get('/products', { page: randInt(1, 8), limit: 10 }, { flow: 'browse' });
    check(listRes, {
      'products list: status 200': (r) => r.status === 200,
      'products list: tem data[]': (r) => JSON.parse(r.body).data !== undefined,
    });
    recordError(listRes);

    sleep(randInt(1, 2));

    const detailRes = get(`/products/${randomProductId()}`, null, { flow: 'browse' });
    check(detailRes, {
      'product detail: status 200 ou 404': (r) => [200, 404].includes(r.status),
    });
    recordError(detailRes);
  });
}

/**
 * Simula um ciclo de pedido: lista ordens, cria uma nova, consulta pelo id.
 */
function orderFlow() {
  group('order › list', () => {
    const res = get('/orders', { page: 1, limit: 5 }, { flow: 'order' });
    check(res, {
      'orders list: status 200': (r) => r.status === 200,
    });
    recordError(res);
  });

  sleep(randInt(1, 2));

  group('order › create', () => {
    const payload = {
      userId: randomUserId(),
      items: Array.from({ length: randInt(1, 3) }, () => ({
        productId: randomProductId(),
        qty: randInt(1, 5),
        unitPrice: parseFloat((Math.random() * 150 + 10).toFixed(2)),
      })),
    };

    const start = Date.now();
    const res = post('/orders', payload, { flow: 'order' });
    orderCreateTrend.add(Date.now() - start);

    check(res, {
      'create order: status 201':  (r) => r.status === 201,
      'create order: tem id':      (r) => JSON.parse(r.body).id !== undefined,
      'create order: status=pending': (r) => JSON.parse(r.body).status === 'pending',
    });
    recordError(res);
  });

  sleep(randInt(1, 2));

  group('order › detail', () => {
    const res = get(`/orders/${randomOrderId()}`, null, { flow: 'order' });
    check(res, {
      'order detail: status 200 ou 404': (r) => [200, 404].includes(r.status),
    });
  });
}

/**
 * Simula CRUD de usuário: cria → atualiza → deleta.
 */
function userCrudFlow() {
  let createdId;

  group('user-crud › create', () => {
    const res = post('/users', {
      name:  `Test User ${randInt(1000, 9999)}`,
      email: `test${randInt(1000, 9999)}@example.com`,
      role:  'user',
    }, { flow: 'user-crud' });

    check(res, {
      'create user: status 201': (r) => r.status === 201,
      'create user: tem id':     (r) => JSON.parse(r.body).id !== undefined,
    });
    recordError(res);

    if (res.status === 201) {
      createdId = JSON.parse(res.body).id;
    }
  });

  if (!createdId) return;

  sleep(1);

  group('user-crud › update', () => {
    const res = put(`/users/${createdId}`, { status: 'active' }, { flow: 'user-crud' });
    check(res, {
      'update user: status 200': (r) => r.status === 200,
    });
    recordError(res);
  });

  sleep(1);

  group('user-crud › delete', () => {
    const res = del(`/users/${createdId}`, { flow: 'user-crud' });
    check(res, {
      'delete user: status 204': (r) => r.status === 204,
    });
    recordError(res);
  });
}

/**
 * Simula processamento pesado (endpoint /process e /slow).
 */
function heavyFlow() {
  group('heavy › process', () => {
    const start = Date.now();
    const res = post('/process', {
      type: 'report',
      from: '2024-01-01',
      to:   '2024-12-31',
      filters: { status: 'active' },
    }, { flow: 'heavy' });
    processTrend.add(Date.now() - start);

    check(res, {
      'process: status 200':       (r) => r.status === 200,
      'process: completed':        (r) => JSON.parse(r.body).status === 'completed',
      'process: tem result':       (r) => JSON.parse(r.body).result !== undefined,
      'process: durationMs > 0':   (r) => JSON.parse(r.body).result?.durationMs > 0,
    });
    recordError(res);
  });

  sleep(randInt(2, 4));
}

/**
 * Bate no endpoint /slow e verifica a resposta.
 */
function slowFlow() {
  group('slow endpoint', () => {
    const res = get('/slow', null, { flow: 'slow' });
    check(res, {
      'slow: status 200':   (r) => r.status === 200,
      'slow: tem message':  (r) => JSON.parse(r.body).message !== undefined,
    });
    recordError(res);
  });
}

/**
 * Testa o endpoint caótico (/flaky) — 30% de chance de erro esperado.
 */
function flakyFlow() {
  group('flaky endpoint', () => {
    const res = get('/flaky', null, { flow: 'flaky' });

    flakyFailRate.add(res.status === 503);

    check(res, {
      'flaky: status 200 ou 503': (r) => [200, 503].includes(r.status),
    });
  });
}

/**
 * Verifica saúde e métricas da API.
 */
function observabilityFlow() {
  group('observability', () => {
    const healthRes = get('/health', null, { flow: 'obs' });
    check(healthRes, {
      'health: status 200':  (r) => r.status === 200,
      'health: status ok':   (r) => JSON.parse(r.body).status === 'ok',
    });

    sleep(0.5);

    const metricsRes = get('/metrics', null, { flow: 'obs' });
    check(metricsRes, {
      'metrics: status 200':          (r) => r.status === 200,
      'metrics: tem uptime_seconds':  (r) => JSON.parse(r.body).uptime_seconds !== undefined,
    });
  });
}

// ─── Setup (roda uma vez antes dos VUs) ──────────────────────────────────────

export function setup() {
  const res = http.get(`${BASE_URL}/health`);
  if (res.status !== 200) {
    fail(`API não está acessível em ${BASE_URL} — status ${res.status}`);
  }
  console.log(`✔  fake-api acessível em ${BASE_URL} — iniciando cenário: ${SCENARIO}`);
  return { baseUrl: BASE_URL };
}

// ─── Default function (executada por cada VU em cada iteração) ───────────────

export default function () {
  const rand = Math.random();

  if (rand < 0.35) {
    // 35% — navegação (mais comum)
    browseFlow();
  } else if (rand < 0.55) {
    // 20% — fluxo de pedido
    orderFlow();
  } else if (rand < 0.70) {
    // 15% — crud de usuário
    userCrudFlow();
  } else if (rand < 0.80) {
    // 10% — processamento pesado
    heavyFlow();
  } else if (rand < 0.88) {
    // 8% — endpoint lento
    slowFlow();
  } else if (rand < 0.95) {
    // 7% — endpoint caótico
    flakyFlow();
  } else {
    // 5% — observabilidade
    observabilityFlow();
  }

  // Think time entre iterações
  sleep(randInt(1, 3));
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export function teardown(data) {
  console.log(`\nTeste finalizado. Base URL usada: ${data.baseUrl}`);
}
