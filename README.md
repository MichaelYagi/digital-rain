# digital-rain [![Sync to GitHub Pages](https://github.com/MichaelYagi/digital-rain/actions/workflows/sync-to-pages.yml/badge.svg)](https://github.com/MichaelYagi/digital-rain/actions/workflows/sync-to-pages.yml)

Demo [here](https://michaelyagi.github.io/digital-rain/demo.html).

Digital rain with lightning burst effects, color themes, event callbacks, parallax depth layers, and live configuration.
No dependencies. Single file. Rendering runs in a Web Worker via OffscreenCanvas for smooth, main-thread-free animation.

> **Browser support:** Requires OffscreenCanvas + Web Workers. All modern browsers (Chrome, Firefox, Edge, Safari 16.4+). Not supported in IE.

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
Content inside the container at a lower z-index will show through.

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

    // ── Appearance ────────────────────────────────────────────────────────
    fontSize:         14,     // px — controls column width and row height
    bgColor:          '#050505',
    glowAlpha:        0.6,    // glow intensity on stream heads (0–1)
    fontFamily:       '"Share Tech Mono", "Courier New", monospace',
    chars:            'アイウエオカキクケコ...0123456789ABCDEF',
    theme:            'green', // 'green'|'red'|'blue'|'white'|'amber'|'#rrggbb'|any CSS color
    glowColor:        null,   // head/glow color override. null = derived from theme.
    opacity:          1,      // canvas opacity (0–1)
    density:          100,    // fraction of columns active (0–100)
    direction:        'down', // 'down' | 'up'

    // ── Speed ─────────────────────────────────────────────────────────────
    dropSpeed:        98,     // 0=frozen, 1=barely moving, 100=fastest
    speedTiers: [
        { frameSkip: 2,  weight: 50 },
        { frameSkip: 4,  weight: 42 },
        { frameSkip: 10, weight: 4  },
        { frameSkip: 13, weight: 4  },
    ],

    // ── Trails ────────────────────────────────────────────────────────────
    trailLengthFast:  28,
    trailLengthSlow:  70,

    // ── Dual streams ──────────────────────────────────────────────────────
    dualFrequency:    50,     // 0=never, 100=very frequent
    dualMinGap:       10,

    // ── Bursts ────────────────────────────────────────────────────────────
    burst:            true,
    burstDurationMin: 3,
    burstDurationMax: 7,
    burstIntervalMin: 30,
    burstIntervalMax: 60,
    burstFirstMin:    20,
    burstFirstMax:    40,
    burstWidth:       10,
    burstReach:       140,
    burstAngle:       0.25,
    tapToBurst:       false,  // click/tap canvas to burst at that position

    // ── Content ───────────────────────────────────────────────────────────
    hideChildren:     false,  // hide container children on start, restore on stop
    fadeOutDuration:  0,      // seconds to fade before unmounting. 0 = instant.

    // ── Intro ─────────────────────────────────────────────────────────────
    introDepth:       50,     // 0=no intro, 50=halfway, 100=full depth
    introSpeed:       98,     // pioneer drop speed (0–100, independent of dropSpeed)

    // ── Parallax depth layers ─────────────────────────────────────────────
    layers:           null,   // array of per-layer config objects. null = single layer.

    // ── Events ────────────────────────────────────────────────────────────
    on: {
        start:         () => {},
        stop:          () => {},
        pause:         () => {},
        resume:        () => {},
        introComplete: () => {},
        burstStart:    ({ epicenter }) => {},
        burstEnd:      () => {},
    },

})
```

---

## API

```js
const rain = new DigitalRain('#el', options);

// ── Lifecycle ─────────────────────────────────────────────────────────────
rain.start()              // mount canvas and begin
rain.stop()               // stop, remove canvas, restore children
rain.destroy()            // alias for stop(); also removes from registry
rain.pause()              // freeze animation (canvas stays)
rain.resume()             // unfreeze; falls back to start() if not running

// ── State ─────────────────────────────────────────────────────────────────
rain.isRunning()          // true if started and not stopped (includes paused)
rain.isPaused()           // true if currently paused
rain.getConfig()          // shallow clone of current config (callbacks excluded)
await rain.getStats()     // Promise → { frame, fps, columns, activeColumns,
                          //   dormantColumns, streams, burstActive, paused, booting }

// ── Configuration ─────────────────────────────────────────────────────────
rain.configure(options)   // update any options live — no restart needed
rain.randomize(overrides?) // randomize visuals and restart. Returns applied config.
rain.triggerBurst(col?)   // fire a burst (col = column index, omit for random)

