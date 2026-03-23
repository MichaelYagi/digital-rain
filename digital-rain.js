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
        this._boundDraw  = null; // bound once in _mount, reused every frame

        this._cols = [];

        this._burstActive      = false;
        this._burstFramesLeft  = 0;
        this._burstTotalFrames = 0;
        this._nextBurstFrame   = 0;
        this._burstEpicenter   = -1;
        this._burstRadius      = 0;

        // Reusable per-frame scratch structures — allocated once, cleared each frame
        // rowMap replaced with a flat array of {row,char,brightness,steps,isHead}
        // indexed by column; avoids Map allocation per column per frame
        this._rowBuf     = []; // reused scratch buffer per column render

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
        this._burstRadius = 3; // start non-zero for immediate visible intensity
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
            burstIntervalMin:      30,
            burstIntervalMax:      60,
            burstFirstMin:         20,
            burstFirstMax:         40,
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

        // Bind once — reused every frame instead of creating a new closure each time
        this._boundDraw = this._drawFrame.bind(this);

        // Pre-cache burst bell width squared for Math.exp — avoids recomputing every frame
        this._bellDenom = 2 * cfg.burstBellWidth * cfg.burstBellWidth / 4;
        this._sigDenom  = 2 * cfg.burstEpicenterSigma * cfg.burstEpicenterSigma;

        // Pre-cache font string — same every frame
        this._fontStr = `${cfg.fontSize}px ${cfg.fontFamily}`;

        window.addEventListener('resize', this._onResize, { passive: true });
        this._rafId = requestAnimationFrame(this._boundDraw);
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
            // prevRows as plain object acting as int set — faster than Set for small row counts
            prevRows: null,
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

        const cfg        = this._cfg;
        const ctx        = this._ctx;
        const CHARS      = this._CHARS;
        const maxRow     = Math.floor(this._canvas.height / cfg.fontSize);
        const numCols    = this._cols.length;
        const fw         = cfg.fontSize;
        const bgColor    = cfg.bgColor;
        const fontStr    = this._fontStr;
        const bellDenom  = this._bellDenom;
        const sigDenom   = this._sigDenom;

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

        // Pre-compute per-frame burst values shared across all columns
        const burstActive    = this._burstActive;
        const burstEpicenter = this._burstEpicenter;
        const burstRadius    = this._burstRadius;
        const burstTotalF    = this._burstTotalFrames;
        const burstLeftF     = this._burstFramesLeft;
        const elapsed        = burstTotalF - burstLeftF;
        const decay          = burstActive ? Math.max(0, 1 - (elapsed / burstTotalF) * 1.2) : 0;

        // Pre-compute per-ring values for burst — same for every column
        // ringFronts[r] = burstRadius - r * burstRingGap
        const numRings   = cfg.burstNumRings;
        const ringGap    = cfg.burstRingGap;
        const bellWidth3 = cfg.burstBellWidth * 3;
        const dissipate  = cfg.burstDissipate;
        const amplify    = cfg.burstAmplify;
        const epicBoost  = cfg.burstEpicenterBoost;

        // Use a typed array for ring fronts — avoids per-column recalculation
        let ringFronts;
        if (burstActive) {
            ringFronts = new Float32Array(numRings);
            for (let r = 0; r < numRings; r++) ringFronts[r] = burstRadius - r * ringGap;
        }

        ctx.font = fontStr; // set once per frame

        for (let i = 0; i < numCols; i++) {
            const col = this._cols[i];
            const x   = i * fw;

            // ── Ripple intensity ───────────────────────────────────────────
            let bIntens = 0;
            if (burstActive && burstEpicenter >= 0) {
                const dist = i > burstEpicenter ? i - burstEpicenter : burstEpicenter - i; // Math.abs inline
                for (let r = 0; r < numRings; r++) {
                    const rr = ringFronts[r];
                    if (rr < 0) continue;
                    const passed = rr - dist;
                    if (passed >= 0 && passed < bellWidth3) {
                        const bell = Math.exp(-(passed * passed) / bellDenom);
                        const str  = (1 - r * 0.2) * Math.max(0, 1 - rr * dissipate);
                        if (bell * str > bIntens) bIntens = bell * str;
                    }
                }
                const centerBoost = Math.exp(-(dist * dist) / sigDenom) * decay * epicBoost;
                bIntens = bIntens + centerBoost;
                if (bIntens > 1 / amplify) bIntens = Math.min(1, bIntens * amplify);
            }

            const rb        = bIntens * 230 | 0;
            const glowAlpha = cfg.glowAlpha + bIntens * 0.5;

            // ── Try to spawn second stream (fast columns only) ─────────────
            if (cfg.dualStreams && col.streams.length === 1 && col.streams[0].active
                && col.streams[0].speed <= cfg.fastSpeedMax) {
                if (--col.spawnCD <= 0) {
                    if (col.streams[0].row > cfg.dualStreamMinGap * 2) {
                        col.streams.push(this._makeStream(30));
                    }
                    col.spawnCD = cfg.dualStreamCooldownMin +
                        (Math.random() * (cfg.dualStreamCooldownMax - cfg.dualStreamCooldownMin) | 0);
                }
            }

            // ── STEP 1: Advance state ──────────────────────────────────────
            const fc = this._frameCount;
            for (let s = 0; s < col.streams.length; s++) {
                const st = col.streams[s];
                if (!st.active) continue;
                if (fc % st.speed !== 0) continue;
                if (st.delay > 0) { st.delay--; continue; }

                let tooClose = false;
                if (col.streams.length > 1) {
                    for (let o = 0; o < col.streams.length; o++) {
                        if (o === s) continue;
                        const diff = st.row - col.streams[o].row;
                        if (col.streams[o].active && (diff < cfg.dualStreamMinGap && diff > -cfg.dualStreamMinGap)) {
                            tooClose = true; break;
                        }
                    }
                }
                if (tooClose) {
                    if (++st.suppressTicks > 120) st.active = false;
                    continue;
                }
                st.suppressTicks = 0;

                const trails = st.trails;
                if (st.row < maxRow) {
                    // Decrement all existing entries
                    for (let t = 0; t < trails.length; t++) trails[t].brightness--;
                    // Remove expired — iterate backwards, swap with last to avoid O(n) shifts
                    for (let t = trails.length - 1; t >= 0; t--) {
                        if (trails[t].brightness <= 0) {
                            trails[t] = trails[trails.length - 1];
                            trails.pop();
                        }
                    }
                    trails.push({ row: st.row, char: CHARS[Math.random() * CHARS.length | 0], brightness: st.steps + 6 });
                    st.row++;
                } else {
                    st.active = false;
                    for (let t = 0; t < trails.length; t++) trails[t].brightness--;
                    for (let t = trails.length - 1; t >= 0; t--) {
                        if (trails[t].brightness <= 0) {
                            trails[t] = trails[trails.length - 1];
                            trails.pop();
                        }
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
                    if (trails[t].brightness <= 0) {
                        trails[t] = trails[trails.length - 1];
                        trails.pop();
                    }
                }
            }

            // Remove fully faded inactive streams
            for (let s = col.streams.length - 1; s >= 0; s--) {
                if (!col.streams[s].active && col.streams[s].trails.length === 0) col.streams.splice(s, 1);
            }
            if (col.streams.length === 0) col.streams.push(this._makeStream(Math.random() * 60 | 0));

            // ── STEP 2: Build rowMap and render ────────────────────────────
            // Use a plain object as row→entry map — faster than Map for integer keys
            const rowMap = col.rowMap || (col.rowMap = Object.create(null));
            const prevRows = col.prevRows;

            // Collect entries into rowMap
            for (let s = 0; s < col.streams.length; s++) {
                const st      = col.streams[s];
                const trails  = st.trails;
                const headIdx = st.active ? trails.length - 1 : -1;
                for (let t = 0; t < trails.length; t++) {
                    const e        = trails[t];
                    const existing = rowMap[e.row];
                    if (!existing || e.brightness > existing.brightness) {
                        // Reuse existing object to avoid allocation
                        if (existing) {
                            existing.char       = e.char;
                            existing.brightness = e.brightness;
                            existing.steps      = st.steps;
                            existing.isHead     = (t === headIdx);
                        } else {
                            rowMap[e.row] = { char: e.char, brightness: e.brightness, steps: st.steps, isHead: (t === headIdx) };
                        }
                    }
                }
            }

            // Render occupied rows
            ctx.fillStyle = bgColor;
            for (const rowKey in rowMap) {
                const row   = rowKey | 0;
                const entry = rowMap[row];
                const cy    = row * fw;

                ctx.fillRect(x, cy, fw, fw);

                if (entry.isHead) {
                    ctx.fillRect(x - 1, cy - 1, fw + 2, fw + 2);
                    ctx.fillStyle = `rgba(${rb},255,${rb},${glowAlpha})`;
                    ctx.fillText(entry.char, x - 1, cy + fw - 2);
                    ctx.fillText(entry.char, x + 1, cy + fw - 2);
                    ctx.fillText(entry.char, x,     cy + fw - 3);
                    ctx.fillText(entry.char, x,     cy + fw - 1);
                    ctx.fillStyle = `rgb(${rb},255,${rb})`;
                    ctx.fillText(entry.char, x, cy + fw - 2);
                    ctx.fillStyle = bgColor; // reset for next fillRect
                } else {
                    const ratio  = entry.brightness / entry.steps; // brightness already clamped by decay
                    const clamped = ratio > 1 ? 1 : ratio;
                    const base_g = Math.pow(clamped, 1.8) * 255 | 0;
                    const g      = base_g + (bIntens * 220 | 0);
                    const trb    = bIntens * clamped * 230 | 0;
                    ctx.fillStyle = `rgb(${trb},${g > 255 ? 255 : g},${trb})`;
                    ctx.fillText(entry.char, x, cy + fw - 2);
                    ctx.fillStyle = bgColor;
                }
            }

            // Clear rows vacated since last frame
            if (prevRows) {
                for (const rowKey in prevRows) {
                    if (!rowMap[rowKey]) {
                        ctx.fillRect(x, (rowKey | 0) * fw, fw, fw);
                    }
                }
            }

            // Swap rowMap to prevRows, clear for next frame
            // Reuse prevRows object to avoid allocation
            col.prevRows = rowMap;
            col.rowMap   = prevRows || Object.create(null);
            // Clear the old prevRows for reuse as next frame's rowMap
            if (col.rowMap) {
                for (const k in col.rowMap) delete col.rowMap[k];
            }
        }

        this._rafId = requestAnimationFrame(this._boundDraw);
    }
}