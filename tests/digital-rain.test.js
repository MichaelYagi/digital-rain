/**
 * @vitest-environment jsdom
 *
 * tests/digital-rain.test.js
 * Unit tests for DigitalRain. All browser mocks are inlined below.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mocks (must run before library is loaded) ─────────────────────────────────

class OffscreenCanvas {
    constructor(w, h) { this.width = w; this.height = h; }
    getContext() {
        return { fillStyle: '', font: '', fillRect: () => {}, fillText: () => {}, clearRect: () => {} };
    }
}
globalThis.OffscreenCanvas = OffscreenCanvas;

class MockWorker {
    constructor() { this.messages = []; this.onmessage = null; this.terminated = false; }
    postMessage(msg) { this.messages.push(msg); }
    terminate()      { this.terminated = true; }
    _reply(data)     { if (this.onmessage) this.onmessage({ data }); }
}
globalThis.Worker = MockWorker;

globalThis.URL.createObjectURL = () => 'blob:mock';
globalThis.URL.revokeObjectURL = () => {};

let _raf = 0;
const _rafTimers = new Map();
globalThis.requestAnimationFrame = (cb) => { const id = ++_raf; _rafTimers.set(id, setTimeout(() => { _rafTimers.delete(id); cb(performance.now()); }, 16)); return id; };
globalThis.cancelAnimationFrame  = (id) => { clearTimeout(_rafTimers.get(id)); _rafTimers.delete(id); };

HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    return new OffscreenCanvas(this.width, this.height);
};

// jsdom throws on getContext — mock it so _parseCSSColor doesn't crash.
// fillStyle is always '#000000' so HSL/hex colors fall back to the theme
// default, which is expected and handled by the warn suppression in tests.
HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') return { fillStyle: '#000000', fillRect: () => {}, fillText: () => {}, clearRect: () => {} };
    return null;
};

const _gcs = window.getComputedStyle.bind(window);
window.getComputedStyle = (el) => new Proxy(_gcs(el), {
    get(t, p) {
        if (p === 'position') return 'relative';
        return typeof t[p] === 'function' ? t[p].bind(t) : t[p];
    }
});

// ── Load library into global scope ────────────────────────────────────────────
const _libPath = resolve(dirname(new URL(import.meta.url).pathname), '../digital-rain.js');
const _src = readFileSync(_libPath, 'utf8');
new Function(_src + '\nglobalThis.DigitalRain = DigitalRain;')();
const { DigitalRain } = globalThis;

// ── Helpers ───────────────────────────────────────────────────────────────────
let _containers = [];

function makeEl() {
    const el = document.createElement('div');
    el.style.cssText = 'width:800px;height:600px;';
    document.body.appendChild(el);
    _containers.push(el);
    return el;
}

function makeRain(opts = {}) {
    return new DigitalRain(makeEl(), opts);
}

afterEach(() => {
    // Clean up all containers and stop any running instances
    for (const el of _containers) {
        const inst = DigitalRain._registry.get(el);
        if (inst) try { inst.destroy(); } catch(e) {}
        el.remove();
    }
    _containers = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// STATIC API
// ─────────────────────────────────────────────────────────────────────────────
describe('CHARSETS', () => {
    it('has 16 named sets', () => {
        expect(Object.keys(DigitalRain.CHARSETS)).toHaveLength(16);
    });

    it('contains expected keys', () => {
        const keys = Object.keys(DigitalRain.CHARSETS);
        for (const k of ['katakana','hiragana','binary','hex','latin','greek',
            'russian','runic','hangul','arabic','braille','box','math',
            'symbols','blocks','emoticons']) {
            expect(keys).toContain(k);
        }
    });

    it('every value is a non-empty string', () => {
        for (const [k, v] of Object.entries(DigitalRain.CHARSETS)) {
            expect(typeof v, k).toBe('string');
            expect(v.length, k).toBeGreaterThan(0);
        }
    });
});

describe('DEFAULTS', () => {
    it('contains all expected keys', () => {
        const d = DigitalRain.DEFAULTS;
        for (const key of [
            'startDelay','fontSize','bgColor','glowAlpha','fontFamily','chars',
            'dropSpeed','speedTiers','dualFrequency','dualMinGap',
            'trailLengthFast','trailLengthSlow',
            'burst','burstDurationMin','burstDurationMax',
            'burstIntervalMin','burstIntervalMax',
            'burstFirstMin','burstFirstMax',
            'burstWidth','burstReach','burstAngle',
            'tapToBurst','hideChildren','introDepth','introSpeed',
            'theme','glowColor','opacity','density','direction',
            'fadeOutDuration','on','layers','smartThrottle','throttleTarget',
        ]) {
            expect(d, `missing: ${key}`).toHaveProperty(key);
        }
    });

    it('speedTiers is array of 4 objects with frameSkip + weight', () => {
        const tiers = DigitalRain.DEFAULTS.speedTiers;
        expect(Array.isArray(tiers)).toBe(true);
        expect(tiers).toHaveLength(4);
        for (const t of tiers) {
            expect(typeof t.frameSkip).toBe('number');
            expect(typeof t.weight).toBe('number');
        }
    });

    it('density default is 100', () => {
        expect(DigitalRain.DEFAULTS.density).toBe(100);
    });

    it('burst default is true', () => {
        expect(DigitalRain.DEFAULTS.burst).toBe(true);
    });

    it('layers default is null', () => {
        expect(DigitalRain.DEFAULTS.layers).toBeNull();
    });
});

describe('OPTIONS', () => {
    it('every key exists in DEFAULTS', () => {
        const defaultKeys = Object.keys(DigitalRain.DEFAULTS);
        for (const k of Object.keys(DigitalRain.OPTIONS)) {
            expect(defaultKeys, `OPTIONS key "${k}" missing from DEFAULTS`).toContain(k);
        }
    });

    it('every entry has type, default, description', () => {
        for (const [k, v] of Object.entries(DigitalRain.OPTIONS)) {
            expect(typeof v.type,        k).toBe('string');
            expect(v.default,            k).toBeDefined();
            expect(typeof v.description, k).toBe('string');
        }
    });
});

describe('getInstance', () => {
    it('returns null when no instance registered', () => {
        expect(DigitalRain.getInstance(makeEl())).toBeNull();
    });

    it('returns instance after construction', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        expect(DigitalRain.getInstance(el)).toBe(rain);
    });

    it('accepts a CSS selector string', () => {
        const el = makeEl();
        el.id    = 'dr-test-' + Math.random().toString(36).slice(2);
        const rain = new DigitalRain(el);
        expect(DigitalRain.getInstance('#' + el.id)).toBe(rain);
    });

    it('returns null after destroy()', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        rain.destroy();
        expect(DigitalRain.getInstance(el)).toBeNull();
    });
});

describe('help()', () => {
    it('does not throw', () => {
        expect(() => DigitalRain.help()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTOR
// ─────────────────────────────────────────────────────────────────────────────
describe('constructor', () => {
    it('throws for missing selector', () => {
        expect(() => new DigitalRain('#no-such-element')).toThrow('element not found');
    });

    it('accepts a DOM element', () => {
        expect(() => new DigitalRain(makeEl())).not.toThrow();
    });

    it('accepts a CSS selector', () => {
        const el = makeEl();
        el.id = 'ctor-test';
        expect(() => new DigitalRain('#ctor-test')).not.toThrow();
    });

    it('merges options with DEFAULTS', () => {
        const rain = makeRain({ theme: 'red', dropSpeed: 50 });
        const cfg  = rain.getConfig();
        expect(cfg.theme).toBe('red');
        expect(cfg.dropSpeed).toBe(50);
        expect(cfg.fontSize).toBe(DigitalRain.DEFAULTS.fontSize);
    });

    it('registers in _registry immediately', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        expect(DigitalRain._registry.get(el)).toBe(rain);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// LAYERS
// ─────────────────────────────────────────────────────────────────────────────
describe('layers', () => {
    it('_layers is null when layers option is not set', () => {
        expect(makeRain()._layers).toBeNull();
    });

    it('_layers is null when layers is null explicitly', () => {
        expect(makeRain({ layers: null })._layers).toBeNull();
    });

    it('creates one child instance per layer config', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        expect(rain._layers).toHaveLength(3);
    });

    it('each layer is a DigitalRain instance', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        for (const l of rain._layers) {
            expect(l).toBeInstanceOf(DigitalRain);
        }
    });

    it('layer configs are applied per-layer', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 22 }] });
        expect(rain._layers[0].getConfig().fontSize).toBe(9);
        expect(rain._layers[1].getConfig().fontSize).toBe(22);
    });

    it('getLayer() returns correct layer by index', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        expect(rain.getLayer(0).getConfig().fontSize).toBe(9);
        expect(rain.getLayer(1).getConfig().fontSize).toBe(14);
        expect(rain.getLayer(2).getConfig().fontSize).toBe(22);
    });

    it('getLayer() returns null when no layers', () => {
        expect(makeRain().getLayer(0)).toBeNull();
    });

    it('getLayer() returns null for out-of-bounds index', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }] });
        expect(rain.getLayer(5)).toBeNull();
    });

    it('start() starts all layers', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        rain.start();
        expect(rain._layers.every(l => l.isRunning())).toBe(true);
    });

    it('stop() stops all layers', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        rain.start();
        rain.stop();
        expect(rain._layers.every(l => !l.isRunning())).toBe(true);
    });

    it('isRunning() true if any layer is running', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        rain.start();
        expect(rain.isRunning()).toBe(true);
    });

    it('isPaused() true only when all layers are paused', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        rain.start();
        rain.pause();
        expect(rain.isPaused()).toBe(true);
    });

    it('each layer wrapper div has ascending z-index', () => {
        const el = makeEl();
        const rain = new DigitalRain(el, { layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        const wrappers = Array.from(el.querySelectorAll(':scope > div'));
        expect(wrappers[0].style.zIndex).toBe('10');
        expect(wrappers[1].style.zIndex).toBe('11');
        expect(wrappers[2].style.zIndex).toBe('12');
    });

    it('configure() applies to all layers', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        rain.configure({ dropSpeed: 42 });
        for (const l of rain._layers) {
            expect(l.getConfig().dropSpeed).toBe(42);
        }
    });

    it('destroy() removes all layer wrapper divs', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el, { layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
        rain.destroy();
        expect(el.querySelectorAll(':scope > div').length).toBe(0);
    });

    it('single-layer array works without error', () => {
        expect(() => makeRain({ layers: [{ fontSize: 14 }] })).not.toThrow();
    });

    it('layer children receive _sharedRaf:true in their config', () => {
        const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        for (const l of rain._layers) {
            expect(l._cfg._sharedRaf).toBe(true);
        }
    });
});

it('direction is enforced from parent — layer direction override is ignored', () => {
    const rain = makeRain({ direction: 'up', layers: [{ fontSize: 9, direction: 'down' }, { fontSize: 14 }] });
    // All layers must have the parent direction regardless of per-layer override
    for (const l of rain._layers) {
        expect(l.getConfig().direction).toBe('up');
    }
});

it('configure({direction}) propagates to all layers', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.configure({ direction: 'up' });
    for (const l of rain._layers) {
        expect(l.getConfig().direction).toBe('up');
    }
});

it('startDelay is not passed to individual layers', () => {
    const rain = makeRain({ startDelay: 5, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    for (const l of rain._layers) {
        expect(l.getConfig().startDelay).toBe(0);
    }
});

it('fadeOutDuration is not passed to individual layers', () => {
    const rain = makeRain({ fadeOutDuration: 2, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    for (const l of rain._layers) {
        expect(l.getConfig().fadeOutDuration).toBe(0);
    }
});

it('tapToBurst is not passed to individual layers', () => {
    const rain = makeRain({ tapToBurst: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    for (const l of rain._layers) {
        expect(l.getConfig().tapToBurst).toBe(false);
    }
});

it('configure() strips container-level keys before passing to layers', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    // fadeOutDuration should not leak into layers via configure
    rain.configure({ fadeOutDuration: 3, dropSpeed: 50 });
    for (const l of rain._layers) {
        expect(l.getConfig().fadeOutDuration).toBe(0);
        expect(l.getConfig().dropSpeed).toBe(50);
    }
});

it('configure({bgColor}) propagates to all layers', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.configure({ bgColor: '#ff0000' });
    for (const l of rain._layers) {
        expect(l.getConfig().bgColor).toBe('#ff0000');
    }
});

it('on() registers on parent — not delegated to child layers', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    let fired = false;
    rain.on('stop', () => { fired = true; });
    // Child layers should NOT have the callback
    for (const l of rain._layers) {
        expect(l._cfg.on && l._cfg.on.stop).toBeUndefined();
    }
    // Parent should have it
    expect(typeof rain._cfg.on.stop).toBe('function');
});

it('pause() emits pause event from parent in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    let fired = false;
    rain.on('pause', () => { fired = true; });
    rain.pause();
    expect(fired).toBe(true);
});

it('resume() emits resume event from parent in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    rain.pause();
    let fired = false;
    rain.on('resume', () => { fired = true; });
    rain.resume();
    expect(fired).toBe(true);
});

it('randomize() makes all layers use the same direction', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
    const { warn } = console;
    console.warn = () => {};
    for (let i = 0; i < 10; i++) {
        rain.randomize();
        const dirs = rain._layers.map(l => l.getConfig().direction);
        // All layers must have the same direction
        expect(new Set(dirs).size).toBe(1);
    }
    console.warn = warn;
});

it('randomize() updates parent _cfg.direction in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
    const { warn } = console;
    console.warn = () => {};
    rain.randomize();
    // Parent's direction must match all layers
    const layerDir = rain._layers[0].getConfig().direction;
    expect(rain._cfg.direction).toBe(layerDir);
    console.warn = warn;
});

it('randomize() direction override is respected in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
    const { warn } = console;
    console.warn = () => {};
    for (let i = 0; i < 5; i++) {
        rain.randomize({ direction: 'up' });
        for (const l of rain._layers) {
            expect(l.getConfig().direction).toBe('up');
        }
        expect(rain._cfg.direction).toBe('up');
    }
    console.warn = warn;
});

it('stop() then start() works correctly in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    rain.stop();
    expect(rain.isRunning()).toBe(false);
    rain.start();
    expect(rain.isRunning()).toBe(true);
    expect(rain._layers.every(l => l.isRunning())).toBe(true);
});

it('configure({tapToBurst:true}) does not throw in layers mode', () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    expect(() => rain.configure({ tapToBurst: true })).not.toThrow();
    expect(rain.getConfig().tapToBurst).toBe(true);
});

it('configure({tapToBurst:false}) does not throw in layers mode', () => {
    const rain = makeRain({ tapToBurst: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    expect(() => rain.configure({ tapToBurst: false })).not.toThrow();
    expect(rain.getConfig().tapToBurst).toBe(false);
});

it('getStats() resolves via middle layer when in layers mode', async () => {
    const rain = makeRain({ layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }] });
    const stats = await rain.getStats();
    expect(stats).toHaveProperty('frame');
    expect(stats).toHaveProperty('columns');
});

it('hideChildren: true sets container backgroundColor on start', () => {
    const el    = makeEl();
    const child = document.createElement('p');
    el.appendChild(child);
    const rain  = new DigitalRain(el, { hideChildren: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    expect(el.style.backgroundColor).toBeTruthy();
    expect(child.style.visibility).toBe('hidden');
});

it('hideChildren: true clears container backgroundColor on stop', () => {
    const el    = makeEl();
    const child = document.createElement('p');
    el.appendChild(child);
    const rain  = new DigitalRain(el, { hideChildren: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    rain.stop();
    expect(el.style.backgroundColor).toBe('');
    expect(child.style.visibility).toBe('');
});

it('hideChildren only hides pre-existing children, not layer wrappers', () => {
    const el    = makeEl();
    const child = document.createElement('p');
    el.appendChild(child);
    const rain  = new DigitalRain(el, { hideChildren: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    // Pre-existing child should be hidden after start()
    expect(child.style.visibility).toBe('hidden');
    // Wrapper divs should not be hidden
    const wrappers = Array.from(el.querySelectorAll(':scope > div[data-drain-wrapper]'));
    for (const w of wrappers) {
        expect(w.style.visibility).not.toBe('hidden');
    }
});

it('hideChildren restores pre-existing children on stop in layers mode', () => {
    const el    = makeEl();
    const child = document.createElement('p');
    el.appendChild(child);
    const rain  = new DigitalRain(el, { hideChildren: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
    rain.start();
    expect(child.style.visibility).toBe('hidden');
    rain.stop();
    expect(child.style.visibility).toBe('');
});

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────
describe('lifecycle', () => {
    it('isRunning() false before start', () => {
        expect(makeRain().isRunning()).toBe(false);
    });

    it('isRunning() true after start()', () => {
        const rain = makeRain();
        rain.start();
        expect(rain.isRunning()).toBe(true);
    });

    it('start() is no-op if already running', () => {
        const rain = makeRain();
        rain.start();
        const w = rain._worker;
        rain.start();
        expect(rain._worker).toBe(w); // same worker, not recreated
    });

    it('isRunning() false after stop()', () => {
        const rain = makeRain();
        rain.start();
        rain.stop();
        expect(rain.isRunning()).toBe(false);
    });

    it('stop() is no-op if not running', () => {
        expect(() => makeRain().stop()).not.toThrow();
    });

    it('isPaused() false initially', () => {
        const rain = makeRain();
        rain.start();
        expect(rain.isPaused()).toBe(false);
    });

    it('isPaused() true after pause()', () => {
        const rain = makeRain();
        rain.start();
        rain.pause();
        expect(rain.isPaused()).toBe(true);
    });

    it('isPaused() false after resume()', () => {
        const rain = makeRain();
        rain.start();
        rain.pause();
        rain.resume();
        expect(rain.isPaused()).toBe(false);
    });

    it('pause() no-op if not running', () => {
        const rain = makeRain();
        expect(() => rain.pause()).not.toThrow();
        expect(rain.isPaused()).toBe(false);
    });

    it('pause() no-op if already paused', () => {
        const rain = makeRain();
        rain.start();
        rain.pause();
        rain.pause();
        expect(rain.isPaused()).toBe(true);
    });

    it('resume() starts if not running', () => {
        const rain = makeRain();
        rain.resume();
        expect(rain.isRunning()).toBe(true);
    });

    it('destroy() stops and removes from registry', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        rain.start();
        rain.destroy();
        expect(rain.isRunning()).toBe(false);
        expect(DigitalRain.getInstance(el)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER COMMUNICATION
// ─────────────────────────────────────────────────────────────────────────────
describe('worker communication', () => {
    it('start() creates a Worker and posts init then start', () => {
        const rain = makeRain();
        rain.start();
        const types = rain._worker.messages.map(m => m.type);
        expect(types).toContain('init');
        expect(types).toContain('start');
        expect(types.indexOf('init')).toBeLessThan(types.indexOf('start'));
    });

    it('init payload includes canvas, cfg, greenLUT, themeColors', () => {
        const rain = makeRain();
        rain.start();
        const { payload } = rain._worker.messages.find(m => m.type === 'init');
        expect(payload.canvas).toBeDefined();
        expect(payload.cfg).toBeDefined();
        expect(payload.cfg.greenLUT).toBeDefined();
        expect(payload.cfg.themeColors).toBeDefined();
    });

    it('init cfg does not include on callbacks', () => {
        const rain = makeRain({ on: { start: () => {} } });
        rain.start();
        const { payload } = rain._worker.messages.find(m => m.type === 'init');
        expect(payload.cfg.on).toBeUndefined();
    });

    it('stop() terminates the worker', () => {
        const rain   = makeRain();
        rain.start();
        const worker = rain._worker;
        rain.stop();
        expect(worker.terminated).toBe(true);
    });

    it('stop() nulls the worker reference', () => {
        const rain = makeRain();
        rain.start();
        rain.stop();
        expect(rain._worker).toBeNull();
    });

    it('pause() posts pause to worker', () => {
        const rain = makeRain();
        rain.start();
        rain.pause();
        expect(rain._worker.messages.map(m => m.type)).toContain('pause');
    });

    it('resume() posts resume to worker', () => {
        const rain = makeRain();
        rain.start();
        rain.pause();
        rain.resume();
        expect(rain._worker.messages.map(m => m.type)).toContain('resume');
    });

    it('triggerBurst(col) posts triggerBurst with col', () => {
        const rain = makeRain();
        rain.start();
        rain.triggerBurst(7);
        const msg = rain._worker.messages.find(m => m.type === 'triggerBurst');
        expect(msg.payload.col).toBe(7);
    });

    it('triggerBurst() with no arg sends col:null', () => {
        const rain = makeRain();
        rain.start();
        rain.triggerBurst();
        const msg = rain._worker.messages.find(m => m.type === 'triggerBurst');
        expect(msg.payload.col).toBeNull();
    });

    it('configure() posts configure with resolved theme data', () => {
        const rain = makeRain();
        rain.start();
        rain.configure({ dropSpeed: 50 });
        const msg = rain._worker.messages.find(m => m.type === 'configure');
        expect(msg.payload.dropSpeed).toBe(50);
        expect(msg.payload.greenLUT).toBeDefined();
        expect(msg.payload.themeColors).toBeDefined();
    });

    it('configure() does not post when worker not running', () => {
        const rain = makeRain();
        rain.configure({ dropSpeed: 50 }); // no worker yet
        expect(rain._worker).toBeNull();   // should not throw
    });

    it('configure() updates opacity on canvas immediately', () => {
        const rain = makeRain();
        rain.start();
        rain.configure({ opacity: 0.4 });
        expect(rain._canvas.style.opacity).toBe('0.4');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('getConfig()', () => {
    it('returns a plain object', () => {
        expect(typeof makeRain().getConfig()).toBe('object');
    });

    it('excludes on callbacks', () => {
        expect(makeRain({ on: { start: () => {} } }).getConfig().on).toBeUndefined();
    });

    it('is a clone — external mutations do not affect internal state', () => {
        const rain = makeRain({ dropSpeed: 80 });
        rain.getConfig().dropSpeed = 1;
        expect(rain.getConfig().dropSpeed).toBe(80);
    });

    it('reflects constructor options', () => {
        const cfg = makeRain({ theme: 'blue', density: 60 }).getConfig();
        expect(cfg.theme).toBe('blue');
        expect(cfg.density).toBe(60);
    });

    it('reflects configure() changes', () => {
        const rain = makeRain();
        rain.configure({ dropSpeed: 42 });
        expect(rain.getConfig().dropSpeed).toBe(42);
    });

    it('returns original user values when throttle has reduced density', () => {
        const rain = makeRain({ density: 100, smartThrottle: true });
        // Simulate throttle reducing density
        rain._throttleCfg = { density: 100, trailLengthSlow: 70, dualFrequency: 50 };
        rain._cfg.density = 60; // throttle reduced it
        expect(rain.getConfig().density).toBe(100); // getConfig returns original
    });

    it('getLiveConfig returns actual running values including throttle reductions', () => {
        const rain = makeRain({ density: 100, smartThrottle: true });
        rain._throttleCfg = { density: 100, trailLengthSlow: 70, dualFrequency: 50 };
        rain._cfg.density = 60;
        expect(rain.getLiveConfig().density).toBe(60); // getLiveConfig returns reduced value
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStats
// ─────────────────────────────────────────────────────────────────────────────
describe('getStats()', () => {
    it('returns a Promise', () => {
        expect(makeRain().getStats()).toBeInstanceOf(Promise);
    });

    it('resolves immediately with zero stats when no worker', async () => {
        const stats = await makeRain().getStats();
        expect(stats.frame).toBe(0);
        expect(stats.columns).toBe(0);
        expect(stats.burstActive).toBe(false);
        expect(stats.burstEpicenter).toBe(-1);
    });

    it('resolves via worker reply with correct values', async () => {
        const rain = makeRain();
        rain.start();
        const promise = rain.getStats();
        const { payload: { id } } = rain._worker.messages.find(m => m.type === 'getStats');
        rain._worker._reply({ type: 'stats', payload: {
                id, frame: 99, fps: 60, columns: 80, activeColumns: 80,
                dormantColumns: 0, streams: 120,
                burstActive: true, burstEpicenter: 40, paused: false, booting: false,
            }});
        const stats = await promise;
        expect(stats.frame).toBe(99);
        expect(stats.fps).toBe(60);
        expect(stats.burstActive).toBe(true);
        expect(stats.burstEpicenter).toBe(40);
    });

    it('handles multiple in-flight getStats calls independently', async () => {
        const rain = makeRain();
        rain.start();
        const p1 = rain.getStats();
        const p2 = rain.getStats();
        const msgs = rain._worker.messages.filter(m => m.type === 'getStats');
        expect(msgs).toHaveLength(2);
        // Reply in reverse order
        rain._worker._reply({ type: 'stats', payload: { ...msgs[1].payload, frame: 200 }});
        rain._worker._reply({ type: 'stats', payload: { ...msgs[0].payload, frame: 100 }});
        const [s1, s2] = await Promise.all([p1, p2]);
        expect(s1.frame).toBe(100);
        expect(s2.frame).toBe(200);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS
// ─────────────────────────────────────────────────────────────────────────────
describe('event system', () => {
    it('on() returns this for chaining', () => {
        const rain = makeRain();
        expect(rain.on('start', () => {})).toBe(rain);
    });

    it('fires start event from worker reply', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { start: cb } });
        rain.start();
        rain._worker._reply({ type: 'event', payload: { name: 'start' } });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires stop event on unmount', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { stop: cb } });
        rain.start();
        rain.stop();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires pause event on pause()', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { pause: cb } });
        rain.start();
        rain.pause();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires resume event on resume()', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { resume: cb } });
        rain.start();
        rain.pause();
        rain.resume();
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires burstStart with epicenter data', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { burstStart: cb } });
        rain.start();
        rain._worker._reply({ type: 'event', payload: { name: 'burstStart', data: { epicenter: 33 } } });
        expect(cb).toHaveBeenCalledWith({ epicenter: 33 });
    });

    it('fires burstEnd event', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { burstEnd: cb } });
        rain.start();
        rain._worker._reply({ type: 'event', payload: { name: 'burstEnd' } });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('fires introComplete event', () => {
        const cb   = vi.fn();
        const rain = makeRain({ on: { introComplete: cb } });
        rain.start();
        rain._worker._reply({ type: 'event', payload: { name: 'introComplete' } });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('on() fluent registration fires correctly', () => {
        const cb   = vi.fn();
        const rain = makeRain();
        rain.on('burstEnd', cb);
        rain.start();
        rain._worker._reply({ type: 'event', payload: { name: 'burstEnd' } });
        expect(cb).toHaveBeenCalledTimes(1);
    });

    it('callback errors are swallowed gracefully', () => {
        const rain = makeRain({ on: { start: () => { throw new Error('boom'); } } });
        rain.start();
        expect(() => rain._worker._reply({ type: 'event', payload: { name: 'start' } })).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// _resolveTheme
// ─────────────────────────────────────────────────────────────────────────────
describe('_resolveTheme()', () => {
    let rain;
    beforeEach(() => { rain = makeRain(); });

    for (const theme of ['green', 'red', 'blue', 'white', 'amber']) {
        it(`named theme '${theme}' — valid greenLUT and themeColors`, () => {
            const { greenLUT, themeColors } = rain._resolveTheme({ theme, glowColor: null });
            expect(greenLUT).toHaveLength(256);
            expect(typeof greenLUT[0]).toBe('string');
            expect(themeColors.head).toMatch(/^#[0-9a-f]{6}$/i);
            expect(themeColors.glow).toMatch(/^rgba\(/);
            expect(themeColors.burst).toHaveLength(3);
        });
    }

    it('greenLUT[0] is darkest for green theme', () => {
        const { greenLUT } = rain._resolveTheme({ theme: 'green', glowColor: null });
        expect(greenLUT[0]).toBe('rgb(0,0,0)');
    });

    it('greenLUT[255] is brightest for green theme', () => {
        const { greenLUT } = rain._resolveTheme({ theme: 'green', glowColor: null });
        expect(greenLUT[255]).toBe('rgb(0,255,0)');
    });

    it('hex theme produces valid burst RGB array', () => {
        const { themeColors } = rain._resolveTheme({ theme: '#ff0080', glowColor: null });
        expect(Array.isArray(themeColors.burst)).toBe(true);
        expect(themeColors.burst).toHaveLength(3);
        themeColors.burst.forEach(v => {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
        });
    });

    it('HSL theme resolves without throwing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(() => rain._resolveTheme({ theme: 'hsl(200,100%,50%)', glowColor: null })).not.toThrow();
        warn.mockRestore();
    });

    it('unrecognised theme warns and falls back to green', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { themeColors } = rain._resolveTheme({ theme: 'notacolour__', glowColor: null });
        expect(warn).toHaveBeenCalled();
        expect(themeColors.head).toBe('#00ff41');
        warn.mockRestore();
    });

    it('glowColor does not affect burst colors', () => {
        const base = rain._resolveTheme({ theme: 'green', glowColor: null });
        const over = rain._resolveTheme({ theme: 'green', glowColor: '#ff0000' });
        expect(over.themeColors.burst).toEqual(base.themeColors.burst);
        expect(over.themeColors).not.toBe(base.themeColors);
    });

    it('invalid glowColor warns and keeps theme glow', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const base = rain._resolveTheme({ theme: 'green', glowColor: null });
        const over = rain._resolveTheme({ theme: 'green', glowColor: 'notacolour__' });
        expect(warn).toHaveBeenCalled();
        expect(over.themeColors.head).toBe(base.themeColors.head);
        warn.mockRestore();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// randomize()
// ─────────────────────────────────────────────────────────────────────────────
describe('randomize()', () => {
    // jsdom fillStyle doesn't parse HSL/hex — suppress expected warns, not real failures
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns an object with expected keys', () => {
        const rain = makeRain();
        const p    = rain.randomize();
        for (const k of ['theme','chars','opacity','burst','tapToBurst',
            'direction','dualFrequency','trailLengthFast','trailLengthSlow',
            'burstDurationMin','burstDurationMax','burstIntervalMin','burstIntervalMax']) {
            expect(p, `missing key: ${k}`).toHaveProperty(k);
        }
    });

    it('always sets burst:true and tapToBurst:true', () => {
        const rain = makeRain();
        for (let i = 0; i < 15; i++) {
            const p = rain.randomize();
            expect(p.burst).toBe(true);
            expect(p.tapToBurst).toBe(true);
        }
    });

    it('trailLengthSlow >= trailLengthFast always', () => {
        const rain = makeRain();
        for (let i = 0; i < 20; i++) {
            const p = rain.randomize();
            expect(p.trailLengthSlow).toBeGreaterThanOrEqual(p.trailLengthFast);
        }
    });

    it('burstDurationMax >= burstDurationMin always', () => {
        const rain = makeRain();
        for (let i = 0; i < 20; i++) {
            const p = rain.randomize();
            expect(p.burstDurationMax).toBeGreaterThanOrEqual(p.burstDurationMin);
        }
    });

    it('burstIntervalMax >= burstIntervalMin always', () => {
        const rain = makeRain();
        for (let i = 0; i < 20; i++) {
            const p = rain.randomize();
            expect(p.burstIntervalMax).toBeGreaterThanOrEqual(p.burstIntervalMin);
        }
    });

    it('opacity is in [0.5, 1.0]', () => {
        const rain = makeRain();
        for (let i = 0; i < 20; i++) {
            const { opacity } = rain.randomize();
            expect(opacity).toBeGreaterThanOrEqual(0.5);
            expect(opacity).toBeLessThanOrEqual(1.0);
        }
    });

    it('chars is always from DigitalRain.CHARSETS', () => {
        const rain    = makeRain();
        const valid   = new Set(Object.values(DigitalRain.CHARSETS));
        for (let i = 0; i < 20; i++) {
            expect(valid.has(rain.randomize().chars)).toBe(true);
        }
    });

    it('theme is always an HSL string', () => {
        const rain = makeRain();
        for (let i = 0; i < 15; i++) {
            expect(rain.randomize().theme).toMatch(/^hsl\(\d+,100%,55%\)$/);
        }
    });

    it('direction is always down or up', () => {
        const rain = makeRain();
        for (let i = 0; i < 20; i++) {
            expect(['down','up']).toContain(rain.randomize().direction);
        }
    });

    it('hideChildren is always false', () => {
        const rain = makeRain();
        for (let i = 0; i < 10; i++) {
            expect(rain.randomize().hideChildren).toBe(false);
        }
    });

    it('overrides are applied', () => {
        const rain = makeRain();
        const p    = rain.randomize({ theme: 'red' });
        expect(p.theme).toBe('red');
    });

    it('updates internal config', () => {
        const rain = makeRain({ theme: 'green' });
        rain.randomize();
        expect(rain.getConfig().theme).toMatch(/^hsl\(/);
    });

    it('returns a new object each call', () => {
        const rain = makeRain();
        expect(rain.randomize()).not.toBe(rain.randomize());
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS / DOM
// ─────────────────────────────────────────────────────────────────────────────
describe('canvas and DOM', () => {
    it('injects canvas into container on start()', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        rain.start();
        expect(rain._canvas).not.toBeNull();
        expect(el.contains(rain._canvas)).toBe(true);
    });

    it('canvas has position:absolute and z-index:9999', () => {
        const rain = makeRain();
        rain.start();
        expect(rain._canvas.style.position).toBe('absolute');
        expect(rain._canvas.style.zIndex).toBe('9999');
    });

    it('canvas has pointerEvents:none by default', () => {
        const rain = makeRain({ tapToBurst: false });
        rain.start();
        expect(rain._canvas.style.pointerEvents).toBe('none');
    });

    it('canvas has pointerEvents:auto with tapToBurst:true', () => {
        const rain = makeRain({ tapToBurst: true });
        rain.start();
        expect(rain._canvas.style.pointerEvents).toBe('auto');
    });

    it('canvas opacity matches config', () => {
        const rain = makeRain({ opacity: 0.7 });
        rain.start();
        expect(rain._canvas.style.opacity).toBe('0.7');
    });

    it('canvas is removed from DOM after stop()', () => {
        const el   = makeEl();
        const rain = new DigitalRain(el);
        rain.start();
        const canvas = rain._canvas;
        rain.stop();
        expect(el.contains(canvas)).toBe(false);
    });

    it('hideChildren hides direct children on start()', () => {
        const el    = makeEl();
        const child = document.createElement('p');
        el.appendChild(child);
        const rain = new DigitalRain(el, { hideChildren: true });
        rain.start();
        expect(child.style.visibility).toBe('hidden');
    });

    it('hideChildren restores children on stop()', () => {
        const el    = makeEl();
        const child = document.createElement('p');
        el.appendChild(child);
        const rain = new DigitalRain(el, { hideChildren: true });
        rain.start();
        rain.stop();
        expect(child.style.visibility).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// startDelay
// ─────────────────────────────────────────────────────────────────────────────
describe('startDelay', () => {
    it('does not mount immediately when startDelay > 0', () => {
        vi.useFakeTimers();
        const rain = makeRain({ startDelay: 5 });
        rain.start();
        expect(rain._canvas).toBeNull();
        vi.useRealTimers();
    });

    it('mounts after delay elapses', () => {
        vi.useFakeTimers();
        const rain = makeRain({ startDelay: 1 });
        rain.start();
        vi.advanceTimersByTime(1100);
        expect(rain._canvas).not.toBeNull();
        vi.useRealTimers();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURAL INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────
describe('library structure', () => {
    const src = readFileSync(_libPath, 'utf8');

    it('embeds worker source as _WORKER_SRC', () => {
        expect(src).toContain('_WORKER_SRC');
    });

    it('uses transferControlToOffscreen', () => {
        expect(src).toContain('transferControlToOffscreen');
    });

    it('worker handles all required message types', () => {
        for (const t of ['init','start','stop','pause','resume','configure','triggerBurst','resize','getStats','tick']) {
            expect(src, `worker missing: case '${t}'`).toContain(`case '${t}'`);
        }
    });

    it('worker has _sharedRaf flag', () => {
        expect(src).toContain('_sharedRaf');
    });

    it('_sharedRafId is initialised in constructor', () => {
        expect(src).toContain('_sharedRafId    = null');
    });

    it('syncTo and unsync are not present', () => {
        expect(src).not.toContain('syncTo(');
        expect(src).not.toContain('unsync()');
    });

    it('has _tierTable performance optimisation', () => {
        expect(src).toContain('_tierTable');
    });

    it('has Gaussian burst falloff LUT', () => {
        expect(src).toContain('_burstFalloffLUT');
    });

    it('has burst boost LUT (whiten formula)', () => {
        expect(src).toContain('_burstBoostLUT');
    });

    it('getStats() returns a Promise', () => {
        expect(src).toContain('return new Promise');
    });

    it('dead mapA/mapB fields are not present', () => {
        expect(src).not.toContain('mapA');
        expect(src).not.toContain('mapB');
    });

    it('_registry is a Map', () => {
        expect(src).toContain('DigitalRain._registry = new Map()');
    });

    it('layers option is in DEFAULTS', () => {
        expect(src).toContain("layers:         null");
    });

    it('getLayer method is present', () => {
        expect(src).toContain('getLayer(');
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// SMART THROTTLE
// ─────────────────────────────────────────────────────────────────────────────
describe('smartThrottle', () => {
    it('smartThrottle default is true', () => {
        expect(DigitalRain.DEFAULTS.smartThrottle).toBe(true);
    });

    it('throttleTarget default is 45', () => {
        expect(DigitalRain.DEFAULTS.throttleTarget).toBe(45);
    });

    it('_throttleTimer is null before start', () => {
        expect(makeRain()._throttleTimer).toBeNull();
    });

    it('_throttleCfg is null before start', () => {
        expect(makeRain()._throttleCfg).toBeNull();
    });

    it('smartThrottle:false — timer never starts', async () => {
        const rain = makeRain({ smartThrottle: false });
        rain.start();
        await new Promise(r => setTimeout(r, 50));
        expect(rain._throttleTimer).toBeNull();
        rain.stop();
    });

    it('configure({smartThrottle:false}) stops timer', () => {
        const rain = makeRain({ smartThrottle: true });
        rain.start();
        rain.configure({ smartThrottle: false });
        expect(rain._throttleTimer).toBeNull();
        rain.stop();
    });

    it('configure() on a throttled key updates _throttleCfg baseline', () => {
        const rain = makeRain({ density: 100, smartThrottle: true });
        // Simulate active throttle
        rain._throttleCfg = { density: 100, trailLengthSlow: 70, dualFrequency: 50 };
        rain._cfg.density = 60; // throttle reduced it
        // User explicitly sets density to 70
        rain.configure({ density: 70 });
        // Baseline should now be 70, not 100
        expect(rain._throttleCfg.density).toBe(70);
    });

    it('configure() on non-throttled key does not affect _throttleCfg', () => {
        const rain = makeRain({ density: 100, smartThrottle: true });
        rain._throttleCfg = { density: 100, trailLengthSlow: 70, dualFrequency: 50 };
        rain.configure({ dropSpeed: 50 });
        expect(rain._throttleCfg.density).toBe(100);
    });

    it('smartThrottle is disabled on child layers — parent manages throttle', () => {
        const rain = makeRain({ smartThrottle: true, layers: [{ fontSize: 9 }, { fontSize: 14 }] });
        for (const l of rain._layers) {
            expect(l.getConfig().smartThrottle).toBe(false);
        }
    });
});