# digital-rain

Digital rain with lightning burst effects, color themes, event callbacks, and live configuration.
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

To hide existing content while the rain runs, use `hideChildren: true` — see options below.

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

    // Character set — any string; each character is used with equal probability
    chars:            'アイウエオカキクケコ...0123456789ABCDEF',

    // Color theme: 'green' | 'red' | 'blue' | 'white' | 'amber' | '#rrggbb' | '#rgb' | any CSS color name
    // Named themes use hand-tuned glow/burst colors.
    // Hex strings and CSS color names ('cyan', 'hotpink', etc.) derive all colors automatically.
    // Unrecognised values log a console warning and fall back to green.
    theme:            'green',

    // ── Speed ─────────────────────────────────────────────────────────────
    dropSpeed:        98,     // 0=frozen, 1=barely moving, 100=fastest

    // Speed tiers — weighted random selection per column.
    // frameSkip: frames between row steps (lower = faster)
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
    burst:            true,   // enable/disable automatic lightning bursts
    burstDurationMin: 3,      // seconds — how long each burst lasts
    burstDurationMax: 7,
    burstIntervalMin: 30,     // seconds between automatic bursts
    burstIntervalMax: 60,
    burstFirstMin:    20,     // seconds before the first burst fires
    burstFirstMax:    40,
    burstWidth:       10,     // row half-width of the bolt (Gaussian falloff)
    burstReach:       140,    // how many columns the bolt extends left/right
    burstAngle:       0.25,   // row drift per column (steepness of the bolt)

    // ── Tap to burst ──────────────────────────────────────────────────────
    tapToBurst:       false,  // click/tap canvas to trigger burst at that position

    // ── Content visibility ────────────────────────────────────────────────
    // When true: hides direct children of the container on start,
    // blacks out the background, and restores children on stop()
    hideChildren:     false,

    // ── Fade out ──────────────────────────────────────────────────────────
    // Seconds to fade the canvas opacity before unmounting on stop()
    // 0 = instant hard cut
    fadeOutDuration:  0,

    // ── Intro sequence ────────────────────────────────────────────────────
    introDepth:       50,     // 0=no intro (all drops start at once),
                              // 50=pioneer drops to halfway, 100=pioneer drops to bottom
    introSpeed:       98,     // speed of the pioneer drop: 0=frozen, 100=fastest
                              // independent of dropSpeed

    // ── Event callbacks ───────────────────────────────────────────────────
    on: {
        start:         () => {},           // rain mounted and running
        stop:          () => {},           // rain fully stopped and unmounted
        pause:         () => {},           // animation frozen (canvas stays)
        resume:        () => {},           // animation unfrozen
        introComplete: () => {},           // pioneer drop finished, full rain begun
        burstStart:    ({ epicenter }) => {}, // burst fired; epicenter = column index
        burstEnd:      () => {},           // burst finished
    },

})
```

---

## API

```js
const rain = new DigitalRain('#el', options);

// ── Lifecycle ─────────────────────────────────────────────────────────────
rain.start()              // mount canvas and begin (respects startDelay)
rain.stop()               // stop, remove canvas, restore children if hideChildren was set
rain.destroy()            // alias for stop()

// ── Playback ──────────────────────────────────────────────────────────────
rain.pause()              // freeze animation in place (canvas stays, state preserved)
rain.resume()             // unfreeze; falls back to start() if not yet running

// ── Configuration ─────────────────────────────────────────────────────────
rain.configure(options)   // update any options live — no restart needed
                          // chars and theme changes take effect immediately

// ── Snapshot ──────────────────────────────────────────────────────────────
const snap = rain.snapshot()   // deep-clone current config
rain.restore(snap)             // apply a previously saved snapshot via configure()

// ── Bursts ────────────────────────────────────────────────────────────────
rain.triggerBurst(col?)   // fire a burst manually (col = column index, omit for random)

