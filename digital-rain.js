/**
 * digital-rain.js
 * Digital rain with concentric ripple burst effects.
 * Only the container is required. Everything else is optional.
 */

class DigitalRain {
    constructor(container, options = {}) {
        this._el = typeof container === 'string'
            ? document.querySelector(container) : container;
        if (!this._el) throw new Error(`DigitalRain: element not found — "${container}"`);

        this._cfg       = Object.assign({}, DigitalRain.DEFAULTS, options);
        this._canvas    = null;
        this._ctx       = null;
        this._rafId     = null;
        this._startTimer= null;
        this._frameCount= 0;
        this._running   = false;
        this._CHARS     = this._cfg.chars.split('');
        this._boundDraw = null;
        this._cols      = [];

        this._burstActive      = false;
        this._burstFramesLeft  = 0;
        this._burstTotalFrames = 0;
        this._nextBurstFrame   = 0;
        this._burstEpicenter   = -1;
        this._burstEpicenterRow = -1;
        this._burstRadius      = 0;

        // Cached derived values — computed once in _mount
        this._speedMult    = 1;
        this._fastThresh   = 0;
        this._bellDenom    = 0;
        this._sigDenom     = 0;
        this._fontStr      = '';
        this._ringFronts   = null; // reused Float32Array

        this._onResize = this._handleResize.bind(this);
    }

    start() {
        if (this._running) return;
        this._running = true;
        const ms = (this._cfg.startDelay || 0) * 1000;
        if (ms > 0) this._startTimer = setTimeout(() => this._mount(), ms);
        else        this._mount();
    }

    stop() {
        if (!this._running) return;
        this._running = false;
        clearTimeout(this._startTimer);
        this._unmount();
        window.removeEventListener('resize', this._onResize);
    }

    destroy() { this.stop(); }

    triggerBurst(col) {
        if (!this._cfg.burst || !this._cols.length) return;
        const cfg = this._cfg;
        this._burstActive      = true;
        this._burstTotalFrames = Math.round(
            (cfg.burstDurationMin + Math.random() * (cfg.burstDurationMax - cfg.burstDurationMin)) * 60
        );
        this._burstFramesLeft = this._burstTotalFrames;
        this._burstEpicenter  = col != null
            ? Math.max(0, Math.min(this._cols.length - 1, col | 0))
            : Math.random() * this._cols.length | 0;
        this._burstEpicenterRow = this._canvas
            ? Math.floor(this._canvas.height / this._cfg.fontSize * Math.random())
            : 20;
        this._burstRadius = 3;
    }

    configure(o) {
        const prevSpeed = this._cfg.dropSpeed;
        Object.assign(this._cfg, o);
        if (this._canvas) {
            this._computeCached();
            // If dropSpeed changed, recompute speed/steps on all existing streams
            // so frozen streams (speed=999) wake up immediately
            if (o.dropSpeed !== undefined && o.dropSpeed !== prevSpeed) {
                for (const col of this._cols) {
                    for (const st of col.streams) {
                        st.speed = this._makeFrameSkip();
                        st.steps = this._makeSteps(st.speed);
                    }
                }
            }
        }
    }

    static get DEFAULTS() {
        return {
            startDelay:      0,
            fontSize:        14,
            bgColor:         '#050505',
            glowAlpha:       0.6,
            fontFamily:      '"Share Tech Mono", "Courier New", monospace',
            chars:           'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',

            // 0=frozen, 1=barely moving, 50=default, 100=fastest
            dropSpeed:       99,

            // Speed tiers: frameSkip (lower=faster), weight (relative probability)
            speedTiers: [
                { frameSkip: 2,  weight: 50 },
                { frameSkip: 4,  weight: 42 },
                { frameSkip: 10, weight: 4  },
                { frameSkip: 13, weight: 4  },
            ],

            // 0=never dual streams, 100=very frequent
            dualFrequency:   50,
            dualMinGap:      10,

            trailLengthFast: 28,
            trailLengthSlow: 70,

            burst:              true,
            burstDurationMin:   3,
            burstDurationMax:   7,
            burstIntervalMin:   30,
            burstIntervalMax:   60,
            burstFirstMin:      20,
            burstFirstMax:      40,
            burstExpansionRate: 0.45,
            burstNumRings:      4,
            burstRingGap:       6,
            burstBellWidth:     3,
            burstDissipate:     0.014,
            burstAmplify:       2.5,
            burstEpicenterSigma:3,
            burstEpicenterBoost:0.9,
        };
    }

