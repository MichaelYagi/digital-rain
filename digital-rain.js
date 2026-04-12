/**
 * @fileoverview digital-rain.js
 * Digital rain with lightning burst effects, color themes, event callbacks, and live configuration.
 * No dependencies. Single file.
 *
 * @example
 * // Minimal usage
 * new DigitalRain('#container').start();
 *
 * @example
 * // With options
 * const rain = new DigitalRain('#container', {
 *   theme: 'blue',
 *   dropSpeed: 80,
 *   tapToBurst: true,
 * });
 * rain.start();
 */

/**
 * Digital rain animation controller.
 *
 * @class
 */
class DigitalRain {
    /**
     * Create a DigitalRain instance.
     *
     * @param {string|Element} container - CSS selector or DOM element to render into.
     * @param {object}         [options] - Configuration options. See {@link DigitalRain.OPTIONS}.
     *
     * @param {number}  [options.startDelay=0]          - Seconds before rain begins.
     * @param {number}  [options.fontSize=14]            - px — controls column width and row height.
     * @param {string}  [options.bgColor='#050505']      - Background fill color.
     * @param {number}  [options.glowAlpha=0.6]          - Glow intensity on stream heads (0–1).
     * @param {string}  [options.fontFamily]             - CSS font-family string.
     * @param {string}  [options.chars]                  - Character pool; each char used with equal probability.
     * @param {string}  [options.theme='green']          - Named theme ('green'|'red'|'blue'|'white'|'amber'),
     *                                                     hex color ('#ff00ff', '#0cf'), or any CSS color name.
     * @param {number}  [options.opacity=1]              - Canvas opacity (0–1).
     * @param {number}  [options.density=100]            - Fraction of columns active (0–100).
     * @param {string}  [options.direction='down']       - Drop direction: 'down' | 'up'.
     * @param {number}  [options.dropSpeed=98]           - 0=frozen, 1=barely moving, 100=fastest.
     * @param {Array}   [options.speedTiers]             - Weighted speed tier array: [{frameSkip, weight}].
     * @param {number}  [options.trailLengthFast=28]     - Trail length for fastest columns.
     * @param {number}  [options.trailLengthSlow=70]     - Trail length for slowest columns.
     * @param {number}  [options.dualFrequency=50]       - 0=never, 100=very frequent dual streams.
     * @param {number}  [options.dualMinGap=10]          - Min row gap between dual streams.
     * @param {boolean} [options.burst=true]             - Enable automatic lightning bursts.
     * @param {number}  [options.burstDurationMin=10]    - Min burst duration in seconds.
     * @param {number}  [options.burstDurationMax=18]    - Max burst duration in seconds.
     * @param {number}  [options.burstIntervalMin=30]    - Min seconds between bursts.
     * @param {number}  [options.burstIntervalMax=60]    - Max seconds between bursts.
     * @param {number}  [options.burstFirstMin=20]       - Min seconds before first burst.
     * @param {number}  [options.burstFirstMax=40]       - Max seconds before first burst.
     * @param {number}  [options.burstWidth=10]          - Row half-width of the bolt (Gaussian falloff).
     * @param {number}  [options.burstReach=140]         - Column reach of the bolt left/right.
     * @param {number}  [options.burstAngle=0.25]        - Row drift per column (bolt steepness).
     * @param {boolean} [options.tapToBurst=false]       - Click/tap canvas to trigger burst.
     * @param {boolean} [options.hideChildren=false]     - Hide container children on start, restore on stop.
     * @param {number}  [options.fadeOutDuration=0]      - Seconds to fade canvas before unmounting on stop.
     * @param {number}  [options.introDepth=50]          - Pioneer drop depth: 0=off, 50=halfway, 100=full.
     * @param {number}  [options.introSpeed=98]          - Pioneer drop speed (0–100), independent of dropSpeed.
     * @param {object}  [options.on={}]                  - Event callbacks. See {@link DigitalRain#on}.
     */
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
        this._boundTap  = null;
        this._cols      = [];

        this._burstActive      = false;
        this._burstFramesLeft  = 0;
        this._burstTotalFrames = 0;
        this._nextBurstFrame   = 0;
        this._burstEpicenter   = -1;
        this._burstEpicenterRow = -1;
        this._burstRadius      = 0;
        this._burstAngle       = 0;
        this._burstNoise       = null;
        this._burstJag         = null; // per-column row jitter for jagged bolt path

        // Cached derived values — computed once in _mount
        this._speedMult    = 1;
        this._fastThresh   = 0;
        this._bellDenom    = 0;
        this._sigDenom     = 0;
        this._fontStr      = '';
        this._ringFronts   = null; // reused Float32Array

        this._childrenHidden = false;
        this._fadeOutRaf     = null;
        this._fadeOutAlpha   = 1;
        this._paused         = false;

