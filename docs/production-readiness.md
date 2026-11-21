# Production readiness: current state, limits, and next steps

## What the repository runs today

The production build is a Vite/React static app on Netlify with Netlify Functions for the AI stream, web search, real-time data, checkpoints, permissions, and health checks. Firebase Auth supplies user identity; Firestore and browser IndexedDB are both in use. Static assets can use Netlify's edge delivery, but the API functions are not a multi-region active/active service. The PostgreSQL/Drizzle API code is attached to Vite's development middleware, not to a Netlify Function in this repository.

The existing AI route streams responses and has Gemini/OpenRouter fallbacks, an Upstash-backed per-user request limiter, and circuit breakers. The limiter is shared when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are configured. The circuit breakers and recovery event ring are process-local, so their state is not shared among serverless instances and disappears on a cold start. AI generation and live research still run synchronously inside a function invocation; there is no durable worker queue or global admission controller in this code.

## Changes made in this increment

- The deployed real-time route now verifies the existing Firebase bearer token and applies the shared per-user Redis limiter before performing upstream work. POST input is byte-capped and query/city lengths are checked.
- The real-time browser skill, My AI chat, and voice-chat caller now reuse the app's current Firebase ID token for their protected API calls. No second authentication system was added.
- AI and web-search request bodies now enforce their limits against the bytes actually streamed, not only a caller-supplied `Content-Length` header.
- Added a k6 test script with 1,000, 10,000, 100,000, and 1,000,000 virtual-user profiles. Health-only mode is the default; AI mode is guarded to at most 1,000 VUs and requires one dedicated Firebase test token per virtual user.

These changes do not provision Redis, alter the database, deploy the app, or establish a measured capacity.

## What is not proven or production-ready yet

No external load test has been run. The local environment has not generated evidence for any concurrent-user capacity tier, and a million virtual users must be distributed across suitably large load generators. The health endpoint only tests the HTTP/function path; it does not exercise authentication, Redis, Firestore, model-provider quotas, or realistic chat latency. AI mode is a separate, potentially billable staging test.

Additional blockers visible in the code/configuration:

- **Transient server state:** checkpoint data and connector OAuth/token state use in-memory maps. A new function instance or cold start can lose them. Move such state to a durable, access-controlled store before relying on recovery or connector sessions at scale.
- **PostgreSQL mismatch:** `/api/sql/*` handlers and a `pg.Pool(max: 10)` exist in the Vite development server, but there is no matching Netlify function/redirect here. Do not count this PostgreSQL path as a production database service. Its current upserts now restrict conflict updates and project/message relationships to the authenticated owner; add database-backed integration tests, pagination, tenant/time indexes, and a serverless-safe pooler before activating it or increasing function concurrency.
- **Firestore operations:** the code uses Firebase/Firestore, but this repository does not prove the selected database region, production indexes, PITR/backups, restore drills, App Check, or project quotas. Verify those settings in the actual Firebase project.
- **Function and provider limits:** the Netlify account plan, function concurrency/timeout configuration, Firebase project quotas, Redis throughput, and Gemini/OpenRouter quotas are not available in this checkout. They must be checked against the real accounts before a capacity promise.
- **No queue or idempotency store:** long research tasks occupy a streaming function, and request IDs are not a durable deduplication key. Add a durable queue and atomic idempotency record for work that can safely run asynchronously; preserve streaming for interactive chat.
- **Operational metrics:** the app's recovery telemetry is an in-memory diagnostic ring. Use the deployment platform's retained function observability and provider usage metrics for durable latency/error/cost dashboards and alerts; attach CPU/memory and queue metrics from the actual runtime during tests.
- **Multi-region:** no active/active API, cross-region datastore failover, or tested disaster-recovery path is configured. Choose a primary data region first, then test a recovery region and data consistency before enabling global writes.

## Load-test procedure

Use an isolated staging deployment with a dedicated dataset and billing limits, not production. Install k6 on distributed load generators and run one tier at a time. The script reports request rate, response latency (including p95/p99), failure rate, and checks. It does not measure the service's CPU, memory, provider quota, database saturation, or total spend; collect those from Netlify, Firebase/Google Cloud, Upstash, and model-provider dashboards during each run.

Health-only examples:

```bash
k6 run -e BASE_URL=https://YOUR-STAGING-SITE -e PROFILE=1000 loadtest/scaling.js
k6 run -e BASE_URL=https://YOUR-STAGING-SITE -e PROFILE=10000 loadtest/scaling.js
k6 run -e BASE_URL=https://YOUR-STAGING-SITE -e PROFILE=100000 loadtest/scaling.js
k6 run -e BASE_URL=https://YOUR-STAGING-SITE -e PROFILE=1000000 loadtest/scaling.js
```

Run AI mode only after approving a provider spend cap, having sufficient model quota, and creating dedicated test users. Put the array of Firebase ID tokens in a local JSON file that is excluded from source control; never commit it:

```bash
k6 run -e BASE_URL=https://YOUR-STAGING-SITE -e PROFILE=1000 -e TEST_MODE=ai -e FIREBASE_TOKENS_FILE=./loadtest/firebase-id-tokens.json loadtest/scaling.js
```

The script's thresholds are initial targets, not service guarantees. Before calling a tier passed, retain the raw k6 summary, test duration, region/load-generator count, app commit/deploy ID, function concurrency, p95/p99, error codes, provider throttles, DB/Redis metrics, and measured bill impact. Stop a run if spend or error-rate guardrails are crossed. The k6 binary was not installed here, and no cloud-tier test has been executed.

## Cost sketch (not a budget quote)

Registered-user count alone does not determine spend. AI turns, prompt/output tokens, search grounding, function duration, database operations, stored bytes, egress, backups, and the selected account plans determine it. Public list prices and metering can change; check the linked vendor page and the owner's actual plan before approving a launch budget.

A transparent model-cost example: **1,000,000 turns/day**, averaging **1,000 input tokens and 500 output tokens per turn**, with no search grounding or retries, would use 1 billion input tokens and 500 million output tokens per day. At the published Gemini 3.8 Flash rates of **$0.75 per million input tokens and $3.75 per million output tokens**, that is **$2,625/day** or **$78,750 per 30-day month**. The published table says those rates change to $1.50/$7.50 from January 1, 2027, which doubles this example. This is an illustration, not a prediction: the repository currently maps some model aliases to `gemini-3-flash-preview`, so verify the actual billed model ID. Google Search grounding is billed separately after the included allowance; the current documented default daily cap is 1,500 requests per project, so it must not be assumed that a million grounded turns can be served.

Other measurable unit examples:

| Meter | Public unit-price example | Example scale | What it excludes |
|---|---:|---:|---|
| Netlify function compute | Default 1 GB allocation; 10 credits per GB-hour on credit plans | 1 million 1-second invocations ≈ 278 GB-hours ≈ 2,778 credits. At 10 seconds each ≈ 2,778 GB-hours ≈ 27,778 credits. | Base plan, bandwidth, other credit usage, memory changes, and project-specific terms. The currently published Pro auto-recharge pack is 1,500 credits for $10; account plan is unknown. |
| Firestore reads/writes/deletes | Example published USD rates: $0.03 / $0.09 / $0.01 per 100,000 operations | 1 million reads ≈ $0.30; 1 million writes ≈ $0.90; 1 million deletes ≈ $0.10 | Region-specific SKU, index-entry reads, storage, bandwidth, PITR, backups, and free quota. |
| Upstash Redis commands | Pay-as-you-go example: $0.20 per 100,000 commands | If each of 1 million API calls maps to one billable limiter command, ≈ $2 | Storage, bandwidth, region/HA add-ons, plan limits, and exact script-command accounting. The published fixed tiers list a 10,000-command/second ceiling; confirm the chosen plan's actual limit. |

These components are not the whole bill. In the example above, model tokens alone are approximately $78,750/month at the currently published 3.8 Flash rate, before function compute, grounding, Redis, Firestore, egress, observability, retries, or taxes. Actual budget approval requires request volume, turns/user/day, average token counts, grounded-query share, data retention, region, and exact plan/model IDs.

## Pricing and platform references

- [Netlify Functions usage and billing](https://docs.netlify.com/build/functions/usage-and-billing/) and [credit-based plan details](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Cloud Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Gemini Developer API pricing](https://aistudio.google.com/docs/pricing)
- [Upstash Redis pricing](https://upstash.com/pricing/redis)
