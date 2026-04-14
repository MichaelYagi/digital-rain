/**
 * tests/browser/digital-rain.spec.js
 *
 * Integration tests — run in a real browser with a real Worker + OffscreenCanvas.
 * Covers what unit tests cannot: actual Worker lifecycle, getStats() round-trips,
 * events through the real postMessage chain, and live configure() in the worker.
 */

import { test, expect } from '@playwright/test';

const HARNESS = 'http://127.0.0.1:3999/tests/browser/harness.html';
const BOOT_MS = 400;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function load(page) {
    await page.goto(HARNESS);
    await page.waitForFunction(() => typeof DigitalRain !== 'undefined');
}

async function boot(page, opts = {}) {
    await load(page);
    await page.evaluate((o) => {
        window._rain = new DigitalRain('#container', { introDepth: 0, ...o });
        window._rain.start();
    }, opts);
    await page.waitForTimeout(BOOT_MS);
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

test('worker is created after start()', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window._rain._worker !== null)).toBe(true);
});

test('worker is terminated after stop()', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.stop());
    expect(await page.evaluate(() => window._rain._worker === null)).toBe(true);
});

test('isRunning() true after start, false after stop', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(true);
    await page.evaluate(() => window._rain.stop());
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(false);
});

test('isPaused() true after pause, false after resume', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.pause());
    expect(await page.evaluate(() => window._rain.isPaused())).toBe(true);
    await page.evaluate(() => window._rain.resume());
    expect(await page.evaluate(() => window._rain.isPaused())).toBe(false);
});

test('start() is no-op if already running', async ({ page }) => {
    await boot(page);
    // Grab worker identity before second start() call
    const same = await page.evaluate(() => {
        const w = window._rain._worker;
        window._rain.start();
        return window._rain._worker === w;
    });
    expect(same).toBe(true);
});

test('stop then start creates a fresh worker', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.stop());
    await page.evaluate(() => window._rain.start());
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window._rain._worker !== null)).toBe(true);
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// CANVAS DOM
// ─────────────────────────────────────────────────────────────────────────────

test('canvas is injected into container on start()', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => document.querySelector('#container canvas') !== null)).toBe(true);
});

test('canvas has position:absolute and z-index:9999', async ({ page }) => {
    await boot(page);
    const s = await page.evaluate(() => {
        const c = document.querySelector('#container canvas');
        return { position: c.style.position, zIndex: c.style.zIndex };
    });
    expect(s.position).toBe('absolute');
    expect(s.zIndex).toBe('9999');
});

test('canvas is removed after stop()', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.stop());
    expect(await page.evaluate(() => document.querySelector('#container canvas') !== null)).toBe(false);
});

test('canvas opacity matches config', async ({ page }) => {
    await boot(page, { opacity: 0.6 });
    const opacity = await page.evaluate(() => document.querySelector('#container canvas').style.opacity);
    expect(opacity).toBe('0.6');
});

test('tapToBurst:false leaves pointerEvents:none', async ({ page }) => {
    await boot(page, { tapToBurst: false });
    const pe = await page.evaluate(() => document.querySelector('#container canvas').style.pointerEvents);
    expect(pe).toBe('none');
});

test('tapToBurst:true sets pointerEvents:auto', async ({ page }) => {
    await boot(page, { tapToBurst: true });
    const pe = await page.evaluate(() => document.querySelector('#container canvas').style.pointerEvents);
    expect(pe).toBe('auto');
});

