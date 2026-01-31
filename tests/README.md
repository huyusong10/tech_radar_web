# Load Testing for Tech Radar Weekly

This directory contains load testing scripts to verify the server can handle high concurrency scenarios.

## Quick Start

```bash
# Terminal 1: Start server in load test mode (disables rate limits)
npm run start:test

# Terminal 2: Run the benchmark to find max concurrency
npm run test:benchmark
```

## Important: Load Test Mode

When running high concurrency tests, **you must start the server with `LOAD_TEST_MODE=true`** to disable rate limits and per-IP connection limits:

```bash
# Option 1: Use the npm script
npm run start:test

# Option 2: Set environment variable manually
LOAD_TEST_MODE=true npm start

# Windows Command Prompt
set LOAD_TEST_MODE=true && npm start

# Windows PowerShell
$env:LOAD_TEST_MODE="true"; npm start
```

When `LOAD_TEST_MODE=true`, the server will:
- Disable rate limiting (normally 240 reads/min, 20 writes/min per IP)
- Remove per-IP SSE connection limit (normally 5 per IP)
- Increase total SSE limit from 1000 to 10000

## Test Scripts

| Command | Description |
|---------|-------------|
| `npm run start:test` | Start server in load test mode |
| `npm run test:load` | Default mixed test (100 concurrent, 30s) |
| `npm run test:load:api` | API-only test (500 concurrent) |
| `npm run test:load:sse` | SSE connection test (100 connections) |
| `npm run test:load:1k` | 1000 concurrent API clients for 60s |
| `npm run test:load:volume` | Volume switching simulation (200 users) |
| `npm run test:benchmark` | **Auto-find maximum sustainable concurrency** |

## Benchmark Test

The benchmark test automatically finds your server's maximum sustainable concurrency:

```bash
# Start server in test mode first
npm run start:test

# Run benchmark
npm run test:benchmark
```

The benchmark will:
1. Incrementally test concurrency levels: 50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000
2. For each level, run a 10-second test
3. Check if success rate >= 95% and P95 response time < 500ms
4. Stop when thresholds are exceeded
5. Report the maximum sustainable concurrency

Example output:
```
============================================================
BENCHMARK RESULTS
============================================================

Thresholds: Success Rate >= 95%, P95 < 500ms

Concurrency | RPS     | Success Rate | P95 (ms) | Status
------------------------------------------------------------
         50 |    1250 |       100.0% |       15 | PASS
        100 |    2340 |       100.0% |       28 | PASS
        200 |    4520 |        99.8% |       45 | PASS
        500 |    8900 |        98.5% |      120 | PASS
       1000 |   12500 |        96.2% |      280 | PASS
       1500 |   14200 |        94.1% |      520 | FAIL

============================================================
MAXIMUM SUSTAINABLE CONCURRENCY: 1000
  - RPS: 12500
  - Success Rate: 96.2%
  - P95 Response Time: 280ms
============================================================
```

## Manual Usage

```bash
node tests/load-test.js [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--target <url>` | Target server URL | `http://localhost:5090` |
| `--concurrency <n>` | Number of concurrent clients | `100` |
| `--duration <s>` | Test duration in seconds | `30` |
| `--test <type>` | Test type (see below) | `mixed` |
| `--ramp-up <s>` | Ramp-up time in seconds | `5` |

### Test Types

| Type | Description |
|------|-------------|
| `api` | Pure HTTP API load test |
| `sse` | SSE connection stress test |
| `mixed` | Combined: 80% API + 20% SSE clients |
| `volume` | Simulate users switching volumes |
| `benchmark` | Auto-detect maximum sustainable concurrency |

### Examples

```bash
# 1000 concurrent API clients for 60 seconds
node tests/load-test.js --test api --concurrency 1000 --duration 60

# 500 SSE connections
node tests/load-test.js --test sse --concurrency 500

# Simulate 200 users switching volumes
node tests/load-test.js --test volume --concurrency 200

# Test against a remote server
node tests/load-test.js --target https://example.com --test benchmark
```

## Output Metrics

The test outputs detailed statistics:

```
============================================================
LOAD TEST RESULTS
============================================================

[Requests]
  Total:        15234
  Success:      15189
  Failed:       45
  Timeout:      12
  Success Rate: 99.7%
  RPS:          507.80

[Response Times]
  Average:      45.23ms
  Min:          2.15ms
  Max:          892.45ms
  P50:          32.18ms
  P95:          125.67ms
  P99:          245.89ms

[Status Codes]
  200: 15189
  429: 33
  503: 12

[SSE Connections]
  Connected:    100
  Disconnected: 100
  Messages:     523
  Errors:       0

============================================================
```

## Performance Expectations

Expected results on a typical development machine:

| Test Type | Concurrency | Expected RPS | P95 Response Time |
|-----------|-------------|--------------|-------------------|
| API | 100 | 500+ | < 100ms |
| API | 500 | 1000+ | < 200ms |
| API | 1000 | 1500+ | < 500ms |
| SSE | 100 | N/A | Connect < 100ms |
| SSE | 1000 | N/A | Connect < 500ms |
| Mixed | 100 | 400+ | < 150ms |

## Troubleshooting

### "Too many connections" or 429 errors

Make sure you started the server with `LOAD_TEST_MODE=true`:
```bash
npm run start:test
```

### High failure rate

1. Reduce concurrency
2. Check system resource limits: `ulimit -n`
3. Increase file descriptor limit: `ulimit -n 65535`

### Connection refused

```bash
# Linux/Mac: Increase file descriptor limit
ulimit -n 65535

# Check if server is running
curl http://localhost:5090/api/health
```

### Server becomes unresponsive

The server has built-in protection (disabled in LOAD_TEST_MODE):
- Rate limiting: 240 reads/min, 20 writes/min per IP
- SSE limit: 1000 total, 5 per IP
- Request timeout: 30 seconds

## Notes

- Tests use only Node.js built-in modules (no external dependencies)
- All tests are non-destructive (read-only operations)
- Benchmark stops at first failed level to avoid server overload
- Results vary based on hardware, OS, and network conditions