        this._onResize = this._handleResize.bind(this);
        DigitalRain._registry.set(this._el, this);
    }

    /**
     * Mount the canvas and start the animation. Respects `startDelay`.
     * No-op if already running.
     * @returns {void}
     */
    start() {
        if (this._running) return;
        this._running = true;
        const ms = (this._cfg.startDelay || 0) * 1000;
        if (ms > 0) this._startTimer = setTimeout(() => this._mount(), ms);
        else        this._mount();
    }

    /**
     * Stop the animation, remove the canvas, and restore hidden children.
     * Respects `fadeOutDuration`. No-op if not running.
     * @returns {void}
     */
    stop() {
        if (!this._running) return;
        this._running = false;
        clearTimeout(this._startTimer);
        const fadeSecs = this._cfg.fadeOutDuration || 0;
        if (fadeSecs > 0 && this._canvas) {
            this._fadeOutAlpha = 1;
            const totalFrames = Math.round(fadeSecs * 60);
            let frame = 0;
            const tick = () => {
                frame++;
                this._fadeOutAlpha = Math.max(0, 1 - frame / totalFrames);
                this._canvas.style.opacity = this._fadeOutAlpha;
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

    /** Alias for {@link DigitalRain#stop}. */
    destroy() { this.stop(); DigitalRain._registry.delete(this._el); }

    /**
     * Retrieve a running DigitalRain instance by its container element or selector.
     * Returns null if no instance is found for that element.
     * @param {string|Element} container - CSS selector or DOM element.
     * @returns {DigitalRain|null}
     *
     * @example
     * new DigitalRain('#rain').start();
     * // Later, anywhere:
     * DigitalRain.getInstance('#rain').pause();
     */
    static getInstance(container) {
        const el = typeof container === 'string'
            ? document.querySelector(container) : container;
        return DigitalRain._registry.get(el) || null;
    }

    /**
     * Returns true if the animation has been started and not yet stopped.
     * Returns true even while paused.
     * @returns {boolean}
     */
    isRunning() { return this._running; }

    /**
     * Returns true if the animation is currently paused.
     * @returns {boolean}
     */
    isPaused()  { return this._paused; }

    /**
     * Returns a shallow clone of the current configuration.
     * Event callbacks (`on`) are excluded.
     * @returns {object}
     */
    getConfig() {
        const cfg = Object.assign({}, this._cfg);
        delete cfg.on;
        return cfg;
    }

    /**
     * Freeze the animation in place. The canvas stays visible and all state
     * is preserved. No-op if not running or already paused.
     * @returns {void}
     */
    pause() {
        if (!this._running || this._paused) return;
        this._paused = true;
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        this._emit('pause');
    }

    /**
     * Unfreeze a paused animation. If not running at all, falls back to start().
     * @returns {void}
     */
    resume() {
        if (!this._running) { this.start(); return; }
        if (!this._paused) return;
        this._paused = false;
        this._rafId = requestAnimationFrame(this._boundDraw);
        this._emit('resume');
    }

    /**
     * Register an event callback. Overwrites any existing handler for that event.
     * Events: 'start' | 'stop' | 'pause' | 'resume' | 'introComplete' | 'burstStart' | 'burstEnd'
     * @param {string}   event - Event name.
     * @param {Function} fn    - Callback. burstStart receives `{ epicenter }` (column index).
     * @returns {DigitalRain} this — for chaining.
     */
    on(event, fn) {
        if (!this._cfg.on) this._cfg.on = {};
        this._cfg.on[event] = fn;
        return this;
    }

    _emit(event, data) {
        const fn = this._cfg.on && this._cfg.on[event];
        if (typeof fn === 'function') try { fn(data); } catch(e) {}
    }

    /**
     * Manually fire a lightning burst.
     * @param {number} [col] - Column index for the burst epicenter. Random if omitted.
     * @returns {void}
     */
    triggerBurst(col) {
        if (!this._cfg.burst || !this._cols.length) return;
        const cfg = this._cfg;
        this._burstActive      = true;
        this._burstTotalFrames = Math.round(
            (cfg.burstDurationMin + Math.random() * (cfg.burstDurationMax - cfg.burstDurationMin)) * 60
        );
        this._burstFramesLeft  = this._burstTotalFrames;
        this._burstEpicenter   = col != null
            ? Math.max(0, Math.min(this._cols.length - 1, col | 0))
            : Math.random() * this._cols.length | 0;
        this._burstEpicenterRow = this._canvas
            ? Math.floor(this._canvas.height / this._cfg.fontSize * Math.random())
            : 20;
        // Random bolt angle: positive or negative drift, and random direction bias
        this._burstAngle = (Math.random() < 0.5 ? 1 : -1) *
            (cfg.burstAngle * (0.5 + Math.random()));
        this._burstRadius = 3; // kept for API compat
        this._burstNoise  = this._makeBurstNoise(this._burstEpicenter);
        this._burstJag    = this._makeBurstJag();
    }

    _makeBurstNoise(epi) {
        const n     = this._cols.length;
        const reach = this._cfg.burstReach || 80;
        const noise = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const absDelta = i > epi ? i - epi : epi - i;
            const edgeBias = absDelta / reach;
            noise[i] = Math.max(0, Math.min(1,
                edgeBias * 0.7 + Math.random() * 0.5 - 0.1
            ));
        }
        return noise;
    }

    _makeBurstJag() {
        // Per-column row displacement for a jagged bolt path.
        // Uses a random walk so adjacent columns are correlated (looks like real lightning).
        const n   = this._cols.length;
        const jag = new Float32Array(n);
        const w   = this._cfg.burstWidth || 6;
        let walk  = 0;
        for (let i = 0; i < n; i++) {
            // Random walk with mean reversion — keeps bolt from drifting too far
            walk += (Math.random() - 0.5) * w * 0.8;
            walk *= 0.85; // mean reversion
            jag[i] = walk;
        }
        return jag;
    }

    /**
     * Update one or more options live — no restart needed for most changes.
     * `chars` and `theme` take effect immediately.
     * `density` and `direction` reinitialise columns immediately.
     * `opacity` updates the canvas style immediately.
     * @param {object} options - Partial options object. Same keys as constructor options.
     * @returns {void}
     */
    configure(o) {
        const prevSpeed     = this._cfg.dropSpeed;
        const prevChars     = this._cfg.chars;
        const prevDensity   = this._cfg.density;
        const prevDirection = this._cfg.direction;
        Object.assign(this._cfg, o);
        if (o.chars !== undefined && o.chars !== prevChars) {
            this._CHARS = this._cfg.chars.split('');
        }
        if (this._canvas) {
            this._computeCached();
            // Live opacity update
            if (o.opacity !== undefined) {
                this._canvas.style.opacity = this._cfg.opacity;
            }
            // Density or direction change — reinit columns
            if ((o.density !== undefined && o.density !== prevDensity) ||
                (o.direction !== undefined && o.direction !== prevDirection)) {
                this._initColumns();
            }
            // If dropSpeed changed, recompute speed/steps on all existing streams
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

    /**
     * Built-in character sets. Use with `configure({ chars: DigitalRain.CHARSETS.binary })`.
     * `randomize()` picks from these automatically.
     * @type {Object.<string, string>}
     */
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

    /**
     * Randomize visual and behavioral options and restart.
     * dropSpeed, introSpeed, introDepth, and speedTiers are not touched.
     * Uses HSL for color so results are always vivid. Picks from DigitalRain.CHARSETS.
     * Pass an overrides object to lock specific values while randomizing the rest.
     * @param {object} [overrides={}] - Options to lock. Same keys as configure().
     * @returns {object} The full set of randomized values that were applied.
     */
    randomize(overrides = {}) {
        const rInt   = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
        const rFloat = (a, b, dec=2) => Math.round((Math.random() * (b - a) + a) * 10**dec) / 10**dec;
        const rPick  = (arr) => arr[Math.random() * arr.length | 0];
        const rBool  = () => Math.random() < 0.5;

        const charsetValues = Object.values(DigitalRain.CHARSETS);
        const directions    = ['down', 'up'];

        const trailLengthFast  = rInt(5, 100);
        const burstDurationMin = rInt(1, 15);
        const burstIntervalMin = rInt(1, 120);
        const burstFirstMin    = rInt(5, 30);
        const burst            = rBool();

        const picked = {
            // ── Appearance ───────────────────────────────────────────────
            theme:            `hsl(${rInt(0, 360)}, 100%, 55%)`,
            chars:            rPick(charsetValues),
            opacity:          rFloat(0.5, 1.0),
            glowAlpha:        rFloat(0.2, 1.0),
            bgColor:          rPick(['#000000', '#050505', '#030303', '#0a0a0a', '#000805']),
            fontSize:         rPick([12, 14, 16, 18, 20]),

            // ── Rain ─────────────────────────────────────────────────────
            density:          rInt(20, 100),
            direction:        rPick(directions),
            dualFrequency:    rInt(0, 100),
            trailLengthFast,
            trailLengthSlow:  rInt(trailLengthFast, 150),

            // ── Burst ────────────────────────────────────────────────────
            burst,
            burstDurationMin,
            burstDurationMax: rInt(burstDurationMin, 20),
            burstIntervalMin,
            burstIntervalMax: rInt(burstIntervalMin, 300),
            burstFirstMin,
            burstFirstMax:    rInt(burstFirstMin, 60),
            burstWidth:       rInt(4, 20),
            burstReach:       rInt(40, 200),
            burstAngle:       rFloat(0, 0.5),

            // ── Behaviour ────────────────────────────────────────────────
            tapToBurst:       rBool(),
            hideChildren:     false,   // never randomize — affects DOM structure
            fadeOutDuration:  rPick([0, 0, 0, 0.5, 1, 2]),  // bias toward instant
            introDepth:       rInt(0, 100),
        };

        // Apply overrides — caller can lock any value
        Object.assign(picked, overrides);

        this.configure(picked);
        // Temporarily zero fadeOutDuration so the internal restart is instant —
        // the randomized value is preserved in config for manual stop() calls
        const savedFade = this._cfg.fadeOutDuration;
        this._cfg.fadeOutDuration = 0;
        this.stop();
        this._cfg.fadeOutDuration = savedFade;
        this.start();
        return picked;
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
            dropSpeed:       98,

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
            burstDurationMin:   10,
            burstDurationMax:   18,
            burstIntervalMin:   30,
            burstIntervalMax:   60,
            burstFirstMin:      20,
            burstFirstMax:      40,
            burstExpansionRate: 0.45,   // unused legacy — kept for API compat
            burstWidth:         10,      // row half-width of the bolt (falloff in rows)
            burstReach:         140,     // how many columns the bolt extends left/right
            burstAngle:         0.25,    // row drift per column (steepness of the bolt)

            // Click/tap on canvas to trigger burst at that position
            tapToBurst:     false,

            // Hide container's direct children on start, restore on stop
            hideChildren:    false,

            // Intro pioneer drop: 0=no intro (all drops start at once),
            // 50=pioneer drops to halfway, 100=pioneer drops to bottom
            introDepth:     50,
            // Speed of the pioneer drop on the same 0–100 scale as dropSpeed
            introSpeed:     98,

            // Color theme: 'green' | 'red' | 'blue' | 'white' | 'amber'
            theme:          'green',

            // Canvas opacity (0–1)
            opacity:        1,

            // Fraction of columns that are active (0–100)
            density:        100,

            // Drop direction: 'down' | 'up'
            direction:      'down',

            // Fade-out duration in seconds when stop() is called (0 = instant)
            fadeOutDuration: 0,

            // Event callbacks: { start, stop, introComplete, burstStart, burstEnd }
            on:             {},
        };
    }

    // ── Helpers (called rarely, not per-frame) ────────────────────────────

    _computeCached() {
        const cfg = this._cfg;
        const s   = cfg.dropSpeed;
        this._speedMult  = s <= 0 ? 999 : s >= 100 ? 1 : Math.round(1 + (99 - s) / 99 * 59);
        this._fastThresh = cfg.speedTiers[0].frameSkip * this._speedMult * 1.5;
        this._fontStr    = `${cfg.fontSize}px ${cfg.fontFamily}`;
        this._ringFronts = null; // unused, kept for compat

        // Intro speed multiplier — independent of global dropSpeed
        const si = cfg.introSpeed;
        this._introSpeedMult = si <= 0 ? 999 : si >= 100 ? 1 : Math.round(1 + (99 - si) / 99 * 59);

        // Theme color LUT: index 0–255 → color string based on theme
        // theme can be a built-in name ('green', 'red', etc.), a hex string ('#ff00ff', '#0cf'),
        // or any valid CSS color name ('cyan', 'magenta', 'hotpink', etc.)
        const theme = cfg.theme || 'green';
        const THEMES = {
            green:  (v) => `rgb(0,${v},0)`,
            red:    (v) => `rgb(${v},0,0)`,
            blue:   (v) => `rgb(0,${Math.round(v*0.4)},${v})`,
            white:  (v) => `rgb(${v},${v},${v})`,
            amber:  (v) => `rgb(${v},${Math.round(v*0.6)},0)`,
        };
        const HEAD_COLORS = {
            green:  { head: '#00ff41', glow: 'rgba(0,255,0,',    burst: [0,255,0]   },
            red:    { head: '#ff3300', glow: 'rgba(255,80,0,',   burst: [255,80,0]  },
            blue:   { head: '#00cfff', glow: 'rgba(0,150,255,',  burst: [0,150,255] },
            white:  { head: '#ffffff', glow: 'rgba(220,220,220,', burst: [220,220,220] },
            amber:  { head: '#ffaa00', glow: 'rgba(255,160,0,',  burst: [255,160,0] },
        };

        // Parse any CSS color string → [r, g, b] or null using browser color parsing
        const parseCSSColor = (str) => {
            try {
                const tmp = document.createElement('canvas');
                tmp.width = tmp.height = 1;
                const ctx = tmp.getContext('2d');
                ctx.fillStyle = '#000'; // reset
                ctx.fillStyle = str;
                const computed = ctx.fillStyle;
                // fillStyle normalises to '#rrggbb' for valid colors
                if (computed.startsWith('#')) {
                    const s = computed.slice(1);
                    return [
                        parseInt(s.slice(0,2), 16),
                        parseInt(s.slice(2,4), 16),
                        parseInt(s.slice(4,6), 16),
                    ];
                }
                // Some browsers return rgb(...) instead
                const m = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                if (m) return [+m[1], +m[2], +m[3]];
            } catch(e) {}
            return null;
        };

        const buildFromRgb = ([hr, hg, hb]) => {
            const rn = hr / 255, gn = hg / 255, bn = hb / 255;
            return {
                colorFn:     (v) => `rgb(${Math.round(v*rn)},${Math.round(v*gn)},${Math.round(v*bn)})`,
                themeColors: {
                    head:  `#${hr.toString(16).padStart(2,'0')}${hg.toString(16).padStart(2,'0')}${hb.toString(16).padStart(2,'0')}`,
                    glow:  `rgba(${hr},${hg},${hb},`,
                    burst: [hr, hg, hb],
                },
            };
        };

        let colorFn, themeColors;
        if (THEMES[theme]) {
            // Named built-in theme — use hand-tuned values
            colorFn     = THEMES[theme];
            themeColors = HEAD_COLORS[theme];
        } else {
            // Hex or CSS named color — parse via browser
            const rgb = parseCSSColor(theme);
            if (rgb) {
                ({ colorFn, themeColors } = buildFromRgb(rgb));
            } else {
                console.warn(`DigitalRain: unrecognised theme "${theme}", falling back to green`);
                colorFn     = THEMES.green;
                themeColors = HEAD_COLORS.green;
            }
        }

        this._greenLUT = new Array(256);
        for (let v = 0; v < 256; v++) this._greenLUT[v] = colorFn(v);
        this._themeColors = themeColors;
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

    _handleTap(e) {
        if (!this._cfg.burst || this._booting) return;
        const rect = this._canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x   = clientX - rect.left;
        const y   = clientY - rect.top;
        const col = Math.floor(x / this._cfg.fontSize);
        const row = Math.floor(y / this._cfg.fontSize);
        // Trigger burst with exact tap position as epicenter
        const cfg = this._cfg;
        this._burstActive      = true;
        this._burstTotalFrames = Math.round(
            (cfg.burstDurationMin + Math.random() * (cfg.burstDurationMax - cfg.burstDurationMin)) * 60
        );
        this._burstFramesLeft  = this._burstTotalFrames;
        this._burstEpicenter    = Math.max(0, Math.min(this._cols.length - 1, col));
        this._burstEpicenterRow = Math.max(0, row);
        this._burstAngle        = (Math.random() < 0.5 ? 1 : -1) *
            (cfg.burstAngle * (0.5 + Math.random()));
        this._burstRadius = 3;
        this._burstNoise  = this._makeBurstNoise(this._burstEpicenter);
        this._burstJag    = this._makeBurstJag();
    }

    // ── Mount / unmount ───────────────────────────────────────────────────

    _mount() {
        const el = this._el, cfg = this._cfg;
        if (window.getComputedStyle(el).position === 'static') el.style.position = 'relative';

        if (cfg.hideChildren) {
            this._el.style.backgroundColor = cfg.bgColor;
            for (const child of this._el.children) {
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
        this._ctx = this._canvas.getContext('2d');

        this._computeCached();

        const introDepth = this._cfg.introDepth;
        if (introDepth <= 0) {
            // No intro — all columns start immediately
            this._booting     = false;
            this._bootStream  = null;
            this._bootTargetRow = 0;
            this._initColumns();
        } else {
            // Boot: single stream in the center column.
            // Speed driven by introSpeed, not global dropSpeed.
            // Uses speedTiers[0] (fastest tier) as the base — same anchor as the main rain —
            // so introSpeed=100 feels equivalent to dropSpeed=100.
            this._booting = true;
            const medSkip = Math.max(1, (this._cfg.speedTiers[0]
                ? this._cfg.speedTiers[0].frameSkip
                : 2) * this._introSpeedMult);
            this._bootStream    = { row: 0, speed: medSkip, steps: this._makeSteps(medSkip), trails: [] };
            // Target row: introDepth 1–100 maps to 1%–100% of screen height
            const maxRow        = Math.floor(this._canvas.height / this._cfg.fontSize);
            this._bootTargetRow = Math.max(1, Math.round((introDepth / 100) * maxRow));
            this._initColumns();
        }

        // Burst fires after boot completes
        this._nextBurstFrame = 999999;

        this._boundDraw = this._drawFrame.bind(this);
        this._boundTap  = this._handleTap.bind(this);
        window.addEventListener('resize', this._onResize, { passive: true });
        if (this._cfg.tapToBurst) {
            this._canvas.style.pointerEvents = 'auto';
            this._canvas.addEventListener('click',      this._boundTap);
            this._canvas.addEventListener('touchstart', this._boundTap, { passive: true });
        }
        this._rafId = requestAnimationFrame(this._boundDraw);
        this._emit('start');
    }

    _unmount() {
        if (this._fadeOutRaf) { cancelAnimationFrame(this._fadeOutRaf); this._fadeOutRaf = null; }
        if (this._rafId)  { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this._canvas) {
            if (this._boundTap) {
                this._canvas.removeEventListener('click',      this._boundTap);
                this._canvas.removeEventListener('touchstart', this._boundTap);
            }
            this._canvas.remove(); this._canvas = null; this._ctx = null;
        }
        if (this._childrenHidden) {
            this._el.style.backgroundColor = '';
            for (const child of this._el.children) {
                child.style.visibility = child.dataset._drainVis || '';
                delete child.dataset._drainVis;
            }
            this._childrenHidden = false;
        }
        this._cols = []; this._frameCount = 0;
        this._burstActive = false; this._burstTotalFrames = 0;
        this._burstEpicenter = -1; this._burstEpicenterRow = -1; this._burstRadius = 0;
        this._burstAngle = 0; this._burstNoise = null; this._burstJag = null;
        this._booting = true; this._bootStream = null; this._bootTargetRow = 0;
        this._paused = false;
        this._emit('stop');
    }

    _initColumns() {
        const n       = Math.floor(this._canvas.width / this._cfg.fontSize);
        const density = this._cfg.density != null ? Math.max(0, Math.min(100, this._cfg.density)) : 100;
        const center  = Math.floor(n / 2);
        this._cols = Array.from({ length: n }, (_, i) => ({
            streams:  [ this._makeStream(this._booting ? 999999 : 60) ],
            spawnCD:  this._dualCooldown(),
            dormant:  (this._booting && i === center) ? false : Math.random() * 100 >= density,
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

        const cfg     = this._cfg;
        const ctx     = this._ctx;
        const CHARS   = this._CHARS;
        const maxRow  = Math.floor(this._canvas.height / cfg.fontSize);
        const numCols = this._cols.length;
        const fw      = cfg.fontSize;
        const bgColor = cfg.bgColor;
        const fc      = this._frameCount;

        // ── Boot phase: single center stream ──────────────────────────────
        if (this._booting && this._bootStream) {
            const bs      = this._bootStream;
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

            ctx.font = this._fontStr;
            for (let t = 0; t < bs.trails.length; t++) {
                const e   = bs.trails[t];
                const row = dirUp ? (maxRow - 1 - e.row) : e.row;
                const cy  = row * fw;
                ctx.fillStyle = bgColor;
                ctx.fillRect(centerX, cy, fw, fw);
                const isHead = (t === bs.trails.length - 1);
                if (isHead) {
                    ctx.fillStyle = `${this._themeColors.glow}${cfg.glowAlpha})`;
                    ctx.fillText(e.char, centerX - 1, cy + fw - 2);
                    ctx.fillText(e.char, centerX + 1, cy + fw - 2);
                    ctx.fillText(e.char, centerX,     cy + fw - 3);
                    ctx.fillText(e.char, centerX,     cy + fw - 1);
                    ctx.fillStyle = this._themeColors.head;
                } else {
                    const cl = Math.min(1, e.brightness / bs.steps);
                    ctx.fillStyle = this._greenLUT[cl * cl * 255 | 0];
                }
                ctx.fillText(e.char, centerX, cy + fw - 2);
            }

            if (bs.row >= this._bootTargetRow) {
                this._booting = false;
                const centerCol = Math.floor(numCols / 2);
                this._initColumns();
                const liveStream = {
                    row: bs.row, speed: bs.speed, steps: bs.steps,
                    delay: 0, trails: bs.trails.slice(), active: true, suppressTicks: 0,
                };
                this._cols[centerCol].streams[0] = liveStream;
                this._cols[centerCol].dormant = false; // ensure pioneer continues regardless of density
                this._bootStream = null;
                if (cfg.burst) {
                    this._nextBurstFrame = fc + Math.round(
                        (cfg.burstFirstMin + Math.random() * (cfg.burstFirstMax - cfg.burstFirstMin)) * 60
                    );
                }
                this._emit('introComplete');
            }

            this._rafId = requestAnimationFrame(this._boundDraw);
            return;
        }

        const bellDenom  = this._bellDenom;
        const sigDenom   = this._sigDenom;
        const fastThresh = this._fastThresh;
        const minGap     = cfg.dualMinGap;

        // ── Burst (lightning) ─────────────────────────────────────────────
        if (cfg.burst && !this._burstActive && fc >= this._nextBurstFrame) {
            this.triggerBurst();
            this._emit('burstStart', { epicenter: this._burstEpicenter });
        }
        if (this._burstActive) {
            if (--this._burstFramesLeft <= 0) {
                this._burstActive = false; this._burstTotalFrames = 0;
                this._burstEpicenter = -1; this._burstEpicenterRow = -1;
                this._burstRadius = 0; this._burstAngle = 0; this._burstNoise = null; this._burstJag = null;
                this._nextBurstFrame = fc + Math.round(
                    (cfg.burstIntervalMin + Math.random() * (cfg.burstIntervalMax - cfg.burstIntervalMin)) * 60
                );
                this._emit('burstEnd');
            }
        }

        // Pre-compute lightning params once per frame
        const burstActive       = this._burstActive;
        const burstEpicenter    = this._burstEpicenter;
        const burstEpicenterRow = this._burstEpicenterRow;
        const burstAngle        = this._burstAngle;
        const burstReach        = cfg.burstReach;
        const burstWidth        = cfg.burstWidth;
        // Decay: fast flash then quick fade — peaks at 0, gone by end
        const elapsed        = burstActive ? this._burstTotalFrames - this._burstFramesLeft : 0;
        const progress       = burstActive ? elapsed / this._burstTotalFrames : 0;
        const lightningDecay = 1;
        const decay          = lightningDecay;

        ctx.font = this._fontStr; // set once per frame
        const greenLUT    = this._greenLUT;
        const themeColors = this._themeColors;
        const glowLUT     = `${themeColors.glow}${cfg.glowAlpha})`;
        const [bR, bG, bB] = themeColors.burst;
        const dirUp       = cfg.direction === 'up';

        for (let i = 0; i < numCols; i++) {
            const col = this._cols[i];
            if (col.dormant) continue; // density skip
            const x   = i * fw;

            // ── Lightning intensity (column-level, no per-entry row calc yet) ──
            let colBIntens = 0;
            if (burstActive && burstEpicenter >= 0) {
                const colDelta = i - burstEpicenter;
                const absDelta = colDelta < 0 ? -colDelta : colDelta;
                // Only light up columns within reach
                if (absDelta <= burstReach) {
                    // Falloff along the bolt: strong near epicenter, fades at reach
                    const reach_t = 1 - absDelta / burstReach;
                    colBIntens = reach_t * reach_t * decay;
                }
            }

            const rb        = colBIntens * 230 | 0;
            const glowAlpha = cfg.glowAlpha + colBIntens * 0.5;

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

            const colDelta = burstActive && burstEpicenter >= 0 ? i - burstEpicenter : 0;
            let colBIntens = 0;
            if (burstActive && burstEpicenter >= 0 && this._burstNoise) {
                const absDelta   = colDelta < 0 ? -colDelta : colDelta;
                const noiseThresh = this._burstNoise[i] ?? 1;
                // Column is alive only if progress hasn't reached its dropout threshold
                if (absDelta <= burstReach && progress < noiseThresh) {
                    const reach_t = 1 - absDelta / burstReach;
                    colBIntens = reach_t * reach_t;
                }
            }

            for (let s = 0; s < col.streams.length; s++) {
                const st      = col.streams[s];
                const trails  = st.trails;
                const headIdx = st.active ? trails.length - 1 : -1;

                for (let t = 0; t < trails.length; t++) {
                    const e   = trails[t];
                    const row = dirUp ? (maxRow - 1 - e.row) : e.row;
                    const cy  = row * fw;

                    // Per-entry lightning intensity — row falloff around jagged bolt path
                    let bIntens = 0;
                    if (colBIntens > 0) {
                        const jag     = this._burstJag;
                        const jagOff  = jag ? jag[i] : 0;
                        const boltRow = burstEpicenterRow + burstAngle * colDelta + jagOff;
                        const rowDist = e.row - boltRow;
                        const absDist = rowDist < 0 ? -rowDist : rowDist;
                        if (absDist < burstWidth * 4) {
                            // Gaussian falloff around bolt path
                            const bw2 = burstWidth * burstWidth;
                            const rowFalloff = Math.exp(-(rowDist * rowDist) / (2 * bw2));
                            bIntens = colBIntens * rowFalloff;
                        }
                    }

                    const whiten    = bIntens * bIntens; // quadratic push to white at peak
                    const glowAlpha = cfg.glowAlpha + bIntens * 0.5;

                    ctx.fillStyle = bgColor;
                    ctx.fillRect(x, cy, fw, fw);

                    if (t === headIdx) {
                        ctx.fillRect(x - 1, cy - 1, fw + 2, fw + 2);
                        if (bIntens > 0) {
                            // Glow pass: theme color at burst intensity
                            const gR = Math.min(255, bR * bIntens | 0);
                            const gG = Math.min(255, bG * bIntens | 0);
                            const gB = Math.min(255, bB * bIntens | 0);
                            ctx.fillStyle = `rgba(${gR},${gG},${gB},${glowAlpha})`;
                            ctx.fillText(e.char, x - 1, cy + fw - 2);
                            ctx.fillText(e.char, x + 1, cy + fw - 2);
                            ctx.fillText(e.char, x,     cy + fw - 3);
                            ctx.fillText(e.char, x,     cy + fw - 1);
                            // Head: theme color pushed toward white at peak
                            const boost = whiten * 255 | 0;
                            ctx.fillStyle = `rgb(${Math.min(255, gR + boost)},${Math.min(255, gG + boost)},${Math.min(255, gB + boost)})`;
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
                        const cl1 = e.brightness / st.steps;
                        const cl  = cl1 > 1 ? 1 : cl1;
                        if (bIntens > 0) {
                            // Trail: theme color brightened by burst intensity
                            const boost = whiten * 255 | 0;
                            const tr = Math.min(255, (cl * cl * bR | 0) + (bIntens * bR | 0) + boost);
                            const tg = Math.min(255, (cl * cl * bG | 0) + (bIntens * bG | 0) + boost);
                            const tb = Math.min(255, (cl * cl * bB | 0) + (bIntens * bB | 0) + boost);
                            ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
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

    // ── Static inspection ─────────────────────────────────────────────────

    /**
     * All supported configuration options with type, default value, and description.
     * Useful for runtime inspection and building tooling on top of the library.
     * @type {Object.<string, {type: string, default: *, description: string}>}
     */
    static get OPTIONS() {
        return {
            startDelay:       { type: 'number',  default: 0,       description: 'Seconds before rain begins' },
            fontSize:         { type: 'number',  default: 14,      description: 'px — controls column width and row height' },
            bgColor:          { type: 'string',  default: '#050505', description: 'Background fill color' },
            glowAlpha:        { type: 'number',  default: 0.6,     description: 'Glow intensity on stream heads (0–1)' },
            fontFamily:       { type: 'string',  default: '"Share Tech Mono", "Courier New", monospace', description: 'CSS font-family string' },
            chars:            { type: 'string',  default: 'アイ...ABCDEF', description: "Character pool. Use DigitalRain.CHARSETS.<name> for built-ins (katakana, binary, hex, latin, greek, russian, runic, hangul, arabic, braille, box, math, symbols, blocks, emoticons, hiragana)" },
            theme:            { type: 'string',  default: 'green', description: "Named theme ('green'|'red'|'blue'|'white'|'amber'), hex color, or any CSS color name" },
            opacity:          { type: 'number',  default: 1,       description: 'Canvas opacity (0–1)' },
            density:          { type: 'number',  default: 100,     description: 'Fraction of columns active (0–100)' },
            direction:        { type: 'string',  default: 'down',  description: "Drop direction: 'down' | 'up'" },
            dropSpeed:        { type: 'number',  default: 98,      description: '0=frozen, 1=barely moving, 100=fastest' },
            speedTiers:       { type: 'Array',   default: '[...]', description: 'Weighted speed tiers: [{frameSkip, weight}]' },
            trailLengthFast:  { type: 'number',  default: 28,      description: 'Trail length for fastest columns' },
            trailLengthSlow:  { type: 'number',  default: 70,      description: 'Trail length for slowest columns' },
            dualFrequency:    { type: 'number',  default: 50,      description: '0=never, 100=very frequent dual streams per column' },
            dualMinGap:       { type: 'number',  default: 10,      description: 'Min row gap between dual streams in same column' },
            burst:            { type: 'boolean', default: true,    description: 'Enable automatic lightning bursts' },
            burstDurationMin: { type: 'number',  default: 10,      description: 'Min burst duration (seconds)' },
            burstDurationMax: { type: 'number',  default: 18,      description: 'Max burst duration (seconds)' },
            burstIntervalMin: { type: 'number',  default: 30,      description: 'Min seconds between bursts' },
            burstIntervalMax: { type: 'number',  default: 60,      description: 'Max seconds between bursts' },
            burstFirstMin:    { type: 'number',  default: 20,      description: 'Min seconds before first burst' },
            burstFirstMax:    { type: 'number',  default: 40,      description: 'Max seconds before first burst' },
            burstWidth:       { type: 'number',  default: 10,      description: 'Row half-width of the bolt (Gaussian falloff)' },
            burstReach:       { type: 'number',  default: 140,     description: 'Column reach of the bolt left/right' },
            burstAngle:       { type: 'number',  default: 0.25,    description: 'Row drift per column (bolt steepness)' },
            tapToBurst:       { type: 'boolean', default: false,   description: 'Click/tap canvas to trigger burst at that position' },
            hideChildren:     { type: 'boolean', default: false,   description: 'Hide container children on start, restore on stop' },
            fadeOutDuration:  { type: 'number',  default: 0,       description: 'Seconds to fade canvas before unmounting on stop (0 = instant)' },
            introDepth:       { type: 'number',  default: 50,      description: 'Pioneer drop depth: 0=off, 50=halfway, 100=full height' },
            introSpeed:       { type: 'number',  default: 98,      description: 'Pioneer drop speed (0–100), independent of dropSpeed' },
            on:               { type: 'object',  default: '{}',    description: 'Event callbacks: { start, stop, pause, resume, introComplete, burstStart, burstEnd }' },
        };
    }

    /**
     * Print a formatted reference of all options and public methods to the console.
     * Call from the browser console: `DigitalRain.help()`
     * @returns {void}
     */
    static help() {
        const c = {
            title:   'color: #00ff41; font-weight: bold; font-size: 1.1em',
            head:    'color: #00ff41; font-weight: bold',
            key:     'color: #00cfff',
            type:    'color: #ffaa00',
            def:     'color: #aaaaaa',
            desc:    'color: #cccccc',
            method:  'color: #ff79c6; font-weight: bold',
            sig:     'color: #aaaaaa',
            reset:   'color: inherit',
        };

        console.log('%cDigitalRain', c.title);
        console.log('%cdigital-rain.js — no dependencies, single file', c.def);
        console.log(' ');

        // ── Options ───────────────────────────────────────────────────────
        console.log('%c── OPTIONS ─────────────────────────────────────────', c.head);
        console.log('%cnew DigitalRain(container, options)', c.sig);
        console.log(' ');

        const opts = DigitalRain.OPTIONS;
        const keyW = Math.max(...Object.keys(opts).map(k => k.length));
        for (const [key, meta] of Object.entries(opts)) {
            const pad = ' '.repeat(keyW - key.length);
            console.log(
                `  %c${key}${pad}%c  ${meta.type.padEnd(8)}%c  default: ${String(meta.default).slice(0,20).padEnd(22)}%c  ${meta.description}`,
                c.key, c.type, c.def, c.desc
            );
        }

        console.log(' ');

        // ── Methods ───────────────────────────────────────────────────────
        console.log('%c── METHODS ─────────────────────────────────────────', c.head);
        const methods = [
            ['start()',           'Mount canvas and begin. Respects startDelay. No-op if already running.'],
            ['stop()',            'Stop, remove canvas, restore hidden children. Respects fadeOutDuration.'],
            ['destroy()',         'Alias for stop().'],
            ['pause()',           'Freeze animation in place. Canvas stays, state preserved.'],
            ['resume()',          'Unfreeze. Falls back to start() if not yet running.'],
            ['isRunning()',       'Returns true if started and not stopped (includes paused).'],
            ['isPaused()',        'Returns true if currently paused.'],
            ['getConfig()',       'Shallow clone of current config (callbacks excluded).'],
            ['configure(opts)',   'Update options live — no restart needed for most changes.'],
            ['randomize(overrides?)', 'Randomize visuals and restart. Pass overrides to lock specific values. Returns applied config.'],
            ['triggerBurst(col?)','Fire a burst manually. col = column index, omit for random.'],
            ['on(event, fn)',     "Register event callback: 'start'|'stop'|'pause'|'resume'|'introComplete'|'burstStart'|'burstEnd'"],
        ];
        const mW = Math.max(...methods.map(([m]) => m.length));
        for (const [sig, desc] of methods) {
            const pad = ' '.repeat(mW - sig.length);
            console.log(`  %c${sig}${pad}%c  ${desc}`, c.method, c.desc);
        }

        console.log(' ');

        // ── Static ────────────────────────────────────────────────────────
        console.log('%c── STATIC ──────────────────────────────────────────', c.head);
        console.log(`  %cDigitalRain.getInstance(el)%c  Get a running instance by container element or selector.`, c.method, c.desc);
        console.log(`  %cDigitalRain.CHARSETS%c  Built-in character sets (katakana, binary, hex, latin, greek, russian, runic, hangul, arabic, braille, box, math, symbols, blocks, emoticons, hiragana).`, c.method, c.desc);
        console.log(`  %cDigitalRain.OPTIONS%c   All options with type, default, and description.`, c.method, c.desc);
        console.log(`  %cDigitalRain.DEFAULTS%c  All default option values.`, c.method, c.desc);
        console.log(`  %cDigitalRain.help()%c    Print this reference.`, c.method, c.desc);
        console.log(' ');
    }
}

// Static instance registry — maps container Element → DigitalRain instance
DigitalRain._registry = new Map();