// ── Events (fluent alternative to the on: {} option) ──────────────────────
rain.on('burstStart', ({ epicenter }) => console.log(epicenter))
rain.on('introComplete', () => console.log('ready'))
```

---

## Color themes

The `theme` option controls trail color, head glow, and burst flash color together. It accepts either a named theme or any hex color string.

**Named themes**

| Value     | Color |
|-----------|-------|
| `'green'` | Classic matrix green (default) |
| `'red'`   | Deep red with orange glow |
| `'blue'`  | Electric blue |
| `'white'` | Cool white/grey |
| `'amber'` | Warm amber/gold |

**Hex colors**

Any 3- or 6-digit hex string is accepted. The trail LUT, head color, glow, and burst flash are all derived automatically from the parsed RGB values.

```js
rain.configure({ theme: '#ff00ff' });  // magenta
rain.configure({ theme: '#0cf' });     // shorthand cyan
rain.configure({ theme: '#ff6600' });  // orange
```

All theme changes take effect immediately via `configure()` — no restart needed for color alone. Call `stop()`/`start()` if you also want to reset the intro.

Unrecognised values log a console warning and fall back to green.

```js
rain.configure({ theme: 'blue' });
```

---

## Character sets

`chars` accepts any string. Each character is sampled with equal probability.

```js
// Binary
rain.configure({ chars: '01' });

// Latin
rain.configure({ chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' });

// Braille
rain.configure({ chars: '⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟' });

// Custom
rain.configure({ chars: '!@#$%^&*()' });
```

Character set changes take effect immediately without a restart.

---

## Hiding content

When `hideChildren: true`, the library manages visibility of the container's direct children:

- On `start()` — children are hidden (`visibility: hidden`) and the container background is blacked out
- On `stop()` — children are restored to their original visibility

```js
new DigitalRain('#hero', {
    hideChildren: true,
    fadeOutDuration: 1.5,   // fade out before restoring content
}).start();
```

---

## Events

Subscribe via the `on` option at construction or via the fluent `.on()` method at any time.

```js
const rain = new DigitalRain('#el', {
    on: {
        start:         () => console.log('started'),
        stop:          () => console.log('stopped'),
        pause:         () => console.log('paused'),
        resume:        () => console.log('resumed'),
        introComplete: () => console.log('intro done'),
        burstStart:    ({ epicenter }) => console.log('burst at col', epicenter),
        burstEnd:      () => console.log('burst over'),
    }
});

// Or fluently — overwrites the previous handler for that event
rain.on('burstStart', ({ epicenter }) => highlight(epicenter));
```

---

## Snapshot and restore

Save and restore the full configuration state, useful for toggling between two looks.

```js
const rain = new DigitalRain('#el', { theme: 'green', dropSpeed: 98 }).start();

// Save current state
const saved = rain.snapshot();

// Switch to something dramatic
rain.configure({ theme: 'red', dropSpeed: 40 });
rain.stop(); rain.start();

// Restore original later
rain.restore(saved);
rain.stop(); rain.start();
```

---

## Pause and resume

`pause()` freezes the animation in place without destroying the canvas or state.
`resume()` picks up exactly where it left off.

```js
rain.pause();
setTimeout(() => rain.resume(), 5000);
```

`stop()` is a full teardown — canvas is removed, state is reset, children are restored.
Use `pause()`/`resume()` when you want to freeze temporarily; use `stop()`/`start()` when you want a full reset.

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
    dropSpeed: 40,
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

### Dramatic slow intro, then fast rain
```js
new DigitalRain('#container', {
    introDepth: 100,   // pioneer drops all the way to the bottom
    introSpeed: 20,    // crawls down slowly
    dropSpeed:  98,    // main rain is fast
}).start();
```

### Red theme, binary charset, fade on stop
```js
new DigitalRain('#container', {
    theme:           'red',
    chars:           '01',
    fadeOutDuration: 2,
}).start();
```

### Hide page content while rain runs, restore on stop
```js
new DigitalRain('#hero', {
    hideChildren:    true,
    fadeOutDuration: 1,
    on: { stop: () => console.log('content restored') },
}).start();
```

### Live configure without restart
```js
const rain = new DigitalRain('#container').start();

rain.configure({ dropSpeed: 30 });        // slow down
rain.configure({ theme: 'amber' });       // change color
rain.configure({ burst: false });         // kill bursts
rain.configure({ chars: '01' });          // switch charset
```

### Stop and restart
```js
rain.stop();
setTimeout(() => rain.start(), 3000);
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