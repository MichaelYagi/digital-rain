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
globalThis.requestAnimationFrame = (cb) => { cb(performance.now()); return ++_raf; };
globalThis.cancelAnimationFrame  = () => {};

HTMLCanvasElement.prototype.transferControlToOffscreen = function () {
    return new OffscreenCanvas(this.width, this.height);
};

// Mock getContext so _parseCSSColor doesn't throw in jsdom (no canvas package).
// fillStyle always returns '#000000' which means unrecognised colors fall back
// to the theme default — acceptable for unit tests.
const _origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') {
        return {
            fillStyle: '#000000',
            fillRect:  () => {},
            fillText:  () => {},
            clearRect: () => {},
        };
    }
    return _origGetContext ? _origGetContext.call(this, type) : null;
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
            'fadeOutDuration','on',
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
        expect(() => rain._resolveTheme({ theme: 'hsl(200,100%,50%)', glowColor: null })).not.toThrow();
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
        // burst must be unchanged regardless of glowColor
        expect(over.themeColors.burst).toEqual(base.themeColors.burst);
        // themeColors object must be a new object (not the same reference)
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
        for (const t of ['init','start','stop','pause','resume','configure','triggerBurst','resize','getStats']) {
            expect(src, `worker missing: case '${t}'`).toContain(`case '${t}'`);
        }
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
});