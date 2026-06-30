/**
 * One-time Argon2id benchmark helper.
 *
 * Confirms the configured Argon2id params hash a password in the target window
 * (~250–400 ms) on THIS host. Params come from the same env-driven config the
 * provider uses, so you tune AUTH_ARGON2_* and re-run until the timing fits.
 *
 * Usage:
 *   npm run --prefix backend auth:benchmark-argon2
 *   AUTH_ARGON2_MEMORY_COST=32768 npm run --prefix backend auth:benchmark-argon2
 */

import argon2 from 'argon2';
import { loadAuthConfig } from './config.js';

const TARGET_MIN_MS = 250;
const TARGET_MAX_MS = 400;
const SAMPLES = 5;

async function main(): Promise<void> {
  const { argon2: params } = loadAuthConfig();
  const password = 'benchmark-correct-horse-battery-staple';

  // Warm up (first call pays native init cost).
  await argon2.hash(password, { type: argon2.argon2id, ...params });

  const timings: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = process.hrtime.bigint();
    await argon2.hash(password, { type: argon2.argon2id, ...params });
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    timings.push(elapsedMs);
  }

  const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
  const min = Math.min(...timings);
  const max = Math.max(...timings);

  /* eslint-disable no-console */
  console.log('Argon2id params:', params);
  console.log(`samples=${SAMPLES} avg=${avg.toFixed(1)}ms min=${min.toFixed(1)}ms max=${max.toFixed(1)}ms`);
  if (avg < TARGET_MIN_MS) {
    console.log(`⚠️  avg below target ${TARGET_MIN_MS}ms — consider raising memoryCost/timeCost.`);
  } else if (avg > TARGET_MAX_MS) {
    console.log(`⚠️  avg above target ${TARGET_MAX_MS}ms — consider lowering memoryCost/timeCost.`);
  } else {
    console.log(`✅ within target ${TARGET_MIN_MS}-${TARGET_MAX_MS}ms.`);
  }
  /* eslint-enable no-console */
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