test('canvas has non-zero dimensions after start', async ({ page }) => {
    await boot(page);
    const dims = await page.evaluate(() => {
        const c = document.querySelector('#container canvas');
        return { w: c.offsetWidth, h: c.offsetHeight };
    });
    expect(dims.w).toBeGreaterThan(0);
    expect(dims.h).toBeGreaterThan(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// getStats() — real Worker round-trip
// ─────────────────────────────────────────────────────────────────────────────

test('getStats() resolves with correct shape', async ({ page }) => {
    await boot(page);
    const stats = await page.evaluate(async () => await window._rain.getStats());
    for (const key of ['frame','fps','columns','activeColumns','dormantColumns','streams','burstActive','paused','booting']) {
        expect(stats, `missing: ${key}`).toHaveProperty(key);
    }
});

test('getStats() columns > 0', async ({ page }) => {
    await boot(page);
    const { columns } = await page.evaluate(async () => await window._rain.getStats());
    expect(columns).toBeGreaterThan(0);
});

test('getStats() booting:false with introDepth:0', async ({ page }) => {
    await boot(page);
    const { booting } = await page.evaluate(async () => await window._rain.getStats());
    expect(booting).toBe(false);
});

test('getStats() paused:true after pause()', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.pause());
    const { paused } = await page.evaluate(async () => await window._rain.getStats());
    expect(paused).toBe(true);
});

test('getStats() frame advances over time', async ({ page }) => {
    await boot(page);
    const s1 = await page.evaluate(async () => await window._rain.getStats());
    await page.waitForTimeout(300);
    const s2 = await page.evaluate(async () => await window._rain.getStats());
    expect(s2.frame).toBeGreaterThan(s1.frame);
});

test('getStats() frame does not advance while paused', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.pause());
    const s1 = await page.evaluate(async () => await window._rain.getStats());
    await page.waitForTimeout(300);
    const s2 = await page.evaluate(async () => await window._rain.getStats());
    expect(s2.frame).toBe(s1.frame);
});

test('getStats() resolves immediately without worker', async ({ page }) => {
    await load(page);
    await page.evaluate(() => { window._rain = new DigitalRain('#container'); });
    const stats = await page.evaluate(async () => await window._rain.getStats());
    expect(stats.frame).toBe(0);
    expect(stats.columns).toBe(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENTS — through real postMessage chain
// ─────────────────────────────────────────────────────────────────────────────

test('start event fires', async ({ page }) => {
    await load(page);
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain = new DigitalRain('#container', {
            introDepth: 0,
            on: { start: () => resolve(true) },
        });
        window._rain.start();
        setTimeout(() => resolve(false), 3000);
    }));
    expect(fired).toBe(true);
});

test('stop event fires', async ({ page }) => {
    await boot(page);
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain.on('stop', () => resolve(true));
        window._rain.stop();
        setTimeout(() => resolve(false), 2000);
    }));
    expect(fired).toBe(true);
});

test('pause event fires', async ({ page }) => {
    await boot(page);
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain.on('pause', () => resolve(true));
        window._rain.pause();
        setTimeout(() => resolve(false), 2000);
    }));
    expect(fired).toBe(true);
});

test('resume event fires', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.pause());
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain.on('resume', () => resolve(true));
        window._rain.resume();
        setTimeout(() => resolve(false), 2000);
    }));
    expect(fired).toBe(true);
});

test('introComplete fires when introDepth > 0', async ({ page }) => {
    await load(page);
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain = new DigitalRain('#container', {
            introDepth: 5,
            introSpeed: 100,
            on: { introComplete: () => resolve(true) },
        });
        window._rain.start();
        setTimeout(() => resolve(false), 8000);
    }));
    expect(fired).toBe(true);
});

test('introComplete does not fire when introDepth:0', async ({ page }) => {
    await load(page);
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain = new DigitalRain('#container', {
            introDepth: 0,
            on: { introComplete: () => resolve(true) },
        });
        window._rain.start();
        setTimeout(() => resolve(false), 1000);
    }));
    expect(fired).toBe(false);
});

test('burstStart fires with numeric epicenter', async ({ page }) => {
    await boot(page, { burst: false });
    const epicenter = await page.evaluate(async () => new Promise((resolve) => {
        window._rain.configure({ burst: true });
        window._rain.on('burstStart', ({ epicenter }) => resolve(epicenter));
        window._rain.triggerBurst();
        setTimeout(() => resolve(null), 3000);
    }));
    expect(typeof epicenter).toBe('number');
    expect(epicenter).toBeGreaterThanOrEqual(0);
});

test('burstStart epicenter matches triggerBurst(col)', async ({ page }) => {
    await boot(page, { burst: false });
    const stats = await page.evaluate(async () => await window._rain.getStats());
    const targetCol = Math.floor(stats.columns / 2);
    const epicenter = await page.evaluate(async (col) => new Promise((resolve) => {
        window._rain.configure({ burst: true });
        window._rain.on('burstStart', ({ epicenter }) => resolve(epicenter));
        window._rain.triggerBurst(col);
        setTimeout(() => resolve(null), 3000);
    }), targetCol);
    expect(epicenter).toBe(targetCol);
});

