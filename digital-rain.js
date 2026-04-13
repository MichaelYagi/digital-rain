/**
 * @fileoverview digital-rain.js
 * Digital rain with lightning burst effects, color themes, event callbacks, and live configuration.
 * No dependencies. Single file. Rendering runs in a Web Worker via OffscreenCanvas.
 *
 * Requires: OffscreenCanvas + Web Workers (all modern browsers; not IE or Safari < 16.4).
 *
 * @example
 * new DigitalRain('#container').start();
 *
 * @example
 * const rain = new DigitalRain('#container', {
 *   theme: 'blue',
 *   dropSpeed: 80,
 *   tapToBurst: true,
 * });
 * rain.start();
 */

// ── Worker source (embedded as blob) ─────────────────────────────────────────
const _WORKER_SRC = `
'use strict';

let _canvas = null, _ctx = null, _cfg = null;
let _cols = [], _frameCount = 0, _running = false, _paused = false;
let _booting = true, _bootStream = null, _bootTargetRow = 0;
let _burstActive = false, _burstFramesLeft = 0, _burstTotalFrames = 0;
let _nextBurstFrame = 0, _burstEpicenter = -1, _burstEpicenterRow = -1;
let _burstRadius = 0, _burstAngle = 0, _burstNoise = null, _burstJag = null;
let _CHARS = [], _rafId = null;
let _speedMult = 1, _fastThresh = 0, _introSpeedMult = 1, _fontStr = '';
let _greenLUT = null, _themeColors = null;
let _tierTable = [], _burstFalloffLUT = null;
let _burstGlowLUT = null, _burstHeadLUT = null, _burstBoostLUT = null;
let _fpsLastTime = 0, _fps = 0;

self.onmessage = (e) => {
    const { type, payload } = e.data;
    switch (type) {
        case 'init':         _init(payload); break;
        case 'start':        _start(); break;
        case 'stop':         _stop(); break;
        case 'pause':        _pause(); break;
        case 'resume':       _resume(); break;
        case 'configure':    _configure(payload); break;
        case 'triggerBurst': _triggerBurst(payload.col, payload.epicenterRow); break;
        case 'resize':       _resize(payload.width, payload.height); break;
        case 'getStats':     _replyStats(payload.id); break;
    }
};

function _post(type, payload) { self.postMessage({ type, payload }); }

function _init({ canvas, cfg }) {
    _canvas = canvas;
    _ctx    = canvas.getContext('2d');
    _cfg    = cfg;
    _CHARS  = cfg.chars.split('');
}

function _start() {
    if (_running) return;
    _running = true;
    _mount();
}

function _stop() {
    if (!_running) return;
    _running = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _unmount();
}

function _pause() {
    if (!_running || _paused) return;
    _paused = true;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _post('event', { name: 'pause' });
}

function _resume() {
    if (!_running || !_paused) return;
    _paused = false;
    _rafId = requestAnimationFrame(_drawFrame);
    _post('event', { name: 'resume' });
}

function _mount() {
    _computeCached();
    const introDepth = _cfg.introDepth;
    if (introDepth <= 0) {
        _booting = false; _bootStream = null; _bootTargetRow = 0;
        _initColumns();
    } else {
        _booting = true;
        const medSkip  = Math.max(1, (_cfg.speedTiers[0] ? _cfg.speedTiers[0].frameSkip : 2) * _introSpeedMult);
        _bootStream    = { row: 0, speed: medSkip, steps: _makeSteps(medSkip), trails: [] };
        const maxRow   = Math.floor(_canvas.height / _cfg.fontSize);
        _bootTargetRow = Math.max(1, Math.round((introDepth / 100) * maxRow));
        _initColumns();
    }
    _nextBurstFrame = 999999;
    _rafId = requestAnimationFrame(_drawFrame);
    _post('event', { name: 'start' });
}

function _unmount() {
    _cols = []; _frameCount = 0;
    _burstActive = false; _burstTotalFrames = 0;
    _burstEpicenter = -1; _burstEpicenterRow = -1; _burstRadius = 0;
    _burstAngle = 0; _burstNoise = null; _burstJag = null;
    _booting = true; _bootStream = null; _bootTargetRow = 0;
    _paused = false;
}

function _resize(width, height) {
    if (!_canvas) return;
    _canvas.width  = width;
    _canvas.height = height;
    _computeCached();
    _initColumns();
}

function _configure(o) {
    const prevSpeed     = _cfg.dropSpeed;
    const prevChars     = _cfg.chars;
    const prevDensity   = _cfg.density;
    const prevDirection = _cfg.direction;
    Object.assign(_cfg, o);
    if (o.chars !== undefined && o.chars !== prevChars) _CHARS = _cfg.chars.split('');
    if (_canvas) {
        _computeCached();
        if ((o.density !== undefined && o.density !== prevDensity) ||
            (o.direction !== undefined && o.direction !== prevDirection)) {
            _initColumns();
        }
        if (o.dropSpeed !== undefined && o.dropSpeed !== prevSpeed) {
            for (const col of _cols) for (const st of col.streams) {
                st.speed = _makeFrameSkip();
                st.steps = _makeSteps(st.speed);
            }
        }
    }
}

function _replyStats(id) {
    let streams = 0, active = 0, dormant = 0;
    for (const col of _cols) {
        if (col.dormant) { dormant++; continue; }
        active++;
        streams += col.streams ? col.streams.length : 0;
    }
    _post('stats', { id, frame: _frameCount, fps: _fps,
        columns: _cols.length, activeColumns: active, dormantColumns: dormant,
        streams, burstActive: _burstActive, burstEpicenter: _burstEpicenter,
        paused: _paused, booting: !!_booting });
}

function _computeCached() {
    const cfg = _cfg;
    const s   = cfg.dropSpeed;
    _speedMult  = s <= 0 ? 999 : s >= 100 ? 1 : Math.round(1 + (99 - s) / 99 * 59);
    _fastThresh = cfg.speedTiers[0].frameSkip * _speedMult * 1.5;
    _fontStr    = cfg.fontSize + 'px ' + cfg.fontFamily;
    const si = cfg.introSpeed;
    _introSpeedMult = si <= 0 ? 999 : si >= 100 ? 1 : Math.round(1 + (99 - si) / 99 * 59);

    // greenLUT and themeColors are resolved on main thread and sent in cfg
    _greenLUT    = cfg.greenLUT;
    _themeColors = cfg.themeColors;

    // Tier table
    const tiers = cfg.speedTiers, mult = _speedMult;
    let tierTotal = 0;
    for (let i = 0; i < tiers.length; i++) tierTotal += tiers[i].weight;
    _tierTable = [];
    for (let i = 0; i < tiers.length; i++) {
        const count = Math.round(tiers[i].weight / tierTotal * 1000);
        const val   = Math.max(1, tiers[i].frameSkip * mult);
        for (let j = 0; j < count; j++) _tierTable.push(val);
    }

    // Gaussian falloff LUT
    const bw  = cfg.burstWidth || 10, bw2 = bw * bw, bMax = bw * 4;
    _burstFalloffLUT = new Float32Array(bMax + 1);
    for (let d = 0; d <= bMax; d++) _burstFalloffLUT[d] = Math.exp(-(d * d) / (2 * bw2));

    // Burst color LUTs
    const [bRc, bGc, bBc] = _themeColors.burst;
    _burstGlowLUT  = new Array(256);
    _burstHeadLUT  = new Array(256);
    _burstBoostLUT = new Array(256);
    for (let i = 0; i < 256; i++) {
        const t = i / 255;
        const gR = Math.min(255, bRc * t | 0);
        const gG = Math.min(255, bGc * t | 0);
        const gB = Math.min(255, bBc * t | 0);
        const w  = t * t * 255 | 0;
        _burstGlowLUT[i]  = 'rgba(' + gR + ',' + gG + ',' + gB + ',';
        _burstHeadLUT[i]  = 'rgb(' + Math.min(255,gR+w) + ',' + Math.min(255,gG+w) + ',' + Math.min(255,gB+w) + ')';
        _burstBoostLUT[i] = [gR, gG, gB, w];
    }
}

function _makeFrameSkip() { return _tierTable[Math.random() * _tierTable.length | 0]; }

function _makeSteps(frameSkip) {
    const tiers   = _cfg.speedTiers;
    const minSkip = tiers[0].frameSkip * _speedMult;
    const maxSkip = tiers[tiers.length - 1].frameSkip * _speedMult;
    const ratio   = maxSkip === minSkip ? 0 : Math.min(1, (frameSkip - minSkip) / (maxSkip - minSkip));
    return Math.round(_cfg.trailLengthFast + (_cfg.trailLengthSlow - _cfg.trailLengthFast) * ratio);
}

function _makeStream(delayMax) {
    const speed = _makeFrameSkip();
    return { row: 0, speed, steps: _makeSteps(speed),
        delay: Math.random() * (delayMax != null ? delayMax : 60) | 0,
        trails: [], active: true, suppressTicks: 0 };
}

function _makeSecondStream(primarySpeed, delayMax) {
    return { row: 0, speed: primarySpeed, steps: _makeSteps(primarySpeed),
        delay: Math.random() * (delayMax != null ? delayMax : 30) | 0,
        trails: [], active: true, suppressTicks: 0 };
}

function _dualCooldown() {
    const f = _cfg.dualFrequency;
    if (f <= 0) return 999999;
    const min = 10 + (100 - f) / 100 * 190 | 0;
    const max = min + (20 + (100 - f) / 100 * 180 | 0);
    return min + (Math.random() * (max - min) | 0);
}

function _initColumns() {
    const n       = Math.floor(_canvas.width / _cfg.fontSize);
    const density = _cfg.density != null ? Math.max(0, Math.min(100, _cfg.density)) : 100;
    const center  = Math.floor(n / 2);
    const activeCount = Math.max(1, Math.floor(n * density / 100));
    const indices = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.random() * (i + 1) | 0;
        const tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
    }
    const activeSet = new Set(indices.slice(0, activeCount));
    if (_booting) activeSet.add(center);
    _cols = Array.from({ length: n }, (_, i) => ({
        streams: [ _makeStream(_booting ? 999999 : 60) ],
        spawnCD: _dualCooldown(),
        dormant: !activeSet.has(i),
    }));
}

function _makeBurstNoise(epi) {
    const n = _cols.length, reach = _cfg.burstReach || 80;
    const noise = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const absDelta = i > epi ? i - epi : epi - i;
        noise[i] = Math.max(0, Math.min(1, (absDelta / reach) * 0.7 + Math.random() * 0.5 - 0.1));
    }
    return noise;
}

function _makeBurstJag() {
    const n = _cols.length, w = _cfg.burstWidth || 6;
    const jag = new Float32Array(n);
    let walk = 0;
    for (let i = 0; i < n; i++) {
        walk += (Math.random() - 0.5) * w * 0.8;
        walk *= 0.85;
        jag[i] = walk;
    }
    return jag;
}

function _triggerBurst(col, epicenterRow) {
    if (!_cfg.burst || !_cols.length) return;
    const cfg = _cfg;
    _burstActive      = true;
    _burstTotalFrames = Math.round((cfg.burstDurationMin + Math.random() * (cfg.burstDurationMax - cfg.burstDurationMin)) * 60);
    _burstFramesLeft  = _burstTotalFrames;
    _burstEpicenter   = col != null ? Math.max(0, Math.min(_cols.length - 1, col | 0)) : Math.random() * _cols.length | 0;
    _burstEpicenterRow = epicenterRow != null ? epicenterRow : Math.floor(_canvas.height / cfg.fontSize * Math.random());
    _burstAngle = (Math.random() < 0.5 ? 1 : -1) * (cfg.burstAngle * (0.5 + Math.random()));
    _burstRadius = 3;
    _burstNoise  = _makeBurstNoise(_burstEpicenter);
    _burstJag    = _makeBurstJag();
    _post('event', { name: 'burstStart', data: { epicenter: _burstEpicenter } });
}

function _drawFrame(now) {
    if (!_ctx || !_canvas) return;
    _frameCount++;
    if (_fpsLastTime) _fps = Math.round(1000 / (now - _fpsLastTime));
    _fpsLastTime = now;

    const cfg     = _cfg;
    const ctx     = _ctx;
    const CHARS   = _CHARS;
    const maxRow  = Math.floor(_canvas.height / cfg.fontSize);
    const numCols = _cols.length;
    const fw      = cfg.fontSize;
    const bgColor = cfg.bgColor;
    const fc      = _frameCount;

    // ── Boot phase ────────────────────────────────────────────────────────
    if (_booting && _bootStream) {
        const bs      = _bootStream;
        const centerX = Math.floor(numCols / 2) * fw;
        const dirUp   = cfg.direction === 'up';

        if (fc % bs.speed === 0) {
            const char = CHARS[Math.random() * CHARS.length | 0];
            for (let t = 0; t < bs.trails.length; t++) bs.trails[t].brightness--;
            for (let t = bs.trails.length - 1; t >= 0; t--) {
                if (bs.trails[t].brightness <= 0) { bs.trails[t] = bs.trails[bs.trails.length-1]; bs.trails.pop(); }
            }
            bs.trails.push({ row: bs.row, char, brightness: bs.steps + 6 });
            bs.row++;
        }

        ctx.font = _fontStr;
        for (let t = 0; t < bs.trails.length; t++) {
            const e  = bs.trails[t];
            const row = dirUp ? (maxRow - 1 - e.row) : e.row;
            const cy = row * fw;
            ctx.fillStyle = bgColor;
            ctx.fillRect(centerX, cy, fw, fw);
            if (t === bs.trails.length - 1) {
                ctx.fillStyle = _themeColors.glow + cfg.glowAlpha + ')';
                ctx.fillText(e.char, centerX - 1, cy + fw - 2);
                ctx.fillText(e.char, centerX + 1, cy + fw - 2);
                ctx.fillText(e.char, centerX,     cy + fw - 3);
                ctx.fillText(e.char, centerX,     cy + fw - 1);
                ctx.fillStyle = _themeColors.head;
            } else {
                const cl = Math.min(1, e.brightness / bs.steps);
                ctx.fillStyle = _greenLUT[cl * cl * 255 | 0];
            }
            ctx.fillText(e.char, centerX, cy + fw - 2);
        }

        if (bs.row >= _bootTargetRow) {
            _booting = false;
            const centerCol = Math.floor(numCols / 2);
            _initColumns();
            _cols[centerCol].streams[0] = {
                row: bs.row, speed: bs.speed, steps: bs.steps,
                delay: 0, trails: bs.trails.slice(), active: true, suppressTicks: 0,
            };
            _cols[centerCol].dormant = false;
            _bootStream = null;
            if (cfg.burst) {
                _nextBurstFrame = fc + Math.round(
                    (cfg.burstFirstMin + Math.random() * (cfg.burstFirstMax - cfg.burstFirstMin)) * 60
                );
            }
            _post('event', { name: 'introComplete' });
        }

        _rafId = requestAnimationFrame(_drawFrame);
        return;
    }

    const fastThresh = _fastThresh;
    const minGap     = cfg.dualMinGap;

    // ── Burst ─────────────────────────────────────────────────────────────
    if (cfg.burst && !_burstActive && fc >= _nextBurstFrame) _triggerBurst(null, null);
    if (_burstActive) {
        if (--_burstFramesLeft <= 0) {
            _burstActive = false; _burstTotalFrames = 0;
            _burstEpicenter = -1; _burstEpicenterRow = -1;
            _burstRadius = 0; _burstAngle = 0; _burstNoise = null; _burstJag = null;
            _nextBurstFrame = fc + Math.round(
                (cfg.burstIntervalMin + Math.random() * (cfg.burstIntervalMax - cfg.burstIntervalMin)) * 60
            );
            _post('event', { name: 'burstEnd' });
        }
    }

    const burstActive       = _burstActive;
    const burstEpicenter    = _burstEpicenter;
    const burstEpicenterRow = _burstEpicenterRow;
    const burstAngle        = _burstAngle;
    const burstReach        = cfg.burstReach;
    const burstWidth        = cfg.burstWidth;
    const elapsed    = burstActive ? _burstTotalFrames - _burstFramesLeft : 0;
    const progress   = burstActive ? elapsed / _burstTotalFrames : 0;

    ctx.font = _fontStr;
    const greenLUT        = _greenLUT;
    const themeColors     = _themeColors;
    const glowLUT         = themeColors.glow + cfg.glowAlpha + ')';
    const burstFalloffLUT = _burstFalloffLUT;
    const burstGlowLUT    = _burstGlowLUT;
    const burstHeadLUT    = _burstHeadLUT;
    const burstBoostLUT   = _burstBoostLUT;
    const [bRc, bGc, bBc] = themeColors.burst;
    const burstJagArr     = _burstJag;
    const dirUp           = cfg.direction === 'up';

    // STEP 1: Advance state
    for (let i = 0; i < numCols; i++) {
        const col = _cols[i];
        if (col.dormant) continue;

        if (cfg.dualFrequency > 0 && col.streams.length === 1 && col.streams[0].active
            && col.streams[0].speed <= fastThresh) {
            if (--col.spawnCD <= 0) {
                if (col.streams[0].row > minGap * 2) col.streams.push(_makeSecondStream(col.streams[0].speed, 30));
                col.spawnCD = _dualCooldown();
            }
        }

        const nSt = col.streams.length;
        for (let s = 0; s < nSt; s++) {
            const st = col.streams[s];
            if (!st.active || fc % st.speed !== 0) continue;
            if (st.delay > 0) { st.delay--; continue; }

            if (nSt > 1) {
                let tooClose = false;
                for (let o = 0; o < nSt; o++) {
                    if (o === s) continue;
                    const diff = st.row - col.streams[o].row;
                    if (col.streams[o].active && diff < minGap && diff > -minGap) { tooClose = true; break; }
                }
                if (tooClose) { if (++st.suppressTicks > 120) st.active = false; continue; }
            }
            st.suppressTicks = 0;

            const trails = st.trails, nTrails = trails.length;
            if (st.row < maxRow) {
                for (let t = 0; t < nTrails; t++) trails[t].brightness--;
                for (let t = nTrails - 1; t >= 0; t--) {
                    if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
                }
                trails.push({ row: st.row, char: CHARS[Math.random() * CHARS.length | 0], brightness: st.steps + 6 });
                st.row++;
            } else {
                st.active = false;
                for (let t = 0; t < nTrails; t++) trails[t].brightness--;
                for (let t = nTrails - 1; t >= 0; t--) {
                    if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
                }
            }
        }

        for (let s = 0; s < col.streams.length; s++) {
            const st = col.streams[s];
            if (st.active || fc % st.speed !== 0) continue;
            const trails = st.trails, nTrails = trails.length;
            for (let t = 0; t < nTrails; t++) trails[t].brightness--;
            for (let t = nTrails - 1; t >= 0; t--) {
                if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
            }
        }

        for (let s = col.streams.length - 1; s >= 0; s--) {
            if (!col.streams[s].active && col.streams[s].trails.length === 0) col.streams.splice(s, 1);
        }
        if (col.streams.length === 0) col.streams.push(_makeStream(Math.random() * 60 | 0));
    }

    // STEP 2: Render
    for (let i = 0; i < numCols; i++) {
        const col = _cols[i];
        const x   = i * fw;

        if (!col.curRows)  col.curRows  = new Uint8Array(maxRow);
        if (!col.prevRows) col.prevRows = new Uint8Array(maxRow);

        if (!col.dormant) {
            col.curRows.fill(0);
            const nStreams = col.streams.length;
            for (let s = 0; s < nStreams; s++) {
                const trails = col.streams[s].trails, nTrails = trails.length;
                for (let t = 0; t < nTrails; t++) { const r = trails[t].row; if (r < maxRow) col.curRows[r] = 1; }
            }
            ctx.fillStyle = bgColor;
            for (let r = 0; r < maxRow; r++) {
                if (col.prevRows[r] && !col.curRows[r]) ctx.fillRect(x, r * fw, fw, fw);
            }
        }

        const colDelta = burstActive && burstEpicenter >= 0 ? i - burstEpicenter : 0;
        let colBIntens = 0;
        if (burstActive && burstEpicenter >= 0 && _burstNoise) {
            const absDelta    = colDelta < 0 ? -colDelta : colDelta;
            const noiseThresh = _burstNoise[i] != null ? _burstNoise[i] : 1;
            if (absDelta <= burstReach && progress < noiseThresh) {
                const reach_t = 1 - absDelta / burstReach;
                colBIntens = reach_t * reach_t;
            }
        }

        const jagOff   = burstActive && burstJagArr ? burstJagArr[i] : 0;
        const boltRow  = burstActive ? burstEpicenterRow + burstAngle * colDelta + jagOff : 0;
        const bMaxDist = burstWidth * 4;
        const nStreams = col.streams.length;

        // Pass 1: batch background clears (trail cells)
        ctx.fillStyle = bgColor;
        for (let s = 0; s < nStreams; s++) {
            const st = col.streams[s], trails = st.trails, nTrails = trails.length;
            const headIdx = st.active ? nTrails - 1 : -1;
            for (let t = 0; t < nTrails; t++) {
                if (t === headIdx) continue;
                const e = trails[t], row = dirUp ? (maxRow - 1 - e.row) : e.row;
                ctx.fillRect(x, row * fw, fw, fw);
            }
        }

        // Pass 2: draw text
        for (let s = 0; s < nStreams; s++) {
            const st = col.streams[s], trails = st.trails, nTrails = trails.length;
            const headIdx = st.active ? nTrails - 1 : -1;
            const stSteps = st.steps;

            for (let t = 0; t < nTrails; t++) {
                const e   = trails[t];
                const row = dirUp ? (maxRow - 1 - e.row) : e.row;
                const cy  = row * fw;

                let bIntens = 0;
                if (colBIntens > 0) {
                    const rowDist = e.row - boltRow;
                    const absDist = rowDist < 0 ? -rowDist : rowDist;
                    if (absDist < bMaxDist) bIntens = colBIntens * (burstFalloffLUT[absDist | 0] || 0);
                }

                if (t === headIdx) {
                    ctx.fillStyle = bgColor;
                    ctx.fillRect(x - 1, cy - 1, fw + 2, fw + 2);
                    if (bIntens > 0) {
                        const lutIdx = Math.min(255, bIntens * 255 | 0);
                        ctx.fillStyle = burstGlowLUT[lutIdx] + (cfg.glowAlpha + bIntens * 0.5) + ')';
                        ctx.fillText(e.char, x - 1, cy + fw - 2);
                        ctx.fillText(e.char, x + 1, cy + fw - 2);
                        ctx.fillText(e.char, x,     cy + fw - 3);
                        ctx.fillText(e.char, x,     cy + fw - 1);
                        ctx.fillStyle = burstHeadLUT[lutIdx];
                    } else {
                        ctx.fillStyle = glowLUT;
                        ctx.fillText(e.char, x - 1, cy + fw - 2);
                        ctx.fillText(e.char, x + 1, cy + fw - 2);
                        ctx.fillText(e.char, x,     cy + fw - 3);
                        ctx.fillText(e.char, x,     cy + fw - 1);
                        ctx.fillStyle = themeColors.head;
                    }
                    ctx.fillText(e.char, x, cy + fw - 2);
                } else {
                    const cl1 = e.brightness / stSteps, cl = cl1 > 1 ? 1 : cl1;
                    if (bIntens > 0) {
                        const boost = burstBoostLUT[Math.min(255, bIntens * 255 | 0)];
                        ctx.fillStyle = 'rgb(' +
                            Math.min(255, (cl * cl * bRc | 0) + boost[0] + boost[3]) + ',' +
                            Math.min(255, (cl * cl * bGc | 0) + boost[1] + boost[3]) + ',' +
                            Math.min(255, (cl * cl * bBc | 0) + boost[2] + boost[3]) + ')';
                    } else {
                        ctx.fillStyle = greenLUT[cl * cl * 255 | 0];
                    }
                    ctx.fillText(e.char, x, cy + fw - 2);
                }
            }
        }

        const tmp = col.prevRows; col.prevRows = col.curRows; col.curRows = tmp;
    }

    _rafId = requestAnimationFrame(_drawFrame);
}
`;

