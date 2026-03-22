/**
 * digital-rain.js
 * Digital rain with concentric ripple burst effects.
 *
 * Only the container is required. Everything else is optional.
 *
 * Usage:
 *   const rain = new DigitalRain('#my-div');
 *   rain.start();
 *
 * With options:
 *   const rain = new DigitalRain('#my-div', {
 *     startDelay:       5,      // seconds before rain starts (default: 0)
 *     burst:            true,   // enable ripple bursts (default: true)
 *     burstDurationMin: 3,      // seconds
 *     burstDurationMax: 7,
 *     burstIntervalMin: 30,     // seconds between bursts
 *     burstIntervalMax: 90,
 *   });
 */

class DigitalRain {
    // ─────────────────────────────────────────────────────────────────────
    // Required: container (CSS selector or DOM element)
    // Optional: config object — all keys have defaults
    // ─────────────────────────────────────────────────────────────────────
    constructor(container, options = {}) {
        this._el = typeof container === 'string'
            ? document.querySelector(container)
            : container;

        if (!this._el) throw new Error(`DigitalRain: element not found — "${container}"`);

        // Merge user options with defaults
        this._cfg = Object.assign({}, DigitalRain.DEFAULTS, options);

        // Internal state
        this._canvas          = null;
        this._ctx             = null;
        this._rafId           = null;
        this._startTimer      = null;
        this._frameCount      = 0;
        this._running         = false;
        this._CHARS           = this._cfg.chars.split('');

        // Rain arrays
        this._columns = [];
        this._speeds  = [];
        this._steps   = [];
        this._delays  = [];
        this._trails  = [];

        // Burst state
        this._burstActive      = false;
        this._burstFramesLeft  = 0;
        this._burstTotalFrames = 0;
        this._nextBurstFrame   = 0;
        this._burstEpicenter   = -1;
        this._burstRadius      = 0;

        this._onResize = this._handleResize.bind(this);
    }

    // ── Public API ────────────────────────────────────────────────────────

    /** Start the rain (respects startDelay option). */
    start() {
        if (this._running) return;
        this._running = true;

        const delay = (this._cfg.startDelay || 0) * 1000;
        if (delay > 0) {
            this._startTimer = setTimeout(() => this._mount(), delay);
        } else {
            this._mount();
        }
    }

    /** Stop and remove the canvas. */
    stop() {
        if (!this._running) return;
        this._running = false;
        clearTimeout(this._startTimer);
        this._unmount();
        window.removeEventListener('resize', this._onResize);
    }

    /** Alias for stop(). */
    destroy() { this.stop(); }

    /** Manually fire a burst. Optionally pass a column index as epicenter. */
    triggerBurst(epicenterCol) {
        if (!this._cfg.burst) return;
        const cols = this._columns.length;
        if (cols === 0) return;
        const cfg = this._cfg;
        this._burstActive      = true;
        this._burstTotalFrames = Math.round(
            (cfg.burstDurationMin + Math.random() * (cfg.burstDurationMax - cfg.burstDurationMin)) * 60
        );
        this._burstFramesLeft  = this._burstTotalFrames;
        this._burstEpicenter   = epicenterCol != null
            ? Math.max(0, Math.min(cols - 1, epicenterCol | 0))
            : Math.random() * cols | 0;
        this._burstRadius = 0;
    }

    /** Update any config option live. */
    configure(options) { Object.assign(this._cfg, options); }

    // ── Defaults ──────────────────────────────────────────────────────────