    // ── Helpers (called rarely, not per-frame) ────────────────────────────

    _computeCached() {
        const cfg = this._cfg;
        const s   = cfg.dropSpeed;
        this._speedMult  = s <= 0 ? 999 : s >= 100 ? 1 : Math.round(1 + (99 - s) / 99 * 59);
        this._fastThresh = cfg.speedTiers[0].frameSkip * this._speedMult * 1.5;
        this._bellDenom  = 2 * cfg.burstBellWidth * cfg.burstBellWidth / 4;
        this._sigDenom   = 2 * cfg.burstEpicenterSigma * cfg.burstEpicenterSigma;
        this._fontStr    = `${cfg.fontSize}px ${cfg.fontFamily}`;
        this._ringFronts = new Float32Array(cfg.burstNumRings);

        // Pre-build green color LUT: index 0–255 → 'rgb(0,g,0)' string
        // Avoids template string allocation for every trail entry every frame
        this._greenLUT = new Array(256);
        for (let g = 0; g < 256; g++) this._greenLUT[g] = `rgb(0,${g},0)`;
    }

    _makeFrameSkip() {
        const tiers = this._cfg.speedTiers;
        const mult  = this._speedMult;
        let total = 0;
        for (let i = 0; i < tiers.length; i++) total += tiers[i].weight;
        let r = Math.random() * total;
        for (let i = 0; i < tiers.length; i++) {
            r -= tiers[i].weight;
            if (r <= 0) return Math.max(1, tiers[i].frameSkip * mult);
        }
        return Math.max(1, tiers[tiers.length - 1].frameSkip * mult);
    }

    _makeSteps(frameSkip) {
        const cfg     = this._cfg;
        const tiers   = cfg.speedTiers;
        const minSkip = tiers[0].frameSkip * this._speedMult;
        const maxSkip = tiers[tiers.length - 1].frameSkip * this._speedMult;
        const ratio   = maxSkip === minSkip ? 0 : Math.min(1, (frameSkip - minSkip) / (maxSkip - minSkip));
        return Math.round(cfg.trailLengthFast + (cfg.trailLengthSlow - cfg.trailLengthFast) * ratio);
    }

    _makeStream(delayMax) {
        const speed = this._makeFrameSkip();
        return { row: 0, speed, steps: this._makeSteps(speed),
                 delay: Math.random() * (delayMax ?? 60) | 0,
                 trails: [], active: true, suppressTicks: 0 };
    }

    _makeSecondStream(primarySpeed, delayMax) {
        return { row: 0, speed: primarySpeed, steps: this._makeSteps(primarySpeed),
                 delay: Math.random() * (delayMax ?? 30) | 0,
                 trails: [], active: true, suppressTicks: 0 };
    }

    _dualCooldown() {
        const f = this._cfg.dualFrequency;
        if (f <= 0) return 999999;
        const min = 10 + (100 - f) / 100 * 190 | 0;
        const max = min + (20 + (100 - f) / 100 * 180 | 0);
        return min + (Math.random() * (max - min) | 0);
    }

    // ── Mount / unmount ───────────────────────────────────────────────────

    _mount() {
        const el = this._el, cfg = this._cfg;
        if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';

        this._canvas = document.createElement('canvas');
        const rect   = el.getBoundingClientRect();
        this._canvas.width  = rect.width  || el.offsetWidth  || el.clientWidth  || window.innerWidth;
        this._canvas.height = rect.height || el.offsetHeight || el.clientHeight || window.innerHeight;

        Object.assign(this._canvas.style, {
            position: 'absolute', top: '0', left: '0',
            width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: '9999',
        });

        el.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        this._computeCached();
        this._initColumns();

        if (cfg.burst) {
            this._nextBurstFrame = Math.round(
                (cfg.burstFirstMin + Math.random() * (cfg.burstFirstMax - cfg.burstFirstMin)) * 60
            );
        }

        this._boundDraw = this._drawFrame.bind(this);
        window.addEventListener('resize', this._onResize, { passive: true });
        this._rafId = requestAnimationFrame(this._boundDraw);
    }

