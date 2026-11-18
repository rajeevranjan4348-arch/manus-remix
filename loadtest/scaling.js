import http from 'k6/http';
import { check, sleep } from 'k6';

const profiles = {
  '1000': { target: 1_000, ramp: '3m', hold: '5m' },
  '10000': { target: 10_000, ramp: '10m', hold: '5m' },
  '100000': { target: 100_000, ramp: '20m', hold: '5m' },
  '1000000': { target: 1_000_000, ramp: '30m', hold: '10m' },
};

const profileName = __ENV.PROFILE || '1000';
const profile = profiles[profileName];
if (!profile) {
  throw new Error(`PROFILE must be one of: ${Object.keys(profiles).join(', ')}`);
}

const mode = __ENV.TEST_MODE || 'health';
if (!['health', 'ai'].includes(mode)) {
  throw new Error('TEST_MODE must be health or ai');
}

const baseUrl = String(__ENV.BASE_URL || '').replace(/\/$/, '');
if (!/^https?:\/\//i.test(baseUrl)) {
  throw new Error('Set BASE_URL to the HTTPS URL of a staging deployment.');
}

let firebaseTokens = [];
if (mode === 'ai') {
  if (profile.target > 1_000) {
    throw new Error('AI mode is capped at 1,000 VUs in this script; higher-volume AI tests need explicit provider quota/cost approval.');
  }
  const tokenFile = __ENV.FIREBASE_TOKENS_FILE;
  if (!tokenFile) {
    throw new Error('Set FIREBASE_TOKENS_FILE to a local JSON array of dedicated Firebase ID tokens.');
  }
  try {
    firebaseTokens = JSON.parse(open(tokenFile));
  } catch {
    throw new Error('FIREBASE_TOKENS_FILE must contain a valid JSON array.');
  }
  if (!Array.isArray(firebaseTokens) || firebaseTokens.length < profile.target || firebaseTokens.some((token) => typeof token !== 'string' || !token.trim())) {
    throw new Error(`AI mode requires at least ${profile.target} non-empty tokens, one dedicated test user per VU.`);
  }
}

const healthThresholds = {
  // Starting targets only; replace with the service's approved SLO before a capacity gate.
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1000', 'p(99)<2500'],
  checks: ['rate>0.99'],
};
const aiThresholds = {
  // These are provisional end-to-end ceilings, not measured service guarantees.
  http_req_failed: ['rate<0.05'],
  http_req_duration: ['p(95)<30000', 'p(99)<60000'],
  checks: ['rate>0.95'],
};

export const options = {
  stages: [
    { duration: profile.ramp, target: profile.target },
    { duration: profile.hold, target: profile.target },
    { duration: profile.ramp, target: 0 },
  ],
  thresholds: mode === 'health' ? healthThresholds : aiThresholds,
  tags: { profile: profileName, mode },
};

export default function () {
  if (mode === 'health') {
    const response = http.get(`${baseUrl}/api/health`, {
      tags: { endpoint: 'health' },
      timeout: '10s',
    });
    check(response, {
      'health responds 200': (res) => res.status === 200,
      'health body reports ok': (res) => {
        try {
          return JSON.parse(res.body).ok === true;
        } catch {
          return false;
        }
      },
    });
    sleep(Number(__ENV.HEALTH_THINK_SECONDS || 30));
    return;
  }

  const token = firebaseTokens[(__VU - 1) % firebaseTokens.length];
  const response = http.post(
    `${baseUrl}/api/ai/load-test`,
    JSON.stringify({
      requestId: `k6-${profileName}-${__VU}-${__ITER}`,
      prompt: 'Reply with the single word OK.',
      model: 'gemini-3-flash-preview',
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      tags: { endpoint: 'ai' },
      timeout: '90s',
    },
  );
  check(response, {
    'AI endpoint responds 200': (res) => res.status === 200,
    'AI endpoint returns an event stream': (res) => String(res.headers['Content-Type'] || '').includes('text/event-stream'),
  });
  sleep(Number(__ENV.AI_THINK_SECONDS || 10));
}
