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

        this._cfg        = Object.assign({}, DigitalRain.DEFAULTS, options);
        this._canvas     = null;
        this._ctx        = null;
        this._rafId      = null;
        this._startTimer = null;
        this._frameCount = 0;
        this._running    = false;
        this._CHARS      = this._cfg.chars.split('');

        // cols[i] = { streams: [stream...], spawnCD }
        // stream  = { row, speed, steps, delay, trails[], active, suppressTicks }
        // trail   = { row, char, brightness }
        // INVARIANT: each row appears in at most ONE stream's trail array
        this._cols = [];

        this._burstActive      = false;
        this._burstFramesLeft  = 0;
        this._burstTotalFrames = 0;
        this._nextBurstFrame   = 0;
        this._burstEpicenter   = -1;
        this._burstRadius      = 0;

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
        this._burstRadius = 0;
    }

    configure(o) { Object.assign(this._cfg, o); }

    static get DEFAULTS() {
        return {
            startDelay:            0,
            fontSize:              14,
            bgColor:               '#050505',
            glowAlpha:             0.6,
            fontFamily:            '"Share Tech Mono", "Courier New", monospace',
            chars:                 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',
            fastSpeedMin:          4,
            fastSpeedMax:          8,
            slowSpeedMin:          12,
            slowSpeedMax:          18,
            slowColumnFraction:    0.2,
            trailLengthFast:       28,
            trailLengthSlow:       70,
            dualStreams:           true,
            dualStreamMinGap:      10,
            dualStreamCooldownMin: 60,
            dualStreamCooldownMax: 200,
            burst:                 true,
            burstDurationMin:      3,
            burstDurationMax:      7,
            burstIntervalMin:      120,
            burstIntervalMax:      300,
            burstFirstMin:         30,
            burstFirstMax:         90,
            burstExpansionRate:    0.45,
            burstNumRings:         4,
            burstRingGap:          6,
            burstBellWidth:        3,
            burstDissipate:        0.014,
            burstAmplify:          2.5,
            burstEpicenterSigma:   3,
            burstEpicenterBoost:   0.9,
        };
    }

    _makeSpeed() {
        const cfg = this._cfg;
        return Math.random() < cfg.slowColumnFraction
            ? cfg.slowSpeedMin + (Math.random() * (cfg.slowSpeedMax - cfg.slowSpeedMin) | 0)
            : cfg.fastSpeedMin + (Math.random() * (cfg.fastSpeedMax - cfg.fastSpeedMin) | 0);
    }

    _makeSteps(speed) {
        const cfg = this._cfg;
        return Math.round(
            cfg.trailLengthFast + (cfg.trailLengthSlow - cfg.trailLengthFast) *
            (speed - cfg.fastSpeedMin) / (cfg.slowSpeedMax - cfg.fastSpeedMin)
        );
    }

    _makeStream(delayMax) {
        const speed = this._makeSpeed();
        return {
            row: 0, speed, steps: this._makeSteps(speed),
            delay: Math.random() * (delayMax ?? 60) | 0,
            trails: [], active: true, suppressTicks: 0,
        };
    }

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
        this._initColumns();

        if (cfg.burst) {
            this._nextBurstFrame = Math.round(
                (cfg.burstFirstMin + Math.random() * (cfg.burstFirstMax - cfg.burstFirstMin)) * 60
            );
        }
        window.addEventListener('resize', this._onResize, { passive: true });
        this._rafId = requestAnimationFrame(this._drawFrame.bind(this));
    }

    _unmount() {
        if (this._rafId)  { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._canvas) { this._canvas.remove(); this._canvas = null; this._ctx = null; }
        this._cols = []; this._frameCount = 0;
        this._burstActive = false; this._burstTotalFrames = 0;
        this._burstEpicenter = -1; this._burstRadius = 0;
    }

    _initColumns() {
        const cfg = this._cfg;
        const n   = Math.floor(this._canvas.width / cfg.fontSize);
        this._cols = Array.from({ length: n }, () => ({
            streams: [ this._makeStream(60) ],
            spawnCD: cfg.dualStreamCooldownMin +
                (Math.random() * (cfg.dualStreamCooldownMax - cfg.dualStreamCooldownMin) | 0),
        }));
    }

    _handleResize() {
        if (!this._canvas) return;
        const rect = this._el.getBoundingClientRect();
        this._canvas.width  = rect.width  || this._el.offsetWidth  || this._el.clientWidth  || window.innerWidth;
        this._canvas.height = rect.height || this._el.offsetHeight || this._el.clientHeight || window.innerHeight;
        this._initColumns();
    }

    _drawFrame() {
        if (!this._ctx || !this._canvas) return;
        this._frameCount++;

        const cfg     = this._cfg;
        const ctx     = this._ctx;
        const CHARS   = this._CHARS;
        const maxRow  = Math.floor(this._canvas.height / cfg.fontSize);
        const numCols = this._cols.length;
        const fw      = cfg.fontSize;

        // ── Burst ──────────────────────────────────────────────────────────
        if (cfg.burst && !this._burstActive && this._frameCount >= this._nextBurstFrame) {
            this.triggerBurst();
        }
        if (this._burstActive) {
            this._burstRadius = (this._burstTotalFrames - this._burstFramesLeft) * cfg.burstExpansionRate;
            if (--this._burstFramesLeft <= 0) {
                this._burstActive = false; this._burstTotalFrames = 0;
                this._burstEpicenter = -1; this._burstRadius = 0;
                this._nextBurstFrame = this._frameCount + Math.round(
                    (cfg.burstIntervalMin + Math.random() * (cfg.burstIntervalMax - cfg.burstIntervalMin)) * 60
                );
            }
        }

        for (let i = 0; i < numCols; i++) {
            const col = this._cols[i];
            const x   = i * fw;

            // ── Ripple intensity ───────────────────────────────────────────
            let bIntens = 0;
            if (this._burstActive && this._burstEpicenter >= 0) {
                const dist = Math.abs(i - this._burstEpicenter);
                for (let r = 0; r < cfg.burstNumRings; r++) {
                    const rr = this._burstRadius - r * cfg.burstRingGap;
                    if (rr < 0) continue;
                    const passed = rr - dist;
                    if (passed >= 0 && passed < cfg.burstBellWidth * 3) {
                        const bw   = cfg.burstBellWidth;
                        const bell = Math.exp(-(passed * passed) / (2 * bw * bw / 4));
                        const str  = (1 - r * 0.2) * Math.max(0, 1 - rr * cfg.burstDissipate);
                        bIntens = Math.max(bIntens, bell * str);
                    }
                }
                const elapsed     = this._burstTotalFrames - this._burstFramesLeft;
                const decay       = Math.max(0, 1 - (elapsed / this._burstTotalFrames) * 1.2);
                const sig         = cfg.burstEpicenterSigma;
                const centerBoost = Math.exp(-(dist * dist) / (2 * sig * sig)) * decay * cfg.burstEpicenterBoost;
                bIntens = Math.min(1, (bIntens + centerBoost) * cfg.burstAmplify);
            }

            const rb        = Math.floor(bIntens * 230);
            const glowAlpha = cfg.glowAlpha + bIntens * 0.5;

            // Try to spawn second stream — only on fast columns to avoid slow-drop artifacts
            if (cfg.dualStreams && col.streams.length === 1 && col.streams[0].active
                && col.streams[0].speed <= cfg.fastSpeedMax) {
                col.spawnCD--;
                if (col.spawnCD <= 0) {
                    if (col.streams[0].row > cfg.dualStreamMinGap * 2) {
                        col.streams.push(this._makeStream(30));
                    }
                    col.spawnCD = cfg.dualStreamCooldownMin +
                        (Math.random() * (cfg.dualStreamCooldownMax - cfg.dualStreamCooldownMin) | 0);
                }
            }

            // ── STEP 1: Advance state (gated on speed) ─────────────────────
            // Only move heads forward — do NOT draw anything yet
            for (let s = 0; s < col.streams.length; s++) {
                const st = col.streams[s];
                if (!st.active) continue;
                if (this._frameCount % st.speed !== 0) continue;
                if (st.delay > 0) { st.delay--; continue; }

                // Suppress if too close to other active stream
                let tooClose = false;
                for (let o = 0; o < col.streams.length; o++) {
                    if (o === s) continue;
                    if (col.streams[o].active && Math.abs(st.row - col.streams[o].row) < cfg.dualStreamMinGap) {
                        tooClose = true; break;
                    }
                }
                if (tooClose) {
                    if (++st.suppressTicks > 120) st.active = false;
                    continue;
                }
                st.suppressTicks = 0;

                if (st.row < maxRow) {
                    const char = CHARS[Math.random() * CHARS.length | 0];
                    // Decrement all existing trail entries (the previous head becomes trail)
                    for (const e of st.trails) e.brightness--;
                    // Remove expired
                    for (let t = st.trails.length - 1; t >= 0; t--) {
                        if (st.trails[t].brightness <= 0) st.trails.splice(t, 1);
                    }
                    // Push new head at full brightness
                    st.trails.push({ row: st.row, char, brightness: st.steps + 6 });
                    st.row++;
                } else {
                    st.active = false;
                    // Decrement all remaining on speed tick
                    for (const e of st.trails) e.brightness--;
                    for (let t = st.trails.length - 1; t >= 0; t--) {
                        if (st.trails[t].brightness <= 0) st.trails.splice(t, 1);
                    }
                }
            }

            // Decrement inactive stream trails on their own speed tick — matches visual fade rate
            for (const st of col.streams) {
                if (st.active) continue;
                if (this._frameCount % st.speed !== 0) continue;
                for (const e of st.trails) e.brightness--;
                for (let t = st.trails.length - 1; t >= 0; t--) {
                    if (st.trails[t].brightness <= 0) st.trails.splice(t, 1);
                }
            }

            // Remove fully faded inactive streams
            for (let s = col.streams.length - 1; s >= 0; s--) {
                if (!col.streams[s].active && col.streams[s].trails.length === 0) {
                    col.streams.splice(s, 1);
                }
            }

            // Reset column when all streams done
            if (col.streams.length === 0) {
                col.streams.push(this._makeStream(Math.random() * 60 | 0));
            }

            // ── STEP 2: Render all streams for this column ─────────────────
            const rowMap = new Map();
            for (const st of col.streams) {
                const headIdx = st.active ? st.trails.length - 1 : -1;
                for (let t = 0; t < st.trails.length; t++) {
                    const e        = st.trails[t];
                    const isHead   = (t === headIdx);
                    const existing = rowMap.get(e.row);
                    if (!existing || e.brightness > existing.brightness) {
                        rowMap.set(e.row, { char: e.char, brightness: e.brightness, steps: st.steps, isHead });
                    }
                }
            }

            for (const [row, entry] of rowMap) {
                const cy = row * fw;
                ctx.fillStyle = cfg.bgColor;
                ctx.fillRect(x, cy, fw, fw);

                if (entry.isHead) {
                    // Clear extra pixel around cell to catch halo bleed
                    ctx.fillStyle = cfg.bgColor;
                    ctx.fillRect(x - 1, cy - 1, fw + 2, fw + 2);
                    ctx.fillStyle = `rgba(${rb},255,${rb},${glowAlpha})`;
                    ctx.font = `${fw}px ${cfg.fontFamily}`;
                    for (const [ox, oy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
                        ctx.fillText(entry.char, x + ox, cy + fw - 2 + oy);
                    }
                    ctx.fillStyle = `rgb(${rb},255,${rb})`;
                    ctx.fillText(entry.char, x, cy + fw - 2);
                } else {
                    const ratio  = Math.min(entry.brightness, entry.steps) / entry.steps;
                    const base_g = Math.floor(Math.pow(ratio, 1.8) * 255);
                    const g      = Math.min(255, base_g + bIntens * 220);
                    const trb    = Math.floor(bIntens * ratio * 230);
                    ctx.fillStyle = `rgb(${trb},${g},${trb})`;
                    ctx.font = `${fw}px ${cfg.fontFamily}`;
                    ctx.fillText(entry.char, x, cy + fw - 2);
                }
            }

            if (col.prevRows) {
                for (const row of col.prevRows) {
                    if (!rowMap.has(row)) {
                        ctx.fillStyle = cfg.bgColor;
                        ctx.fillRect(x, row * fw, fw, fw);
                    }
                }
            }
            col.prevRows = new Set(rowMap.keys());
        }

        this._rafId = requestAnimationFrame(this._drawFrame.bind(this));
    }
}