    _unmount() {
        if (this._rafId)  { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._canvas) { this._canvas.remove(); this._canvas = null; this._ctx = null; }
        this._cols = []; this._frameCount = 0;
        this._burstActive = false; this._burstTotalFrames = 0;
        this._burstEpicenter = -1; this._burstEpicenterRow = -1; this._burstRadius = 0;
    }

    _initColumns() {
        const n = Math.floor(this._canvas.width / this._cfg.fontSize);
        this._cols = Array.from({ length: n }, () => ({
            streams:  [ this._makeStream(60) ],
            spawnCD:  this._dualCooldown(),
            // Two plain objects swapped each frame as rowMap/prevRows — no allocation
            mapA:     Object.create(null),
            mapB:     Object.create(null),
            useA:     true,
        }));
    }

    _handleResize() {
        if (!this._canvas) return;
        const rect = this._el.getBoundingClientRect();
        this._canvas.width  = rect.width  || this._el.offsetWidth  || this._el.clientWidth  || window.innerWidth;
        this._canvas.height = rect.height || this._el.offsetHeight || this._el.clientHeight || window.innerHeight;
        this._computeCached();
        this._initColumns();
    }

    // ── Draw ──────────────────────────────────────────────────────────────

    _drawFrame() {
        if (!this._ctx || !this._canvas) return;
        this._frameCount++;

        const cfg        = this._cfg;
        const ctx        = this._ctx;
        const CHARS      = this._CHARS;
        const maxRow     = Math.floor(this._canvas.height / cfg.fontSize);
        const numCols    = this._cols.length;
        const fw         = cfg.fontSize;
        const bgColor    = cfg.bgColor;
        const bellDenom  = this._bellDenom;
        const sigDenom   = this._sigDenom;
        const fastThresh = this._fastThresh;
        const minGap     = cfg.dualMinGap;
        const fc         = this._frameCount;

        // ── Burst ──────────────────────────────────────────────────────────
        if (cfg.burst && !this._burstActive && fc >= this._nextBurstFrame) {
            this.triggerBurst();
        }
        if (this._burstActive) {
            this._burstRadius = (this._burstTotalFrames - this._burstFramesLeft) * cfg.burstExpansionRate;
            if (--this._burstFramesLeft <= 0) {
                this._burstActive = false; this._burstTotalFrames = 0;
                this._burstEpicenter = -1; this._burstEpicenterRow = -1; this._burstRadius = 0;
                this._nextBurstFrame = fc + Math.round(
                    (cfg.burstIntervalMin + Math.random() * (cfg.burstIntervalMax - cfg.burstIntervalMin)) * 60
                );
            }
        }

        // Pre-compute burst ring fronts once per frame
        const burstActive       = this._burstActive;
        const burstEpicenter    = this._burstEpicenter;
        const burstEpicenterRow = this._burstEpicenterRow;
        const numRings       = cfg.burstNumRings;
        const bellWidth3     = cfg.burstBellWidth * 3;
        const dissipate      = cfg.burstDissipate;
        const amplify        = cfg.burstAmplify;
        const epicBoost      = cfg.burstEpicenterBoost;
        let decay = 0;

        if (burstActive) {
            const elapsed = this._burstTotalFrames - this._burstFramesLeft;
            decay = Math.max(0, 1 - (elapsed / this._burstTotalFrames) * 1.2);
            const rf = this._ringFronts;
            const rg = cfg.burstRingGap;
            const br = this._burstRadius;
            for (let r = 0; r < numRings; r++) rf[r] = br - r * rg;
        }

        ctx.font = this._fontStr; // set once per frame
        const greenLUT = this._greenLUT;
        const glowLUT  = `rgba(0,255,0,${cfg.glowAlpha})`; // cached no-burst glow

        for (let i = 0; i < numCols; i++) {
            const col = this._cols[i];
            const x   = i * fw;

            // ── Ripple intensity ───────────────────────────────────────────
            let bIntens = 0;
            if (burstActive && burstEpicenter >= 0) {
                const rf   = this._ringFronts;
                const dist = i > burstEpicenter ? i - burstEpicenter : burstEpicenter - i;
                for (let r = 0; r < numRings; r++) {
                    const rr = rf[r];
                    if (rr < 0) continue;
                    const passed = rr - dist;
                    if (passed >= 0 && passed < bellWidth3) {
                        const bell = Math.exp(-(passed * passed) / bellDenom);
                        const str  = (1 - r * 0.2) * Math.max(0, 1 - rr * dissipate);
                        if (bell * str > bIntens) bIntens = bell * str;
                    }
                }
                const cb = Math.exp(-(dist * dist) / sigDenom) * decay * epicBoost;
                bIntens += cb;
                if (bIntens > 1 / amplify) bIntens = bIntens * amplify;
                if (bIntens > 1) bIntens = 1;
            }

            const rb        = bIntens * 230 | 0;
            const glowAlpha = cfg.glowAlpha + bIntens * 0.5;

            // ── Try to spawn second stream ─────────────────────────────────
            if (cfg.dualFrequency > 0 && col.streams.length === 1 && col.streams[0].active
                && col.streams[0].speed <= fastThresh) {
                if (--col.spawnCD <= 0) {
                    if (col.streams[0].row > minGap * 2) {
                        col.streams.push(this._makeSecondStream(col.streams[0].speed, 30));
                    }
                    col.spawnCD = this._dualCooldown();
                }
            }

            // ── STEP 1: Advance state ──────────────────────────────────────
            for (let s = 0; s < col.streams.length; s++) {
                const st = col.streams[s];
                if (!st.active || fc % st.speed !== 0) continue;
                if (st.delay > 0) { st.delay--; continue; }

                if (col.streams.length > 1) {
                    let tooClose = false;
                    for (let o = 0; o < col.streams.length; o++) {
                        if (o === s) continue;
                        const diff = st.row - col.streams[o].row;
                        if (col.streams[o].active && diff < minGap && diff > -minGap) { tooClose = true; break; }
                    }
                    if (tooClose) { if (++st.suppressTicks > 120) st.active = false; continue; }
                }
                st.suppressTicks = 0;

                const trails = st.trails;
                if (st.row < maxRow) {
                    for (let t = 0; t < trails.length; t++) trails[t].brightness--;
                    for (let t = trails.length - 1; t >= 0; t--) {
                        if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
                    }
                    trails.push({ row: st.row, char: CHARS[Math.random() * CHARS.length | 0], brightness: st.steps + 6 });
                    st.row++;
                } else {
                    st.active = false;
                    for (let t = 0; t < trails.length; t++) trails[t].brightness--;
                    for (let t = trails.length - 1; t >= 0; t--) {
                        if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
                    }
                }
            }

            // Fade inactive streams
            for (let s = 0; s < col.streams.length; s++) {
                const st = col.streams[s];
                if (st.active || fc % st.speed !== 0) continue;
                const trails = st.trails;
                for (let t = 0; t < trails.length; t++) trails[t].brightness--;
                for (let t = trails.length - 1; t >= 0; t--) {
                    if (trails[t].brightness <= 0) { trails[t] = trails[trails.length - 1]; trails.pop(); }
                }
            }

            for (let s = col.streams.length - 1; s >= 0; s--) {
                if (!col.streams[s].active && col.streams[s].trails.length === 0) col.streams.splice(s, 1);
            }
            if (col.streams.length === 0) col.streams.push(this._makeStream(Math.random() * 60 | 0));
        }

        // ── STEP 2: Per-cell render with Uint8Array row tracking ───────────
        for (let i = 0; i < numCols; i++) {
            const col     = this._cols[i];
            const x       = i * fw;

            if (!col.curRows)  col.curRows  = new Uint8Array(maxRow);
            if (!col.prevRows) col.prevRows = new Uint8Array(maxRow);

            col.curRows.fill(0);
            for (let s = 0; s < col.streams.length; s++) {
                const trails = col.streams[s].trails;
                for (let t = 0; t < trails.length; t++) {
                    const r = trails[t].row;
                    if (r < maxRow) col.curRows[r] = 1;
                }
            }

            ctx.fillStyle = bgColor;
            for (let r = 0; r < maxRow; r++) {
                if (col.prevRows[r] && !col.curRows[r]) ctx.fillRect(x, r * fw, fw, fw);
            }

            const colDist = burstActive && burstEpicenter >= 0
                ? (i > burstEpicenter ? i - burstEpicenter : burstEpicenter - i)
                : 0;

            for (let s = 0; s < col.streams.length; s++) {
                const st      = col.streams[s];
                const trails  = st.trails;
                const headIdx = st.active ? trails.length - 1 : -1;

                for (let t = 0; t < trails.length; t++) {
                    const e  = trails[t];
                    const cy = e.row * fw;

                    // Per-entry 2D bIntens
                    let bIntens = 0;
                    if (burstActive && burstEpicenter >= 0) {
                        const rf      = this._ringFronts;
                        const rowDist = e.row > burstEpicenterRow
                            ? e.row - burstEpicenterRow : burstEpicenterRow - e.row;
                        const dist2d  = Math.sqrt(colDist * colDist + rowDist * rowDist);
                        for (let r = 0; r < numRings; r++) {
                            const rr = rf[r];
                            if (rr < 0) continue;
                            const passed = rr - dist2d;
                            if (passed >= 0 && passed < bellWidth3) {
                                const bell = Math.exp(-(passed * passed) / bellDenom);
                                const str  = (1 - r * 0.2) * Math.max(0, 1 - rr * dissipate);
                                if (bell * str > bIntens) bIntens = bell * str;
                            }
                        }
                        const cb = Math.exp(-(dist2d * dist2d) / sigDenom) * decay * epicBoost;
                        bIntens += cb;
                        if (bIntens > 1 / amplify) bIntens = bIntens * amplify;
                        if (bIntens > 1) bIntens = 1;
                    }

                    const rb        = bIntens * 230 | 0;
                    const glowAlpha = cfg.glowAlpha + bIntens * 0.5;

                    ctx.fillStyle = bgColor;
                    ctx.fillRect(x, cy, fw, fw);

                    if (t === headIdx) {
                        ctx.fillRect(x - 1, cy - 1, fw + 2, fw + 2);
                        if (bIntens > 0) {
                            ctx.fillStyle = `rgba(${rb},255,${rb},${glowAlpha})`;
                            ctx.fillText(e.char, x - 1, cy + fw - 2);
                            ctx.fillText(e.char, x + 1, cy + fw - 2);
                            ctx.fillText(e.char, x,     cy + fw - 3);
                            ctx.fillText(e.char, x,     cy + fw - 1);
                            ctx.fillStyle = `rgb(${rb},255,${rb})`;
                        } else {
                            ctx.fillStyle = glowLUT;
                            ctx.fillText(e.char, x - 1, cy + fw - 2);
                            ctx.fillText(e.char, x + 1, cy + fw - 2);
                            ctx.fillText(e.char, x,     cy + fw - 3);
                            ctx.fillText(e.char, x,     cy + fw - 1);
                            ctx.fillStyle = '#00ff41';
                        }
                        ctx.fillText(e.char, x, cy + fw - 2);
                    } else {
                        const cl1    = e.brightness / st.steps;
                        const cl     = cl1 > 1 ? 1 : cl1;
                        if (bIntens > 0) {
                            const base_g = cl * cl * 255 | 0;
                            const g      = base_g + (bIntens * 220 | 0);
                            const trb    = bIntens * cl * 230 | 0;
                            ctx.fillStyle = `rgb(${trb},${g > 255 ? 255 : g},${trb})`;
                        } else {
                            ctx.fillStyle = greenLUT[cl * cl * 255 | 0];
                        }
                        ctx.fillText(e.char, x, cy + fw - 2);
                    }
                }
            }

            const tmp    = col.prevRows;
            col.prevRows = col.curRows;
            col.curRows  = tmp;
        }

        this._rafId = requestAnimationFrame(this._boundDraw);
    }
}