// ── Main thread class ─────────────────────────────────────────────────────────

/**
 * Digital rain animation controller.
 * Rendering runs in a Web Worker via OffscreenCanvas, keeping the main thread free.
 * Requires OffscreenCanvas + Web Workers (all modern browsers; not IE or Safari < 16.4).
 * @class
 */
class DigitalRain {
    /**
     * @param {string|Element} container - CSS selector or DOM element.
     * @param {object}         [options] - Configuration. See {@link DigitalRain.OPTIONS}.
     */
    constructor(container, options = {}) {
        this._el = typeof container === 'string'
            ? document.querySelector(container) : container;
        if (!this._el) throw new Error(`DigitalRain: element not found — "${container}"`);

        this._cfg            = Object.assign({}, DigitalRain.DEFAULTS, options);
        this._canvas         = null;
        this._worker         = null;
        this._running        = false;
        this._paused         = false;
        this._startTimer     = null;
        this._fadeOutRaf     = null;
        this._childrenHidden = false;
        this._boundTap       = null;
        this._statsCallbacks = new Map();
        this._statsIdCounter = 0;
        this._onResize       = this._handleResize.bind(this);

        // ── Layers ────────────────────────────────────────────────────────
        // If layers option is an array, create child instances — one per layer.
        // Each child gets a wrapper div positioned to fill the container,
        // stacked via z-index (back=1, mid=2, front=3).
        // All public methods on this instance delegate to the children.
        this._layers = null;
        if (Array.isArray(this._cfg.layers) && this._cfg.layers.length > 0) {
            this._layers = this._cfg.layers.map((layerCfg, i) => {
                const wrapper = document.createElement('div');
                Object.assign(wrapper.style, {
                    position: 'absolute', inset: '0',
                    zIndex:   String(i + 1),
                    pointerEvents: 'none',
                    willChange: 'transform',
                });
                this._el.appendChild(wrapper);
                // Merge base options (minus layers) with per-layer overrides
                const base = Object.assign({}, this._cfg);
                delete base.layers;
                delete base.hideChildren;
                delete base.on;
                const merged = Object.assign({}, base, layerCfg);
                return new DigitalRain(wrapper, merged);
            });
            // Ensure container is positioned so absolute children work
            if (window.getComputedStyle(this._el).position === 'static') {
                this._el.style.position = 'relative';
            }
        }

        DigitalRain._registry.set(this._el, this);
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────

    /** Mount canvas and start. Respects startDelay. No-op if already running. */
    start() {
        if (this._layers) { this._layers.forEach(l => l.start()); this._running = true; return; }
        if (this._running) return;
        this._running = true;
        const ms = (this._cfg.startDelay || 0) * 1000;
        if (ms > 0) this._startTimer = setTimeout(() => this._mount(), ms);
        else        this._mount();
    }

    /** Stop, remove canvas, restore hidden children. Respects fadeOutDuration. */
    stop() {
        if (this._layers) { this._layers.forEach(l => l.stop()); this._running = false; return; }
        if (!this._running) return;
        this._running = false;
        clearTimeout(this._startTimer);
        const fadeSecs = this._cfg.fadeOutDuration || 0;
        if (fadeSecs > 0 && this._canvas) {
            let frame = 0;
            const totalFrames = Math.round(fadeSecs * 60);
            const tick = () => {
                frame++;
                this._canvas.style.opacity = Math.max(0, 1 - frame / totalFrames);
                if (frame < totalFrames) {
                    this._fadeOutRaf = requestAnimationFrame(tick);
                } else {
                    this._canvas.style.opacity = '';
                    this._unmount();
                    window.removeEventListener('resize', this._onResize);
                }
            };
            this._fadeOutRaf = requestAnimationFrame(tick);
        } else {
            this._unmount();
            window.removeEventListener('resize', this._onResize);
        }
    }

    /** Alias for stop(). Also removes from registry. */
    destroy() {
        if (this._layers) {
            this._layers.forEach(l => { l.destroy(); l._el.remove(); });
            this._layers = null;
        }
        this.stop();
        DigitalRain._registry.delete(this._el);
    }

    /** Freeze in place. No-op if not running or already paused. */
    pause() {
        if (this._layers) { this._layers.forEach(l => l.pause()); this._paused = true; return; }
        if (!this._running || this._paused) return;
        this._paused = true;
        this._post('pause');
        this._emit('pause');
    }

    /** Unfreeze. Falls back to start() if not running. */
    resume() {
        if (this._layers) { this._layers.forEach(l => l.resume()); this._paused = false; return; }
        if (!this._running) { this.start(); return; }
        if (!this._paused) return;
        this._paused = false;
        this._post('resume');
        this._emit('resume');
    }

    /** True if started and not stopped (includes paused). */
    isRunning() {
        if (this._layers) return this._layers.some(l => l.isRunning());
        return this._running;
    }

    /** True if currently paused. */
    isPaused() {
        if (this._layers) return this._layers.every(l => l.isPaused());
        return this._paused;
    }

    // ── Config & stats ────────────────────────────────────────────────────

    /** Shallow clone of current config (callbacks excluded). */
    getConfig() {
        const cfg = Object.assign({}, this._cfg);
        delete cfg.on;
        return cfg;
    }

    /**
     * Returns a Promise resolving to live runtime stats.
     * @returns {Promise<{frame, fps, columns, activeColumns, dormantColumns, streams, burstActive, burstEpicenter, paused, booting}>}
     */
    getStats() {
        return new Promise((resolve) => {
            if (!this._worker) {
                resolve({ frame:0, fps:0, columns:0, activeColumns:0, dormantColumns:0,
                    streams:0, burstActive:false, burstEpicenter:-1, paused:this._paused, booting:true });
                return;
            }
            const id = ++this._statsIdCounter;
            this._statsCallbacks.set(id, resolve);
            this._post('getStats', { id });
        });
    }

    /**
     * Get an individual layer instance for per-layer configuration.
     * @param {number} index - 0=back, 1=middle, 2=front
     * @returns {DigitalRain|null}
     */
    getLayer(index) {
        if (!this._layers) return null;
        return this._layers[index] || null;
    }

    /**
     * @param {object} options - Partial options.
     */
    configure(o) {
        if (this._layers) { this._layers.forEach(l => l.configure(o)); return; }
        Object.assign(this._cfg, o);
        if (o.opacity !== undefined && this._canvas) {
            this._canvas.style.opacity = this._cfg.opacity;
        }
        if (this._worker) {
            const resolved = this._resolveTheme(this._cfg);
            this._post('configure', Object.assign({}, o, {
                greenLUT:    resolved.greenLUT,
                themeColors: resolved.themeColors,
            }));
        }
    }

    /**
     * Manually fire a burst.
     * @param {number} [col] - Column index. Random if omitted.
     */
    triggerBurst(col) {
        if (this._layers) { this._layers.forEach(l => l.triggerBurst(col)); return; }
        this._post('triggerBurst', { col: col != null ? col : null, epicenterRow: null });
    }

    /**
     * Register an event callback.
     * @param {string}   event - 'start'|'stop'|'pause'|'resume'|'introComplete'|'burstStart'|'burstEnd'
     * @param {Function} fn
     * @returns {DigitalRain} this
     */
    on(event, fn) {
        if (this._layers) { this._layers.forEach(l => l.on(event, fn)); return this; }
        if (!this._cfg.on) this._cfg.on = {};
        this._cfg.on[event] = fn;
        return this;
    }

    /**
     * Randomize visuals and restart.
     * @param {object} [overrides={}] - Lock specific values.
     * @returns {object} Applied config.
     */
    randomize(overrides = {}) {
        if (this._layers) {
            const results = this._layers.map(l => l.randomize(overrides));
            return results[Math.floor(this._layers.length / 2)]; // return middle layer config
        }
        const rInt   = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
        const rFloat = (a, b, dec=2) => Math.round((Math.random() * (b - a) + a) * 10**dec) / 10**dec;
        const rPick  = (arr) => arr[Math.random() * arr.length | 0];
        const charsetValues    = Object.values(DigitalRain.CHARSETS);
        const trailLengthFast  = rInt(5, 100);
        const burstDurationMin = rInt(1, 15);
        const burstIntervalMin = rInt(1, 120);
        const burstFirstMin    = rInt(5, 30);
        const picked = {
            theme:            'hsl(' + rInt(0,360) + ',100%,55%)',
            glowColor:        Math.random() < 0.5 ? null : 'hsl(' + rInt(0,360) + ',100%,75%)',
            chars:            rPick(charsetValues),
            opacity:          rFloat(0.5, 1.0),
            glowAlpha:        rFloat(0.2, 1.0),
            bgColor:          rPick(['#000000','#050505','#030303','#0a0a0a','#000805']),
            fontSize:         rPick([12, 14, 16, 18, 20]),
            direction:        rPick(['down', 'up']),
            dualFrequency:    rInt(0, 100),
            trailLengthFast,
            trailLengthSlow:  rInt(trailLengthFast, 150),
            burst:            true,
            burstDurationMin,
            burstDurationMax: rInt(burstDurationMin, 20),
            burstIntervalMin,
            burstIntervalMax: rInt(burstIntervalMin, 300),
            burstFirstMin,
            burstFirstMax:    rInt(burstFirstMin, 60),
            burstWidth:       rInt(4, 20),
            burstReach:       rInt(40, 200),
            burstAngle:       rFloat(0, 0.5),
            tapToBurst:       true,
            hideChildren:     false,
            fadeOutDuration:  rPick([0, 0, 0, 0.5, 1, 2]),
            introDepth:       rInt(0, 100),
        };
        Object.assign(picked, overrides);
        this.configure(picked);
        const savedFade = this._cfg.fadeOutDuration;
        this._cfg.fadeOutDuration = 0;
        this.stop();
        this._cfg.fadeOutDuration = savedFade;
        this.start();
        return picked;
    }

    // ── Static ────────────────────────────────────────────────────────────

    /**
     * Get a running instance by container element or selector.
     * @param {string|Element} container
     * @returns {DigitalRain|null}
     */
    static getInstance(container) {
        const el = typeof container === 'string'
            ? document.querySelector(container) : container;
        return DigitalRain._registry.get(el) || null;
    }

    /** Built-in character sets. Use with configure({ chars: DigitalRain.CHARSETS.binary }). */
    static get CHARSETS() {
        return {
            katakana:  'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',
            hiragana:  'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん0123456789',
            binary:    '01',
            hex:       '0123456789ABCDEF',
            latin:     'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()',
            greek:     'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω∑∏∂∇∞≈≠≤≥±×÷√∫',
            russian:   'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя',
            runic:     'ᚠᚡᚢᚣᚤᚥᚦᚧᚨᚩᚪᚫᚬᚭᚮᚯᚰᚱᚲᚳᚴᚵᚶᚷᚸᚹᚺᚻᚼᚽᚾᚿᛀᛁᛂᛃᛄᛅᛆᛇᛈᛉᛊᛋᛌᛍᛎᛏᛐᛑᛒᛓ',
            hangul:    '가나다라마바사아자차카타파하갈날달랄말발살알잘찰칼탈팔할강낭당랑망방상앙장창캉탕팡항',
            arabic:    'ابتثجحخدذرزسشصضطظعغفقكلمنهوي٠١٢٣٤٥٦٧٨٩',
            braille:   '⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯',
            box:       '─━│┃┄┅┆┇┈┉┊┋┌┍┎┏┐┑┒┓└┕┖┗┘┙┚┛├┝┞┟┠┡┢┣┤┥┦┧┨┩┪┫┬┭┮┯┰┱┲┳┴┵┶┷┸┹┺┻┼┽┾┿╀╁╂╃',
            math:      '∑∏∂∇∈∉∋∌∍∎∏∐∑∓∔∕∖∗∘∙√∛∜∝∞∟∠∡∢∣∤∥∦∧∨∩∪∫∬∭∮∯∰∱∲∳∴∵∶∷∸∹∺∻∼∽∾∿≀≁≂≃≄≅',
            symbols:   '!@#$%^&*()-_=+[]{}|;:,.<>?/~`±§¶•©®™°¿¡',
            blocks:    '█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟■□▢▣▤▥▦▧▨▩▪▫▬▭▮▯▰▱▲△▴▵▶▷▸▹►▻▼½▽▾▿◀',
            emoticons: '☺☻☹♠♣♥♦♀♂☯☮✝☪★☆☀☁☂☃☄⚢⚣⚤⚥⚦⚧⚨⚩⚬⚭⚮⚯⚰⚱⚲⚳⚴⚵⚶⚷⚸⚹⚺⚻⚼☎☏✆☖☗♔♕♖♗♘♙♚♛♜♝♞♟✀✁✂✃✄✆✇✈✉✎✏✐✑✒✓✔✕✖✗✘✙✚✛✜✝✞✟✠✡✢✣✤✥✦✧✩✪✫✬✭✮✯✰✱✲✳✴✵✶✷✸✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋❍❏❐❑❒❖❘❙❚❛❜❝❞',
        };
    }

    static get DEFAULTS() {
        return {
            startDelay:      0,
            fontSize:        14,
            bgColor:         '#050505',
            glowAlpha:       0.6,
            fontFamily:      '"Share Tech Mono", "Courier New", monospace',
            chars:           'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',
            dropSpeed:       98,
            speedTiers: [
                { frameSkip: 2,  weight: 50 },
                { frameSkip: 4,  weight: 42 },
                { frameSkip: 10, weight: 4  },
                { frameSkip: 13, weight: 4  },
            ],
            dualFrequency:   50,
            dualMinGap:      10,
            trailLengthFast: 28,
            trailLengthSlow: 70,
            burst:              true,
            burstDurationMin:   10,
            burstDurationMax:   18,
            burstIntervalMin:   30,
            burstIntervalMax:   60,
            burstFirstMin:      20,
            burstFirstMax:      40,
            burstExpansionRate: 0.45,
            burstWidth:         10,
            burstReach:         140,
            burstAngle:         0.25,
            tapToBurst:     false,
            hideChildren:   false,
            introDepth:     50,
            introSpeed:     98,
            theme:          'green',
            glowColor:      null,
            opacity:        1,
            density:        100,
            direction:      'down',
            fadeOutDuration: 0,
            on:             {},
            layers:         null,
        };
    }

    static get OPTIONS() {
        return {
            startDelay:       { type: 'number',  default: 0,         description: 'Seconds before rain begins' },
            fontSize:         { type: 'number',  default: 14,        description: 'px — controls column width and row height' },
            bgColor:          { type: 'string',  default: '#050505', description: 'Background fill color' },
            glowAlpha:        { type: 'number',  default: 0.6,       description: 'Glow intensity on stream heads (0–1)' },
            fontFamily:       { type: 'string',  default: '"Share Tech Mono"...', description: 'CSS font-family string' },
            chars:            { type: 'string',  default: 'アイ...', description: 'Character pool. Use DigitalRain.CHARSETS.<key> for built-ins.' },
            theme:            { type: 'string',  default: 'green',   description: "Named theme ('green'|'red'|'blue'|'white'|'amber'), hex, or any CSS color" },
            glowColor:        { type: 'string',  default: 'null',    description: 'Glow/head color override. null = derived from theme.' },
            opacity:          { type: 'number',  default: 1,         description: 'Canvas opacity (0–1)' },
            density:          { type: 'number',  default: 100,       description: 'Fraction of columns active (0–100)' },
            direction:        { type: 'string',  default: 'down',    description: "'down' | 'up'" },
            dropSpeed:        { type: 'number',  default: 98,        description: '0=frozen, 1=barely moving, 100=fastest' },
            speedTiers:       { type: 'Array',   default: '[...]',   description: 'Weighted speed tiers: [{frameSkip, weight}]' },
            trailLengthFast:  { type: 'number',  default: 28,        description: 'Trail length for fastest columns' },
            trailLengthSlow:  { type: 'number',  default: 70,        description: 'Trail length for slowest columns' },
            dualFrequency:    { type: 'number',  default: 50,        description: '0=never, 100=very frequent dual streams' },
            dualMinGap:       { type: 'number',  default: 10,        description: 'Min row gap between dual streams' },
            burst:            { type: 'boolean', default: true,      description: 'Enable automatic lightning bursts' },
            burstDurationMin: { type: 'number',  default: 10,        description: 'Min burst duration (seconds)' },
            burstDurationMax: { type: 'number',  default: 18,        description: 'Max burst duration (seconds)' },
            burstIntervalMin: { type: 'number',  default: 30,        description: 'Min seconds between bursts' },
            burstIntervalMax: { type: 'number',  default: 60,        description: 'Max seconds between bursts' },
            burstFirstMin:    { type: 'number',  default: 20,        description: 'Min seconds before first burst' },
            burstFirstMax:    { type: 'number',  default: 40,        description: 'Max seconds before first burst' },
            burstWidth:       { type: 'number',  default: 10,        description: 'Row half-width of the bolt (Gaussian falloff)' },
            burstReach:       { type: 'number',  default: 140,       description: 'Column reach of the bolt left/right' },
            burstAngle:       { type: 'number',  default: 0.25,      description: 'Row drift per column (bolt steepness)' },
            tapToBurst:       { type: 'boolean', default: false,     description: 'Click/tap canvas to trigger burst' },
            hideChildren:     { type: 'boolean', default: false,     description: 'Hide container children on start, restore on stop' },
            fadeOutDuration:  { type: 'number',  default: 0,         description: 'Seconds to fade canvas before unmounting on stop' },
            introDepth:       { type: 'number',  default: 50,        description: 'Pioneer drop depth: 0=off, 50=halfway, 100=full' },
            introSpeed:       { type: 'number',  default: 98,        description: 'Pioneer drop speed (0–100)' },
            on:               { type: 'object',  default: '{}',      description: 'Event callbacks: { start, stop, pause, resume, introComplete, burstStart, burstEnd }' },
            layers:           { type: 'array',   default: 'null',    description: 'Array of 1–3 layer config objects for parallax depth effect. null = single layer.' },
        };
    }

    /** Print formatted reference to the console. */
    static help() {
        const c = {
            title: 'color:#00ff41;font-weight:bold;font-size:1.1em',
            head:  'color:#00ff41;font-weight:bold',
            key:   'color:#00cfff', type: 'color:#ffaa00',
            def:   'color:#aaaaaa', desc: 'color:#cccccc',
            method:'color:#ff79c6;font-weight:bold', sig:'color:#aaaaaa',
        };
        console.log('%cDigitalRain', c.title);
        console.log('%cdigital-rain.js — Web Worker + OffscreenCanvas, no dependencies, single file', c.def);
        console.log(' ');
        console.log('%c── OPTIONS ─────────────────────────────────────────', c.head);
        const opts = DigitalRain.OPTIONS;
        const keyW = Math.max(...Object.keys(opts).map(k => k.length));
        for (const [key, meta] of Object.entries(opts)) {
            console.log(`  %c${key}${' '.repeat(keyW-key.length)}%c  ${meta.type.padEnd(8)}%c  default: ${String(meta.default).slice(0,20).padEnd(22)}%c  ${meta.description}`,
                c.key, c.type, c.def, c.desc);
        }
        console.log(' ');
        console.log('%c── METHODS ─────────────────────────────────────────', c.head);
        const methods = [
            ['start()',               'Mount canvas and begin. Respects startDelay.'],
            ['stop()',                'Stop, remove canvas, restore children. Respects fadeOutDuration.'],
            ['destroy()',             'Alias for stop(). Also removes from registry.'],
            ['pause()',               'Freeze animation. Canvas stays, state preserved.'],
            ['resume()',              'Unfreeze. Falls back to start() if not running.'],
            ['isRunning()',           'True if started and not stopped (includes paused).'],
            ['isPaused()',            'True if currently paused.'],
            ['getConfig()',           'Shallow clone of current config (callbacks excluded).'],
            ['getStats()',            'Promise → { frame, fps, columns, streams, burstActive, ... }'],
            ['configure(opts)',       'Update options live.'],
            ['randomize(overrides?)', 'Randomize visuals and restart. Returns applied config.'],
            ['triggerBurst(col?)',    'Fire a burst manually.'],
            ['on(event, fn)',         "'start'|'stop'|'pause'|'resume'|'introComplete'|'burstStart'|'burstEnd'"],
        ];
        const mW = Math.max(...methods.map(([m]) => m.length));
        for (const [sig, desc] of methods) {
            console.log(`  %c${sig}${' '.repeat(mW-sig.length)}%c  ${desc}`, c.method, c.desc);
        }
        console.log(' ');
        console.log('%c── STATIC ──────────────────────────────────────────', c.head);
        console.log(`  %cDigitalRain.getInstance(el)%c  Get running instance by container or selector.`, c.method, c.desc);
        console.log(`  %cDigitalRain.CHARSETS%c         16 built-in character sets.`, c.method, c.desc);
        console.log(`  %cDigitalRain.OPTIONS%c          All options with type, default, description.`, c.method, c.desc);
        console.log(`  %cDigitalRain.DEFAULTS%c         All default values.`, c.method, c.desc);
        console.log(`  %cDigitalRain.help()%c           Print this reference.`, c.method, c.desc);
        console.log(' ');
    }

    // ── Private ───────────────────────────────────────────────────────────

    _post(type, payload = {}) {
        if (this._worker) this._worker.postMessage({ type, payload });
    }

    _emit(event, data) {
        const fn = this._cfg.on && this._cfg.on[event];
        if (typeof fn === 'function') try { fn(data); } catch(e) {}
    }

    _parseCSSColor(str) {
        try {
            const tmp = document.createElement('canvas');
            tmp.width = tmp.height = 1;
            const ctx = tmp.getContext('2d');
            ctx.fillStyle = '#000'; ctx.fillStyle = str;
            const computed = ctx.fillStyle;
            if (computed.startsWith('#')) {
                const s = computed.slice(1);
                return [parseInt(s.slice(0,2),16), parseInt(s.slice(2,4),16), parseInt(s.slice(4,6),16)];
            }
            const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
            if (m) return [+m[1], +m[2], +m[3]];
        } catch(e) {}
        return null;
    }

    _resolveTheme(cfg) {
        const theme = cfg.theme || 'green';
        const THEMES = {
            green: (v) => `rgb(0,${v},0)`,
            red:   (v) => `rgb(${v},0,0)`,
            blue:  (v) => `rgb(0,${Math.round(v*0.4)},${v})`,
            white: (v) => `rgb(${v},${v},${v})`,
            amber: (v) => `rgb(${v},${Math.round(v*0.6)},0)`,
        };
        const HEAD_COLORS = {
            green: { head: '#00ff41', glow: 'rgba(0,255,0,',     burst: [0,255,0]     },
            red:   { head: '#ff3300', glow: 'rgba(255,80,0,',    burst: [255,80,0]    },
            blue:  { head: '#00cfff', glow: 'rgba(0,150,255,',   burst: [0,150,255]   },
            white: { head: '#ffffff', glow: 'rgba(220,220,220,', burst: [220,220,220] },
            amber: { head: '#ffaa00', glow: 'rgba(255,160,0,',   burst: [255,160,0]   },
        };
        const buildFromRgb = ([hr, hg, hb]) => ({
            colorFn: (v) => `rgb(${Math.round(v*hr/255)},${Math.round(v*hg/255)},${Math.round(v*hb/255)})`,
            themeColors: {
                head:  `#${hr.toString(16).padStart(2,'0')}${hg.toString(16).padStart(2,'0')}${hb.toString(16).padStart(2,'0')}`,
                glow:  `rgba(${hr},${hg},${hb},`,
                burst: [hr, hg, hb],
            },
        });

        let colorFn, themeColors;
        if (THEMES[theme]) {
            colorFn = THEMES[theme]; themeColors = HEAD_COLORS[theme];
        } else {
            const rgb = this._parseCSSColor(theme);
            if (rgb) {
                ({ colorFn, themeColors } = buildFromRgb(rgb));
            } else {
                console.warn(`DigitalRain: unrecognised theme "${theme}", falling back to green`);
                colorFn = THEMES.green; themeColors = HEAD_COLORS.green;
            }
        }

        if (cfg.glowColor) {
            const rgb = this._parseCSSColor(cfg.glowColor);
            if (rgb) {
                const [gr, gg, gb] = rgb;
                themeColors = Object.assign({}, themeColors, {
                    head: `#${gr.toString(16).padStart(2,'0')}${gg.toString(16).padStart(2,'0')}${gb.toString(16).padStart(2,'0')}`,
                    glow: `rgba(${gr},${gg},${gb},`,
                });
            } else {
                console.warn(`DigitalRain: unrecognised glowColor "${cfg.glowColor}", using theme glow`);
            }
        }

        const greenLUT = new Array(256);
        for (let v = 0; v < 256; v++) greenLUT[v] = colorFn(v);
        return { greenLUT, themeColors };
    }

    _mount() {
        const el = this._el, cfg = this._cfg;
        if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';

        if (cfg.hideChildren) {
            el.style.backgroundColor = cfg.bgColor;
            for (const child of el.children) {
                child.dataset._drainVis = child.style.visibility || '';
                child.style.visibility = 'hidden';
            }
            this._childrenHidden = true;
        }

        this._canvas = document.createElement('canvas');
        const rect   = el.getBoundingClientRect();
        this._canvas.width  = rect.width  || el.offsetWidth  || el.clientWidth  || window.innerWidth;
        this._canvas.height = rect.height || el.offsetHeight || el.clientHeight || window.innerHeight;

        Object.assign(this._canvas.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '9999',
            opacity: cfg.opacity != null ? cfg.opacity : 1,
        });

        el.appendChild(this._canvas);

        // tapToBurst stays on main thread — posts a message to worker
        this._boundTap = this._handleTap.bind(this);
        if (cfg.tapToBurst) {
            this._canvas.style.pointerEvents = 'auto';
            this._canvas.addEventListener('click',      this._boundTap);
            this._canvas.addEventListener('touchstart', this._boundTap, { passive: true });
        }

        window.addEventListener('resize', this._onResize, { passive: true });

        // Resolve theme/glowColor on main thread (needs DOM), then send to worker
        const { greenLUT, themeColors } = this._resolveTheme(cfg);
        const workerCfg = Object.assign({}, cfg, { greenLUT, themeColors });
        delete workerCfg.on; // Functions are not transferable

        const blob   = new Blob([_WORKER_SRC], { type: 'application/javascript' });
        const url    = URL.createObjectURL(blob);
        this._worker = new Worker(url);
        URL.revokeObjectURL(url);

        this._worker.onmessage = (e) => this._onWorkerMessage(e);

        // Transfer canvas control to worker — main thread can no longer draw to it
        const offscreen = this._canvas.transferControlToOffscreen();
        this._worker.postMessage({ type: 'init', payload: { canvas: offscreen, cfg: workerCfg } }, [offscreen]);
        this._worker.postMessage({ type: 'start' });
    }