// ── Events ────────────────────────────────────────────────────────────────
rain.on(event, fn)        // register callback. Overwrites previous handler.

// ── Layers ────────────────────────────────────────────────────────────────
rain.getLayer(index)      // get a specific layer instance (0=back, 1=mid, 2=front)
                          // returns null when not in layers mode

// ── Static ────────────────────────────────────────────────────────────────
DigitalRain.getInstance(el)  // get running instance by element or selector
DigitalRain.CHARSETS         // built-in character set map
DigitalRain.OPTIONS          // all options with type, default, description
DigitalRain.DEFAULTS         // all default values
DigitalRain.help()           // print full reference to the console
```

---

## Parallax depth layers

The `layers` option stacks multiple independent rain layers in the same container for a 3D
depth effect — small dim rain in the background, full-quality rain in the middle, and large
fast rain in the foreground.

Each layer is a full `DigitalRain` instance with its own Worker and canvas. Any option that
works on a single instance works per-layer. All layers share the same direction.

```js
new DigitalRain('#container', {
    layers: [
        // back — small, dim, slightly slow, short trails
        {
            fontSize: 8, opacity: 0.25, dropSpeed: 60, density: 70,
            trailLengthFast: 6, trailLengthSlow: 12,
            dualFrequency: 0, burst: false, introDepth: 0,
        },
        // mid — full quality
        {
            fontSize: 14, opacity: 1.0, dropSpeed: 98, density: 100,
            trailLengthFast: 28, trailLengthSlow: 70, burst: true,
        },
        // front — large, fast, short trails, sparse
        {
            fontSize: 24, opacity: 0.65, dropSpeed: 98, density: 35,
            trailLengthFast: 4, trailLengthSlow: 8,
            dualFrequency: 0, burst: false, introDepth: 0,
        },
    ],
}).start();
```

**Per-layer allowed options:**

Any option not in the container-level table above can be set independently per layer:

| Category | Options |
|----------|---------|
| Appearance | `fontSize`, `opacity`, `theme`, `glowColor`, `bgColor`, `glowAlpha`, `fontFamily`, `chars` |
| Columns | `density`, `dualFrequency`, `dualMinGap` |
| Speed | `dropSpeed`, `speedTiers` |
| Trails | `trailLengthFast`, `trailLengthSlow` |
| Bursts | `burst`, `burstDurationMin`, `burstDurationMax`, `burstIntervalMin`, `burstIntervalMax`, `burstFirstMin`, `burstFirstMax`, `burstWidth`, `burstReach`, `burstAngle` |
| Intro | `introDepth`, `introSpeed` |

**Per-layer configuration after start:**

```js
rain.getLayer(0).configure({ opacity: 0.1 });   // dim the back layer
rain.getLayer(2).configure({ theme: 'red' });   // red foreground layer
rain.configure({ direction: 'up' });            // all layers at once
```

**Container-level options — handled by the parent, not per-layer:**

Some options apply to the container as a whole and are automatically enforced across all layers. Per-layer overrides for these are silently ignored.

| Option | Reason |
|--------|--------|
| `direction` | All layers must match or the depth effect breaks |
| `hideChildren` | There's one container with one set of children |
| `tapToBurst` | Parent wires a single click handler across all layers |
| `startDelay` | All layers start together |
| `fadeOutDuration` | Teardown is coordinated across all layers |
| `on` | Events fire once from the parent, not once per layer |

```js
new DigitalRain('#container', {
    direction:       'up',  // enforced on all layers — per-layer direction ignored
    hideChildren:    true,  // hides children on start, restores on stop
    fadeOutDuration: 1,     // fades all canvases together before stopping
    tapToBurst:      true,  // single click handler fires burst on all layers
    layers: [
        { fontSize: 8,  direction: 'down' }, // direction override silently ignored
        { fontSize: 14 },
        { fontSize: 24 },
    ],
}).start();
```

**Lifecycle methods delegate to all layers:**

```js
rain.start();   // starts all layers
rain.pause();   // pauses all layers
rain.stop();    // stops all layers, removes all canvases
```

**Performance tips:**

Each layer runs its own Web Worker, so keep back/front layers lean — lower density, shorter
trails, and `dualFrequency: 0`. The foreground layer can be fast with very short trails (4–8)
at low density (30–40%) which costs little GPU while still selling the depth effect.

---

## Color themes

| Value | Color |
|-------|-------|
| `'green'` | Classic matrix green (default) |
| `'red'` | Deep red with orange glow |
| `'blue'` | Electric blue |
| `'white'` | Cool white/grey |
| `'amber'` | Warm amber/gold |

Any hex string (`'#ff00ff'`, `'#0cf'`) or CSS color name is also accepted.
Unrecognised values fall back to green with a console warning.

```js
rain.configure({ theme: '#ff6600' });
rain.configure({ theme: 'green', glowColor: 'white' });  // green trails, white heads
rain.configure({ glowColor: null });                      // revert glow to theme default
```

---

## Character sets

`DigitalRain.CHARSETS` provides 16 built-in sets:

| Key | Description |
|-----|-------------|
| `katakana` | Japanese Katakana + hex digits (default) |
| `hiragana` | Japanese Hiragana + digits |
| `binary` | `01` |
| `hex` | `0–9 A–F` |
| `latin` | A–Z a–z 0–9 + punctuation |
| `greek` | Greek alphabet + math symbols |
| `russian` | Cyrillic alphabet |
| `runic` | Elder Futhark runes |
| `hangul` | Korean syllables |
| `arabic` | Arabic alphabet + digits |
| `braille` | Braille patterns |
| `box` | Box-drawing characters |
| `math` | Mathematical operators |
| `symbols` | ASCII punctuation + specials |
| `blocks` | Block and geometric shapes |
| `emoticons` | Miscellaneous symbols and dingbats |

```js
rain.configure({ chars: DigitalRain.CHARSETS.braille });
rain.configure({ chars: DigitalRain.CHARSETS.binary + DigitalRain.CHARSETS.runic });
```

---

## Events

```js
rain.on('start',         () => {});
rain.on('stop',          () => {});
rain.on('pause',         () => {});
rain.on('resume',        () => {});
rain.on('introComplete', () => {});
rain.on('burstStart',    ({ epicenter }) => console.log('col', epicenter));
rain.on('burstEnd',      () => {});
```

---

## Examples

### Full screen
```js
new DigitalRain('#container').start();
```

### Parallax depth
```js
new DigitalRain('#container', {
    layers: [
        { fontSize: 8,  opacity: 0.25, dropSpeed: 60, density: 70,  trailLengthFast: 6,  trailLengthSlow: 12, burst: false, introDepth: 0 },
        { fontSize: 14, opacity: 1.0,  dropSpeed: 98, density: 100, trailLengthFast: 28, trailLengthSlow: 70, burst: true },
        { fontSize: 24, opacity: 0.65, dropSpeed: 98, density: 35,  trailLengthFast: 4,  trailLengthSlow: 8,  burst: false, introDepth: 0 },
    ],
}).start();
```

### Per-layer themes
```js
const rain = new DigitalRain('#container', {
    layers: [{ fontSize: 8 }, { fontSize: 14 }, { fontSize: 24 }],
}).start();
rain.getLayer(0).configure({ theme: 'blue' });
rain.getLayer(2).configure({ theme: 'red' });
```

### No bursts, slower drops
```js
new DigitalRain('#container', { burst: false, dropSpeed: 40 }).start();
```

### Click to burst
```js
new DigitalRain('#container', { tapToBurst: true }).start();
```

### Dramatic slow intro
```js
new DigitalRain('#container', { introDepth: 100, introSpeed: 20, dropSpeed: 98 }).start();
```

### Red theme, binary charset, fade on stop
```js
new DigitalRain('#container', { theme: 'red', chars: '01', fadeOutDuration: 2 }).start();
```

### Hide content while running
```js
new DigitalRain('#hero', { hideChildren: true, fadeOutDuration: 1 }).start();
```

### Live configure
```js
const rain = new DigitalRain('#container').start();
rain.configure({ dropSpeed: 30 });
rain.configure({ theme: 'amber' });
rain.configure({ chars: DigitalRain.CHARSETS.binary });
rain.configure({ direction: 'up' });
rain.configure({ density: 40 });
rain.configure({ opacity: 0.4 });
```

### State inspection
```js
const stats = await rain.getStats();
console.log(stats.fps, stats.streams, stats.burstActive);
```

---

## Intro sequence

On start, a pioneer stream drops down the center column. Once it reaches its target depth,
the full rain begins. `introDepth` controls how far it falls (0=no intro, 100=full depth).
`introSpeed` controls its speed independently of `dropSpeed`. Call `stop()` then `start()`
to replay the intro.

---

## Files

```
digital-rain/
├── digital-rain.js   ← library (no dependencies)
├── demo.html         ← interactive demo with live controls
├── README.md
└── tests/            ← unit + integration test suites
```