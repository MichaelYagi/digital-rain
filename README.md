# digital-rain

Digital rain with concentric ripple burst effects.
No dependencies. Single file.

---

## Setup

```html
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
Any content inside the container with a lower z-index will be covered by the rain.

```html
<!-- Rain covers the text inside the same container -->
<div id="rain" style="position:relative;">
    <p style="position:relative; z-index:1;">This text is under the rain.</p>
</div>
```

---

## Options

```js
new DigitalRain('#container', {

    // When to start
    startDelay:       0,     // seconds before rain begins (default: 0)

    // Bursts
    burst:            true,  // enable/disable ripple bursts (default: true)
    burstDurationMin: 3,     // seconds — how long each burst lasts
    burstDurationMax: 7,
    burstIntervalMin: 120,   // seconds between bursts
    burstIntervalMax: 300,
    burstFirstMin:    30,    // seconds before the first burst fires
    burstFirstMax:    90,

})
```

All other options (font size, speed, trail length, ripple shape) have
sensible defaults and rarely need changing. Full list in `digital-rain.js`
under `static get DEFAULTS()`.

---

## API

```js
const rain = new DigitalRain('#el', options);

rain.start()             // start (respects startDelay)
rain.stop()              // stop and remove canvas
rain.destroy()           // alias for stop()
rain.triggerBurst(col?)  // fire a burst now (optional column index)
rain.configure(options)  // update options live
```

---

## Examples

### Full screen, start immediately
```js
const rain = new DigitalRain('#container');
rain.start();
```

### Delayed start, no bursts
```js
const rain = new DigitalRain('#container', {
    startDelay: 10,
    burst: false,
});
rain.start();
```

### Frequent bursts (testing)
```js
const rain = new DigitalRain('#container', {
    burstFirstMin:    3,
    burstFirstMax:    5,
    burstIntervalMin: 5,
    burstIntervalMax: 10,
});
rain.start();
```

### Click to burst at that position
```js
const rain = new DigitalRain('#container');
rain.start();
document.querySelector('#container').addEventListener('click', e => {
    const col = Math.floor(e.offsetX / 14); // 14 = default fontSize
    rain.triggerBurst(col);
});
```

### Stop and restart
```js
rain.stop();
setTimeout(() => rain.start(), 3000);
```

---

## Files

```
digital-rain/
├── digital-rain.js   ← library (no dependencies)
├── demo.html        ← working demo
└── README.md
```