    static get DEFAULTS() {
        return {
            // ── Startup ───────────────────────────────────────────────────
            startDelay:         0,           // seconds before rain starts

            // ── Rain appearance ───────────────────────────────────────────
            fontSize:           14,
            bgColor:            '#050505',
            glowAlpha:          0.6,
            fontFamily:         '"Share Tech Mono", "Courier New", monospace',
            chars:              'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF',

            // ── Rain speed ────────────────────────────────────────────────
            fastSpeedMin:       4,
            fastSpeedMax:       8,
            slowSpeedMin:       12,
            slowSpeedMax:       18,
            slowColumnFraction: 0.2,
            trailLengthFast:    28,
            trailLengthSlow:    70,

            // ── Burst / ripple ─────────────────────────────────────────────
            burst:              true,        // enable/disable bursts entirely
            burstDurationMin:   3,           // seconds
            burstDurationMax:   7,
            burstIntervalMin:   120,         // seconds between bursts
            burstIntervalMax:   300,
            burstFirstMin:      30,          // seconds before first burst
            burstFirstMax:      90,

            // Advanced burst shape (fine-tuning)
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

    // ── Private ───────────────────────────────────────────────────────────

    _mount() {
        const el  = this._el;
        const cfg = this._cfg;

        // Ensure container is positioned so absolute canvas child works
        if (window.getComputedStyle(el).position === 'static') {
            el.style.position = 'relative';
        }

        this._canvas = document.createElement('canvas');
        const rect   = el.getBoundingClientRect();
        this._canvas.width  = rect.width  || el.offsetWidth;
        this._canvas.height = rect.height || el.offsetHeight;

        Object.assign(this._canvas.style, {
            position:      'absolute',
            top:           '0',
            left:          '0',
            width:         '100%',
            height:        '100%',
            pointerEvents: 'none',
            zIndex:        '9999',    // sits above text content
        });

        el.appendChild(this._canvas);
        this._ctx = this._canvas.getContext('2d');

        this._initColumns();

        // Schedule first burst
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
        this._columns = []; this._speeds = []; this._steps = [];
        this._delays  = []; this._trails = [];
        this._frameCount       = 0;
        this._burstActive      = false;
        this._burstTotalFrames = 0;
        this._burstEpicenter   = -1;
        this._burstRadius      = 0;
    }

    _initColumns() {
        const cfg  = this._cfg;
        const cols = Math.floor(this._canvas.width / cfg.fontSize);

        this._columns = Array.from({ length: cols }, () => 0);
        this._speeds  = Array.from({ length: cols }, () =>
            Math.random() < cfg.slowColumnFraction
                ? cfg.slowSpeedMin + (Math.random() * (cfg.slowSpeedMax - cfg.slowSpeedMin) | 0)
                : cfg.fastSpeedMin + (Math.random() * (cfg.fastSpeedMax - cfg.fastSpeedMin) | 0)
        );
        this._delays = Array.from({ length: cols }, () => Math.random() * 60 | 0);
        this._steps  = this._speeds.map(s =>
            Math.round(cfg.trailLengthFast + (cfg.trailLengthSlow - cfg.trailLengthFast) *
                (s - cfg.fastSpeedMin) / (cfg.slowSpeedMax - cfg.fastSpeedMin))
        );
        this._trails = Array.from({ length: cols }, () => []);
    }

    _handleResize() {
        if (!this._canvas) return;
        const rect = this._el.getBoundingClientRect();
        this._canvas.width  = rect.width  || this._el.offsetWidth;
        this._canvas.height = rect.height || this._el.offsetHeight;
        this._initColumns();
    }

    _drawFrame() {
        if (!this._ctx || !this._canvas) return;
        this._frameCount++;

        const cfg     = this._cfg;
        const ctx     = this._ctx;
        const CHARS   = this._CHARS;
        const maxRow  = Math.floor(this._canvas.height / cfg.fontSize);
        const numCols = this._columns.length;

        // ── Burst scheduling ───────────────────────────────────────────────
        if (cfg.burst && !this._burstActive && this._frameCount >= this._nextBurstFrame) {
            this.triggerBurst();
        }

        if (this._burstActive) {
            this._burstRadius = (this._burstTotalFrames - this._burstFramesLeft) * cfg.burstExpansionRate;
            this._burstFramesLeft--;
            if (this._burstFramesLeft <= 0) {
                this._burstActive      = false;
                this._burstTotalFrames = 0;
                this._burstEpicenter   = -1;
                this._burstRadius      = 0;
                this._nextBurstFrame   = this._frameCount + Math.round(
                    (cfg.burstIntervalMin + Math.random() * (cfg.burstIntervalMax - cfg.burstIntervalMin)) * 60
                );
            }
        }

        // ── Per-column render ──────────────────────────────────────────────
        for (let i = 0; i < numCols; i++) {

            // Ripple intensity for this column
            let bIntens = 0;
            if (this._burstActive && this._burstEpicenter >= 0) {
                const dist = Math.abs(i - this._burstEpicenter);

                for (let r = 0; r < cfg.burstNumRings; r++) {
                    const ringRadius = this._burstRadius - r * cfg.burstRingGap;
                    if (ringRadius < 0) continue;
                    const passed = ringRadius - dist;
                    if (passed >= 0 && passed < cfg.burstBellWidth * 3) {
                        const bw   = cfg.burstBellWidth;
                        const bell = Math.exp(-(passed * passed) / (2 * bw * bw / 4));
                        const str  = (1 - r * 0.2) * Math.max(0, 1 - ringRadius * cfg.burstDissipate);
                        bIntens = Math.max(bIntens, bell * str);
                    }
                }

                // Epicenter lingers bright
                const elapsed     = this._burstTotalFrames - this._burstFramesLeft;
                const decay       = Math.max(0, 1 - (elapsed / this._burstTotalFrames) * 1.2);
                const sig         = cfg.burstEpicenterSigma;
                const centerBoost = Math.exp(-(dist * dist) / (2 * sig * sig)) * decay * cfg.burstEpicenterBoost;
                bIntens = Math.min(1, (bIntens + centerBoost) * cfg.burstAmplify);
            }

            const spd = this._speeds[i];
            if (this._frameCount % spd !== 0) continue;

            const x      = i * cfg.fontSize;
            const ISTEPS = this._steps[i] ?? cfg.trailLengthFast;

            if (this._delays[i] > 0) { this._delays[i]--; continue; }

            const row = this._columns[i];

            if (row < maxRow) {
                const hy   = row * cfg.fontSize;
                const char = CHARS[Math.random() * CHARS.length | 0];

                this._trails[i].push({ row, char, brightness: ISTEPS + 6 });
                this._columns[i]++;

                // Fade trail entries except newest
                for (let t = this._trails[i].length - 2; t >= 0; t--) {
                    const entry = this._trails[i][t];
                    entry.brightness--;
                    const cy = entry.row * cfg.fontSize;
                    ctx.fillStyle = cfg.bgColor;
                    ctx.fillRect(x, cy, cfg.fontSize, cfg.fontSize);
                    if (entry.brightness > 0) {
                        const ratio  = Math.min(entry.brightness, ISTEPS) / ISTEPS;
                        const base_g = Math.floor(Math.pow(ratio, 1.8) * 255);
                        const boost  = bIntens * 220;
                        const g      = Math.min(255, base_g + boost);
                        const rb     = Math.floor(bIntens * ratio * 230);
                        ctx.fillStyle = `rgb(${rb},${g},${rb})`;
                        ctx.font = `${cfg.fontSize}px ${cfg.fontFamily}`;
                        ctx.fillText(entry.char, x, cy + cfg.fontSize - 2);
                    }
                    if (entry.brightness <= 0) this._trails[i].splice(t, 1);
                }

                // Draw head
                const rb        = Math.floor(bIntens * 230);
                const headColor = `rgb(${rb},255,${rb})`;
                const glowAlpha = cfg.glowAlpha + bIntens * 0.5;
                const glowColor = `rgba(${rb},255,${rb},${glowAlpha})`;

                ctx.fillStyle = cfg.bgColor;
                ctx.fillRect(x, hy, cfg.fontSize, cfg.fontSize);
                ctx.fillStyle = glowColor;
                ctx.font = `${cfg.fontSize}px ${cfg.fontFamily}`;
                for (const [ox, oy] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]]) {
                    ctx.fillText(char, x + ox, hy + cfg.fontSize - 2 + oy);
                }
                ctx.fillStyle = headColor;
                ctx.fillText(char, x, hy + cfg.fontSize - 2);

            } else {
                // Column done — fade trail then reset
                for (let t = this._trails[i].length - 1; t >= 0; t--) {
                    const entry = this._trails[i][t];
                    entry.brightness--;
                    const cy = entry.row * cfg.fontSize;
                    ctx.fillStyle = cfg.bgColor;
                    ctx.fillRect(x, cy, cfg.fontSize, cfg.fontSize);
                    if (entry.brightness > 0) {
                        const ratio = Math.min(entry.brightness, ISTEPS) / ISTEPS;
                        const g     = Math.floor(Math.pow(ratio, 1.8) * 255);
                        ctx.fillStyle = `rgb(0,${g},0)`;
                        ctx.font = `${cfg.fontSize}px ${cfg.fontFamily}`;
                        ctx.fillText(entry.char, x, cy + cfg.fontSize - 2);
                    }
                    if (entry.brightness <= 0) this._trails[i].splice(t, 1);
                }
                if (this._trails[i].length === 0) {
                    this._columns[i] = 0;
                    this._delays[i]  = Math.random() * 60 | 0;
                }
            }
        }

        this._rafId = requestAnimationFrame(this._drawFrame.bind(this));
    }
}