    _unmount() {
        if (this._fadeOutRaf) { cancelAnimationFrame(this._fadeOutRaf); this._fadeOutRaf = null; }
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
        if (this._canvas) {
            if (this._boundTap) {
                this._canvas.removeEventListener('click',      this._boundTap);
                this._canvas.removeEventListener('touchstart', this._boundTap);
            }
            this._canvas.remove();
            this._canvas = null;
        }
        if (this._childrenHidden) {
            this._el.style.backgroundColor = '';
            for (const child of this._el.children) {
                child.style.visibility = child.dataset._drainVis || '';
                delete child.dataset._drainVis;
            }
            this._childrenHidden = false;
        }
        this._paused = false;
        this._emit('stop');
    }

    _handleResize() {
        if (!this._canvas || !this._worker) return;
        const rect = this._el.getBoundingClientRect();
        const w = rect.width  || this._el.offsetWidth  || this._el.clientWidth  || window.innerWidth;
        const h = rect.height || this._el.offsetHeight || this._el.clientHeight || window.innerHeight;
        // OffscreenCanvas size is controlled via worker message — can't set it from main thread
        this._post('resize', { width: w, height: h });
    }

    _handleTap(e) {
        if (!this._cfg.burst) return;
        const rect    = this._canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const col = Math.floor((clientX - rect.left) / this._cfg.fontSize);
        const row = Math.floor((clientY - rect.top)  / this._cfg.fontSize);
        this._post('triggerBurst', { col, epicenterRow: Math.max(0, row) });
    }

    _onWorkerMessage(e) {
        const { type, payload } = e.data;
        if (type === 'event') {
            this._emit(payload.name, payload.data);
        } else if (type === 'stats') {
            const cb = this._statsCallbacks.get(payload.id);
            if (cb) { this._statsCallbacks.delete(payload.id); cb(payload); }
        }
    }
}

DigitalRain._registry = new Map();