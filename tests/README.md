# Tests

Two suites — unit tests (Vitest + jsdom, no browser) and integration tests (Playwright, real browser).

Playwright lives in `browser/` with its own `node_modules` to avoid conflicts with Vitest's globals.

---

## Setup

```bash
# Unit test dependencies
cd tests
npm install

# Browser test dependencies — separate install to avoid conflicts
cd tests/browser
npm install
npx playwright install chromium firefox   # first time only
```

`digital-rain.js` must be at `../digital-rain.js` relative to `tests/`.

---

## Run

All commands from `tests/`:

```bash
# Unit tests only (fast, no browser)
npm test

# Unit tests in watch mode
npm run test:watch

# Integration tests (real browser)
npm run test:browser

# Both suites
npm run test:all
```

---

## Files

```
tests/
├── README.md
├── package.json              ← Vitest only
├── vitest.config.js
├── digital-rain.test.js      ← unit tests + inlined jsdom mocks
└── browser/
    ├── package.json          ← Playwright only (separate node_modules)
    ├── playwright.config.js
    ├── harness.html          ← test page served to Playwright
    └── digital-rain.spec.js  ← integration tests

../digital-rain.js            ← library under test
```

---

## Unit tests (`npm test`)

Run in jsdom — Worker and OffscreenCanvas are mocked. Fast, no browser needed.

| Group | What's tested |
|-------|---------------|
| `CHARSETS` | 16 entries, all non-empty strings, correct keys |
| `DEFAULTS` | All expected keys including `layers`, speedTiers shape, sensible values |
| `OPTIONS` | Keys align with DEFAULTS, each entry has type/default/description |
| `getInstance` | Null before/after, returns instance, accepts selector |
| `help()` | Does not throw |
| Constructor | Throws for missing element, accepts element/selector, merges options |
| Layers | `_layers` null by default, child instances created per config, z-index stacking, `getLayer()`, `configure()` propagation, `destroy()` cleanup, direction enforced from parent, container-level options stripped from layers |
| Lifecycle | Full state machine: start/stop/pause/resume/destroy |
| Worker communication | Correct messages posted for every method |
| `getConfig()` | Clone, excludes callbacks, reflects changes |
| `getStats()` | Returns Promise, resolves without worker, resolves via mock reply |
| Events | All 7 events, chaining, error swallowing |
| `_resolveTheme()` | All 5 named themes, hex, HSL, glowColor override, fallback |
| `randomize()` | Invariants over 20 runs: ranges, charset source, overrides |
| Canvas/DOM | Injection, styles, removal, `hideChildren`, `tapToBurst` |
| `startDelay` | Deferred mount, mounts after delay |
| Structure | Worker embed, LUTs, message types, `layers` in DEFAULTS, `getLayer` present |

---

## Integration tests (`npm run test:browser`)

Run in Chromium and Firefox via Playwright with a real Worker + OffscreenCanvas.

| Group | What's tested |
|-------|---------------|
| Worker lifecycle | Created on start, terminated on stop, no-op double-start, fresh worker after stop+start |
| Canvas DOM | Injected, correct styles, removed on stop, opacity, pointerEvents, non-zero dimensions |
| `getStats()` | Correct shape, columns > 0, booting/paused flags, frame advances, pauses correctly |
| Events | All 7 events through real postMessage chain |
| `configure()` | Config updates, opacity live, theme/direction don't throw, density affects worker state |
| `getInstance` | By selector, null after destroy |
| `hideChildren` | Hides on start, restores on stop |
| `tapToBurst` | Real click fires burstStart |
| `randomize()` | Restarts cleanly, keeps running, overrides respected |
| Layers | 3 canvases created, all workers running, stop removes all canvases, `getLayer()` returns correct instance, `configure()` propagates to all, per-layer targeted configure, `destroy()` removes wrappers, direction enforced across all layers, `hideChildren` managed by parent |
| Multiple instances | Two instances run independently, stopping one doesn't affect other |
| Stress | 5× start/stop cycles without error |

---

## Adding tests

**Unit tests** — add `describe`/`it` blocks to `digital-rain.test.js`. Test observable outputs (config values, messages posted, DOM state) not internal fields.

**Integration tests** — add `test()` blocks to `browser/digital-rain.spec.js`. Use `boot(page, opts)` for tests that need a running instance, `load(page)` for tests that set up their own. Keep timeouts generous — worker startup takes ~100ms.

The layers section of the project README lists which options are valid per-layer (appearance, speed, trails, bursts, intro, density) and which are container-level only (direction, hideChildren, tapToBurst, startDelay, fadeOutDuration, on).

When a new option is added to `DEFAULTS`, add it to the DEFAULTS unit test and determine whether it belongs in the per-layer or container-level category, then update the README accordingly. When a new worker message type is added, add it to the structural integrity check and add an integration test verifying it reaches the worker.