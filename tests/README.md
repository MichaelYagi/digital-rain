# Tests

Unit tests for `digital-rain.js` using [Vitest](https://vitest.dev) and jsdom.
No browser required — Worker and OffscreenCanvas are mocked.

---

## Setup

```bash
cd tests
npm install
```

Place `digital-rain.js` one level up (i.e. at `../digital-rain.js` relative to this folder).

---

## Run

```bash
# Run all tests once
npm test

# Watch mode — re-runs on file save
npm run test:watch
```

---

## Files

```
tests/                         ← run npm test from here
├── README.md
├── package.json
├── vitest.config.js
└── digital-rain.test.js       ← all tests + inlined mocks

../digital-rain.js             ← library under test
```

All browser mocks (Worker, OffscreenCanvas, RAF, etc.) are inlined at the top of `digital-rain.test.js` so no separate setup file is needed.

---

## What's tested

| Group | Tests |
|-------|-------|
| `CHARSETS` | 16 entries, all non-empty strings, correct keys |
| `DEFAULTS` | All expected keys present, speedTiers shape, sensible values |
| `OPTIONS` | Keys align with DEFAULTS, each entry has type/default/description |
| `getInstance` | Null before construction, returns instance, accepts selector, null after destroy |
| `help()` | Does not throw |
| Constructor | Throws for missing element, accepts element/selector, merges options, registers in registry |
| Lifecycle | `isRunning`/`isPaused` state machine across all transitions |
| Worker communication | Correct messages for start/stop/pause/resume/configure/triggerBurst/getStats |
| `getConfig()` | Returns clone, excludes callbacks, reflects changes |
| `getStats()` | Returns Promise, resolves without worker, resolves via worker reply, handles multiple in-flight calls |
| Events | All 7 events fire correctly, chaining, error swallowing |
| `_resolveTheme()` | All 5 named themes, hex, HSL, glowColor override, invalid fallback |
| `randomize()` | Invariants (20 runs): trailLow≥Fast, durations, opacity range, charset source, HSL theme, overrides |
| Canvas/DOM | Injection, styles, removal, `hideChildren`, `tapToBurst`, opacity |
| `startDelay` | Deferred mount, mounts after delay |
| Structure | Worker embed, LUTs, message types, syncTo removed, no dead fields |

---

## Adding tests

Tests live in `tests/digital-rain.test.js`. Add a new `describe` block for each
feature area and `it` blocks for individual behaviours. Prefer testing observable
outputs (config values, messages posted, DOM changes) over internal state.

When a new option is added to `DEFAULTS`, add a test to the `DEFAULTS` and
`randomize()` sections. When a new worker message type is added, add it to the
structural integrity check.