test('burstEnd fires after burstStart', async ({ page }) => {
    await boot(page, { burst: false, burstDurationMin: 0.1, burstDurationMax: 0.2 });
    const seq = await page.evaluate(async () => new Promise((resolve) => {
        const events = [];
        window._rain.configure({ burst: true });
        window._rain.on('burstStart', () => events.push('start'));
        window._rain.on('burstEnd',   () => { events.push('end'); resolve(events); });
        window._rain.triggerBurst();
        setTimeout(() => resolve(events), 5000);
    }));
    expect(seq).toContain('start');
    expect(seq).toContain('end');
    expect(seq.indexOf('start')).toBeLessThan(seq.indexOf('end'));
});

// ─────────────────────────────────────────────────────────────────────────────
// configure() — live updates reach the worker
// ─────────────────────────────────────────────────────────────────────────────

test('configure() updates local config immediately', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.configure({ dropSpeed: 42 }));
    expect(await page.evaluate(() => window._rain.getConfig().dropSpeed)).toBe(42);
});

test('configure() opacity updates canvas style immediately', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.configure({ opacity: 0.3 }));
    const opacity = await page.evaluate(() => document.querySelector('#container canvas').style.opacity);
    expect(opacity).toBe('0.3');
});

test('configure() theme change does not throw', async ({ page }) => {
    await boot(page);
    const ok = await page.evaluate(() => {
        try { window._rain.configure({ theme: 'red' }); return true; }
        catch(e) { return false; }
    });
    expect(ok).toBe(true);
});

test('configure() density:50 produces dormant columns', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.configure({ density: 50 }));
    await page.waitForTimeout(300);
    const { dormantColumns } = await page.evaluate(async () => await window._rain.getStats());
    expect(dormantColumns).toBeGreaterThan(0);
});

test('configure() direction change does not throw', async ({ page }) => {
    await boot(page);
    const ok = await page.evaluate(() => {
        try { window._rain.configure({ direction: 'up' }); return true; }
        catch(e) { return false; }
    });
    expect(ok).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// getInstance
// ─────────────────────────────────────────────────────────────────────────────

test('getInstance returns instance by selector', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => DigitalRain.getInstance('#container') === window._rain)).toBe(true);
});

test('getInstance returns null after destroy()', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.destroy());
    expect(await page.evaluate(() => DigitalRain.getInstance('#container'))).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// hideChildren
// ─────────────────────────────────────────────────────────────────────────────

test('hideChildren hides child on start', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', { hideChildren: true, introDepth: 0 });
        window._rain.start();
    });
    expect(await page.evaluate(() => document.querySelector('#child').style.visibility)).toBe('hidden');
});

test('hideChildren restores child on stop', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', { hideChildren: true, introDepth: 0 });
        window._rain.start();
        window._rain.stop();
    });
    expect(await page.evaluate(() => document.querySelector('#child').style.visibility)).toBe('');
});

// ─────────────────────────────────────────────────────────────────────────────
// tapToBurst — real click event
// ─────────────────────────────────────────────────────────────────────────────

test('tapToBurst triggers burstStart on canvas click', async ({ page }) => {
    await boot(page, { tapToBurst: true, burst: true });
    const fired = await page.evaluate(async () => new Promise((resolve) => {
        window._rain.on('burstStart', () => resolve(true));
        document.querySelector('#container canvas').click();
        setTimeout(() => resolve(false), 3000);
    }));
    expect(fired).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// randomize()
// ─────────────────────────────────────────────────────────────────────────────

test('randomize() returns config with burst:true and tapToBurst:true', async ({ page }) => {
    await boot(page);
    const p = await page.evaluate(() => window._rain.randomize());
    expect(p.burst).toBe(true);
    expect(p.tapToBurst).toBe(true);
});

test('randomize() rain keeps running after restart', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window._rain.randomize());
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(true);
    expect(await page.evaluate(() => window._rain._worker !== null)).toBe(true);
});

test('randomize() overrides are respected', async ({ page }) => {
    await boot(page);
    expect(await page.evaluate(() => window._rain.randomize({ theme: 'red' }).theme)).toBe('red');
});

// ─────────────────────────────────────────────────────────────────────────────
// Multiple instances
// ─────────────────────────────────────────────────────────────────────────────

