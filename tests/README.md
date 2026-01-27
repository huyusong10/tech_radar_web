# Load Testing for Tech Radar Weekly

This directory contains load testing scripts to verify the server can handle high concurrency scenarios.

## Quick Start

```bash
# Start the server first
npm start

# In another terminal, run the default load test
npm run test:load
```

## Test Scripts

| Command | Description |
|---------|-------------|
| `npm run test:load` | Default mixed test (100 concurrent, 30s) |
| `npm run test:load:api` | API-only test (500 concurrent) |
| `npm run test:load:sse` | SSE connection test (100 connections) |
| `npm run test:load:1k` | 1000 concurrent API clients for 60s |
| `npm run test:load:volume` | Volume switching simulation (200 users) |

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
| `--test <type>` | Test type: `api`, `sse`, `mixed`, `volume` | `mixed` |
| `--ramp-up <s>` | Ramp-up time in seconds | `5` |

### Examples

```bash
# Test with 500 concurrent clients for 60 seconds
node tests/load-test.js --concurrency 500 --duration 60

# Test SSE connections only
node tests/load-test.js --test sse --concurrency 100

# Test 1000 concurrent API requests
node tests/load-test.js --test api --concurrency 1000 --duration 30

# Simulate volume switching behavior
node tests/load-test.js --test volume --concurrency 200

# Test against a remote server
node tests/load-test.js --target https://example.com --concurrency 100
```

## Test Types

### `api` - API Load Test

Tests HTTP API endpoints under high concurrency:
- `/api/config`
- `/api/authors`
- `/api/volumes`
- `/api/contributions/:vol`
- `/api/likes`
- `/api/views/:vol`
- `/api/health`

### `sse` - SSE Connection Test

Tests Server-Sent Events (hot reload) connections:
- Opens specified number of SSE connections
- Maintains connections for the test duration
- Monitors connect/disconnect events and messages

### `mixed` - Mixed Load Test

Combines API and SSE tests:
- 80% of clients make API requests
- 20% of clients maintain SSE connections

### `volume` - Volume Switch Simulation

Simulates real user behavior:
- Each virtual user connects to SSE
- Randomly switches between volumes
- Makes API requests for contributions and views
- Includes realistic read time delays (2-5 seconds)

## Output

The test outputs detailed statistics:

```
============================================================
LOAD TEST RESULTS
============================================================

[Requests]
  Total:     15234
  Success:   15189
  Failed:    45
  Timeout:   12
  RPS:       507.80

[Response Times]
  Average:   45.23ms
  Min:       2.15ms
  Max:       892.45ms
  P50:       32.18ms
  P95:       125.67ms
  P99:       245.89ms

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

## Performance Benchmarks

Expected results on a typical development machine:

| Test Type | Concurrency | Expected RPS | P95 Response Time |
|-----------|-------------|--------------|-------------------|
| API | 100 | 500+ | < 100ms |
| API | 500 | 1000+ | < 200ms |
| API | 1000 | 1500+ | < 500ms |
| SSE | 100 | N/A | Connect < 100ms |
| Mixed | 100 | 400+ | < 150ms |

## Troubleshooting

### High failure rate

If you see many failures:
1. Check if the server is running
2. Reduce concurrency
3. Check system resource limits (`ulimit -n`)

### Connection refused

```bash
# Increase file descriptor limit
ulimit -n 65535
```

### Server becomes unresponsive

The server has built-in protection:
- Rate limiting: 240 reads/min, 20 writes/min per IP
- SSE limit: 1000 total, 5 per IP
- Request timeout: 30 seconds

## Notes

- Tests use only Node.js built-in modules (no external dependencies)
- All tests are non-destructive (read-only operations)
- SSE tests respect the server's per-IP connection limit
