# digital-rain

Digital rain with concentric ripple burst effects.
No dependencies. Single file.

---

## Setup

```html
<!-- Optional: load Share Tech Mono for authentic look -->
<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet">
<script src="digital-rain.js"></script>

<div id="rain" style="position:fixed;inset:0;"></div>

<script>
    new DigitalRain('#rain').start();
</script>
```

**Only the element is required.** Everything else has defaults.

---

## Canvas and z-index

The canvas is injected as `position: absolute; z-index: 9999` inside the container.
Content inside the container at a lower z-index will show through where the rain isn't drawing.

```html
<div id="rain" style="position:relative;">
    <p style="position:relative; z-index:1;">This text shows through the rain.</p>
</div>
```

---

## Options

```js
new DigitalRain('#container', {

    // ── Startup ───────────────────────────────────────────────────────────
    startDelay:       0,      // seconds before rain begins

    // ── Speed ─────────────────────────────────────────────────────────────
    dropSpeed:        99,     // 0=frozen, 1=barely moving, 99=fast, 100=fastest

    // Speed tiers — weighted random selection per column.
    // frameSkip: frames between steps (lower = faster)
    // weight: relative probability (doesn't need to sum to 100)
    speedTiers: [
        { frameSkip: 2,  weight: 50 },   // fast
        { frameSkip: 4,  weight: 42 },   // medium
        { frameSkip: 10, weight: 4  },   // slow
        { frameSkip: 13, weight: 4  },   // very slow
    ],

    // ── Trails ────────────────────────────────────────────────────────────
    trailLengthFast:  28,     // trail length for fastest columns
    trailLengthSlow:  70,     // trail length for slowest columns

    // ── Dual streams ──────────────────────────────────────────────────────
    dualFrequency:    50,     // 0=never, 100=very frequent second stream per column
    dualMinGap:       10,     // min row gap between two streams in same column

    // ── Bursts ────────────────────────────────────────────────────────────
    burst:            true,   // enable/disable automatic ripple bursts
    burstDurationMin: 3,      // seconds — how long each burst lasts
    burstDurationMax: 7,
    burstIntervalMin: 30,     // seconds between automatic bursts
    burstIntervalMax: 60,
    burstFirstMin:    20,     // seconds before the first burst fires
    burstFirstMax:    40,

    // ── Tap to burst ──────────────────────────────────────────────────────
    tapToBurst:       false,  // click/tap canvas to trigger burst at that position

    // ── Intro sequence ────────────────────────────────────────────────────
    introDepth:       50,     // 0=no intro (all drops start at once),
                              // 50=pioneer drops to halfway, 100=pioneer drops to bottom
    introSpeed:       50,     // speed of the pioneer drop: 0=frozen, 100=fastest
                              // independent of dropSpeed

})
```

---

## API

```js
const rain = new DigitalRain('#el', options);

rain.start()              // start (respects startDelay)
rain.stop()               // stop and remove canvas
rain.destroy()            // alias for stop()
rain.triggerBurst(col?)   // fire a burst (optional column index, random row)
rain.configure(options)   // update any options live — no restart needed
```

---

## Examples

### Full screen, immediate start
```js
new DigitalRain('#container').start();
```

### No bursts, slower drops
```js
new DigitalRain('#container', {
    burst:     false,
    dropSpeed: 60,
}).start();
```

### Click anywhere to burst at that spot
```js
new DigitalRain('#container', {
    tapToBurst: true,
}).start();
```

### Fast frequent bursts (demo/testing)
```js
new DigitalRain('#container', {
    burstFirstMin:    3,
    burstFirstMax:    5,
    burstIntervalMin: 5,
    burstIntervalMax: 10,
}).start();
```

### Update options live
```js
const rain = new DigitalRain('#container').start();

// Slow everything down without restarting
rain.configure({ dropSpeed: 30 });

// Turn off bursts
rain.configure({ burst: false });
```

### Stop and restart
```js
rain.stop();
setTimeout(() => rain.start(), 3000);
```

### Dramatic slow intro, then fast rain
```js
new DigitalRain('#container', {
    introDepth: 100,   // pioneer drops all the way to the bottom
    introSpeed: 20,    // crawls down slowly
    dropSpeed:  98,    // main rain is fast
}).start();
```

### No intro — all drops start at once
```js
new DigitalRain('#container', {
    introDepth: 0,
}).start();
```

---

## Intro sequence

On start, a single pioneer stream drops down the center column. Once it reaches its
target depth, the full rain kicks in from the top. The pioneer stream continues
naturally as part of the full rain.

`introDepth` controls how far the pioneer drop falls before the rest begin:
- `0` — no intro; all columns start immediately
- `50` — pioneer drops to the vertical midpoint (default)
- `100` — pioneer drops all the way to the bottom

`introSpeed` controls the pioneer drop's speed on the same 0–100 scale as `dropSpeed`,
but independently — so you can make it crawl in dramatically while the main rain runs fast.

Both options can be passed at construction or updated via `configure()`. Since the intro
is a one-shot on `start()`, call `stop()` then `start()` to replay it with new values.

---

## Files

```
digital-rain/
├── digital-rain.js   ← library (no dependencies)
├── demo.html         ← interactive demo with live controls
└── README.md
```