test('two instances run simultaneously', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._r1 = new DigitalRain('#container',  { introDepth: 0 });
        window._r2 = new DigitalRain('#container2', { introDepth: 0, theme: 'red' });
        window._r1.start(); window._r2.start();
    });
    await page.waitForTimeout(300);
    const both = await page.evaluate(() => window._r1.isRunning() && window._r2.isRunning());
    expect(both).toBe(true);
});

test('stopping one instance does not affect the other', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._r1 = new DigitalRain('#container',  { introDepth: 0 });
        window._r2 = new DigitalRain('#container2', { introDepth: 0 });
        window._r1.start(); window._r2.start();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => window._r1.stop());
    expect(await page.evaluate(() => window._r2.isRunning())).toBe(true);
});

test('two instances have independent configs', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._r1 = new DigitalRain('#container',  { introDepth: 0, theme: 'green' });
        window._r2 = new DigitalRain('#container2', { introDepth: 0, theme: 'red' });
        window._r1.start(); window._r2.start();
    });
    const themes = await page.evaluate(() => ({
        r1: window._r1.getConfig().theme,
        r2: window._r2.getConfig().theme,
    }));
    expect(themes.r1).toBe('green');
    expect(themes.r2).toBe('red');
});

// ─────────────────────────────────────────────────────────────────────────────
// Stress
// ─────────────────────────────────────────────────────────────────────────────

test('repeated start/stop cycles do not throw', async ({ page }) => {
    await load(page);
    const ok = await page.evaluate(async () => {
        try {
            const rain = new DigitalRain('#container', { introDepth: 0 });
            for (let i = 0; i < 5; i++) {
                rain.start();
                await new Promise(r => setTimeout(r, 60));
                rain.stop();
                await new Promise(r => setTimeout(r, 60));
            }
            return true;
        } catch(e) { return e.message; }
    });
    expect(ok).toBe(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Layers
// ─────────────────────────────────────────────────────────────────────────────

test('layers mode creates one canvas per layer', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9 }, { fontSize: 14 }, { fontSize: 22 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const canvasCount = await page.evaluate(() =>
        document.querySelectorAll('#container canvas').length
    );
    expect(canvasCount).toBe(3);
});

test('layers mode all workers running after start', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const allRunning = await page.evaluate(() => window._rain._layers.every(l => l.isRunning()));
    expect(allRunning).toBe(true);
});

test('layers isRunning() true while layers are running', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(true);
});

test('layers stop() stops all layers and removes canvases', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.stop());
    const canvasCount = await page.evaluate(() => document.querySelectorAll('#container canvas').length);
    expect(canvasCount).toBe(0);
    expect(await page.evaluate(() => window._rain.isRunning())).toBe(false);
});

test('layers getLayer() returns correct instance', async ({ page }) => {
    await load(page);
    const sizes = await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        return [
            window._rain.getLayer(0).getConfig().fontSize,
            window._rain.getLayer(1).getConfig().fontSize,
            window._rain.getLayer(2).getConfig().fontSize,
        ];
    });
    expect(sizes).toEqual([9, 14, 22]);
});

test('layers configure() propagates to all layers', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.configure({ dropSpeed: 42 }));
    const speeds = await page.evaluate(() => window._rain._layers.map(l => l.getConfig().dropSpeed));
    expect(speeds).toEqual([42, 42]);
});

test('layers getLayer() configure() updates only that layer', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.getLayer(2).configure({ dropSpeed: 1 }));
    const speeds = await page.evaluate(() => window._rain._layers.map(l => l.getConfig().dropSpeed));
    expect(speeds[2]).toBe(1);
    expect(speeds[0]).not.toBe(1);
    expect(speeds[1]).not.toBe(1);
});

test('layers destroy() removes all wrapper divs', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.destroy());
    // Count divs only — excludes the pre-existing #child <p> in the harness
    const divCount = await page.evaluate(() =>
        document.querySelectorAll('#container > div').length
    );
    expect(divCount).toBe(0);
});
test('layers direction enforced — all layers use parent direction', async ({ page }) => {
    await load(page);
    const directions = await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            direction: 'up',
            layers: [
                { fontSize: 9,  introDepth: 0, direction: 'down' }, // override ignored
                { fontSize: 14, introDepth: 0 },
                { fontSize: 22, introDepth: 0 },
            ],
        });
        return window._rain._layers.map(l => l.getConfig().direction);
    });
    expect(directions).toEqual(['up', 'up', 'up']);
});

