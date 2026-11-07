// Feature 002 · Consultar liquidación — medición del tiempo de respuesta (T018, NFR-001).
// Mide GET /api/settlements contra la aplicación corriendo, con los datos de
// datos-tc-002.sql y el Módulo 2 simulado. Objetivo: el 95 % de las consultas en menos de
// 800 ms con Módulo 2 respondiendo dentro de su timeout de 500 ms.
//
// Uso, con la aplicación y el Módulo 2 simulado ya corriendo (este con DELAY_MS=450 para
// el peor caso permitido):
//   $env:SEED_OTA_PASSWORD = "<clave de ota-demo>"; node features/002-consultar-liquidacion/4-testing/medir-tiempos.js
// Variables opcionales: BASE_URL (http://localhost:3000), SEED_OTA_USERNAME (ota-demo),
// REQUESTS por tipo de consulta (200) y CONCURRENCY (4 consultas a la vez).
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const REQUESTS = Number(process.env.REQUESTS || 200);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);
const TARGET_P95_MS = 800;

const ROOM = (n) => `0a020000-0000-4000-8000-000000000${n}`;

async function otaToken() {
  const response = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: process.env.SEED_OTA_USERNAME || 'ota-demo',
      password: process.env.SEED_OTA_PASSWORD,
    }),
  });
  if (!response.ok) throw new Error(`Login de la OTA falló con ${response.status}`);
  return (await response.json()).accessToken;
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function measure(name, path, headers = {}) {
  const times = [];
  const statuses = new Map();
  let next = 0;
  const worker = async () => {
    while (next < REQUESTS) {
      next += 1;
      const started = performance.now();
      const response = await fetch(`${BASE_URL}${path}`, { headers });
      await response.arrayBuffer();
      times.push(performance.now() - started);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  times.sort((a, b) => a - b);
  return { name, times, statuses };
}

function report({ name, times, statuses }) {
  const fmt = (ms) => `${ms.toFixed(0)} ms`;
  const codes = [...statuses].map(([status, count]) => `${status}×${count}`).join(', ');
  console.log(
    `${name.padEnd(34)} p50 ${fmt(percentile(times, 50)).padStart(7)}  p95 ${fmt(percentile(times, 95)).padStart(7)}  máx ${fmt(times[times.length - 1]).padStart(7)}  (${codes})`,
  );
}

(async () => {
  const token = await otaToken();
  console.log(`${REQUESTS} consultas por tipo, ${CONCURRENCY} a la vez, contra ${BASE_URL}\n`);
  const results = [
    await measure('OTA: colección de su reserva', '/api/settlements?reservationRef=RES-TC002-OTA', {
      Authorization: `Bearer ${token}`,
    }),
    await measure(
      'Módulo 1: FINAL',
      `/api/settlements?reservationRef=RES-TC002-OTA&roomId=${ROOM(101)}`,
    ),
    await measure(
      'Módulo 1: INFORMATIVE (llama a M2)',
      `/api/settlements?reservationRef=RES-TC002-OTA&roomId=${ROOM(103)}`,
    ),
  ];
  results.forEach(report);
  const all = results.flatMap((result) => result.times).sort((a, b) => a - b);
  report({ name: 'Todas', times: all, statuses: new Map([['total', all.length]]) });

  const allOk = results.every(({ statuses }) => statuses.size === 1 && statuses.has(200));
  const p95 = percentile(all, 95);
  console.log(
    `\n${allOk && p95 < TARGET_P95_MS ? 'CUMPLE' : 'NO CUMPLE'}: p95 ${p95.toFixed(0)} ms (objetivo < ${TARGET_P95_MS} ms)${allOk ? '' : ', hubo respuestas distintas de 200'}`,
  );
  process.exitCode = allOk && p95 < TARGET_P95_MS ? 0 : 1;
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