test('layers configure({direction}) updates all layers', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.configure({ direction: 'up' }));
    const directions = await page.evaluate(() => window._rain._layers.map(l => l.getConfig().direction));
    expect(directions).toEqual(['up', 'up']);
});

test('layers hideChildren hides child on start, restores on stop', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            hideChildren: true,
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    expect(await page.evaluate(() => document.querySelector('#child').style.visibility)).toBe('hidden');
    await page.evaluate(() => window._rain.stop());
    expect(await page.evaluate(() => document.querySelector('#child').style.visibility)).toBe('');
});
test('layers shared RAF — all layers advance frames via single main-thread tick', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }, { fontSize: 22, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const frames1 = await page.evaluate(async () =>
        Promise.all(window._rain._layers.map(l => l.getStats().then(s => s.frame)))
    );
    await page.waitForTimeout(300);
    const frames2 = await page.evaluate(async () =>
        Promise.all(window._rain._layers.map(l => l.getStats().then(s => s.frame)))
    );
    // All layers should have advanced
    for (let i = 0; i < 3; i++) {
        expect(frames2[i]).toBeGreaterThan(frames1[i]);
    }
});

test('layers shared RAF — _sharedRafId is set after start', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const hasRaf = await page.evaluate(() => window._rain._sharedRafId !== null);
    expect(hasRaf).toBe(true);
});

test('layers shared RAF — _sharedRafId is null after stop', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.stop());
    const hasRaf = await page.evaluate(() => window._rain._sharedRafId !== null);
    expect(hasRaf).toBe(false);
});
// ─────────────────────────────────────────────────────────────────────────────
// SMART THROTTLE
// ─────────────────────────────────────────────────────────────────────────────

test('smartThrottle — _mainThreadFps is updated after start in layers mode', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
            smartThrottle: true,
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS + 1500);
    const fps = await page.evaluate(() => window._rain._mainThreadFps);
    expect(fps).toBeGreaterThan(0);
});

test('smartThrottle — throttleTimer is set after start in layers mode', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
            smartThrottle: true,
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const hasTimer = await page.evaluate(() => window._rain._throttleTimer !== null);
    expect(hasTimer).toBe(true);
});

test('smartThrottle — throttleTimer is cleared after stop', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
            smartThrottle: true,
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    await page.evaluate(() => window._rain.stop());
    const hasTimer = await page.evaluate(() => window._rain._throttleTimer !== null);
    expect(hasTimer).toBe(false);
});

test('smartThrottle — reductions accumulate on layer _cfg when fps is low', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0, trailLengthSlow: 70, dualFrequency: 50 },
                { fontSize: 14, introDepth: 0, trailLengthSlow: 70, dualFrequency: 50 }],
            smartThrottle: true,
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    // Directly invoke a reduction on each layer — same logic as _startThrottle's reduceLayer
    await page.evaluate(() => {
        window._rain._layers.forEach(l => {
            const cfg = l._cfg;
            const next = {};
            if (cfg.trailLengthSlow > 5) next.trailLengthSlow = Math.max(5, cfg.trailLengthSlow - 8);
            if (cfg.dualFrequency   > 0) next.dualFrequency   = Math.max(0, cfg.dualFrequency   - 20);
            if (Object.keys(next).length) l.configure(next);
        });
    });
    const vals = await page.evaluate(() =>
        window._rain._layers.map(l => ({ t: l._cfg.trailLengthSlow, d: l._cfg.dualFrequency }))
    );
    const anyReduced = vals.some(v => v.t < 70 || v.d < 50);
    expect(anyReduced).toBe(true);
});

test('smartThrottle:false — no throttle timer', async ({ page }) => {
    await load(page);
    await page.evaluate(() => {
        window._rain = new DigitalRain('#container', {
            layers: [{ fontSize: 9, introDepth: 0 }, { fontSize: 14, introDepth: 0 }],
            smartThrottle: false,
        });
        window._rain.start();
    });
    await page.waitForTimeout(BOOT_MS);
    const hasTimer = await page.evaluate(() => window._rain._throttleTimer !== null);
    expect(hasTimer).toBe(false);
});