(() => {
    "use strict";

    const canvas = document.getElementById("field");
    const ctx = canvas.getContext("2d", { alpha: false });

    const PALETTES = {
        aurora:  { bg: "#05060a", ink: ["#8be9ff", "#a78bfa", "#6ee7b7", "#f0abfc"] },
        ember:   { bg: "#0a0604", ink: ["#ff8a5b", "#ffd166", "#ef476f", "#ffb4a2"] },
        mono:    { bg: "#080808", ink: ["#ffffff", "#bdbdbd", "#8a8a8a", "#e0e0e0"] },
        reef:    { bg: "#02080c", ink: ["#22d3ee", "#34d399", "#60a5fa", "#a3e635"] },
        bloom:   { bg: "#0b0410", ink: ["#f472b6", "#c084fc", "#818cf8", "#fb7185"] }
    };
    const PALETTE_KEYS = Object.keys(PALETTES);
    const MODES = ["flow", "orbit", "swarm", "drift"];
    const SEED_GLYPHS = "∿◇△◯※⟁⌁⍉⎔⏥⊹✶❖⟐⌬◈▽⬡⟡⦚".split("");

    const state = {
        mode: "flow",
        palette: "aurora",
        density: 55,
        flux: 35
    };

    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let bursts = [];
    const pointer = { x: -9999, y: -9999, down: false, active: false };
    let t = 0;

    // --- value-noise flow field --------------------------------------------
    let perm = new Uint8Array(512);
    function reseed(seed) {
        let s = seed >>> 0;
        const rand = () => {
            s = (s * 1664525 + 1013904223) >>> 0;
            return s / 4294967296;
        };
        const p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) p[i] = i;
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }
        for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    }

    function noise2(x, y) {
        const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
        const xf = x - Math.floor(x), yf = y - Math.floor(y);
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        const aa = perm[perm[xi] + yi], ba = perm[perm[xi + 1] + yi];
        const ab = perm[perm[xi] + yi + 1], bb = perm[perm[xi + 1] + yi + 1];
        const lerp = (a, b, f) => a + f * (b - a);
        const top = lerp(aa, ba, u), bot = lerp(ab, bb, u);
        return lerp(top, bot, v) / 255;
    }

    function angleAt(x, y, time) {
        const scale = 0.0016;
        return noise2(x * scale + time, y * scale - time) * Math.PI * 4;
    }

    // --- particles ----------------------------------------------------------
    function spawn(n) {
        particles = [];
        for (let i = 0; i < n; i++) {
            particles.push({
                x: Math.random() * w,
                y: Math.random() * h,
                vx: 0, vy: 0,
                life: Math.random(),
                c: Math.floor(Math.random() * 4)
            });
        }
    }

    function particleTarget() {
        return Math.max(110, Math.round((state.density / 100) * (w * h) / 6000));
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        spawn(particleTarget());
        const pal = PALETTES[state.palette];
        ctx.fillStyle = pal.bg;
        ctx.fillRect(0, 0, w, h);
    }

    function step() {
        const pal = PALETTES[state.palette];
        const speed = 0.14 + (state.flux / 100) * 1.05;

        // gentle trailing fade (no additive blending -> no strobing)
        ctx.fillStyle = pal.bg + "12";
        ctx.fillRect(0, 0, w, h);

        t += 0.0005 + (state.flux / 100) * 0.0011;
        const cx = w / 2, cy = h / 2;

        for (const p of particles) {
            let ax = 0, ay = 0;

            if (state.mode === "flow") {
                const a = angleAt(p.x, p.y, t);
                ax = Math.cos(a); ay = Math.sin(a);
            } else if (state.mode === "orbit") {
                const dx = p.x - cx, dy = p.y - cy;
                const d = Math.hypot(dx, dy) || 1;
                ax = -dy / d + (dx / d) * -0.03;
                ay = dx / d + (dy / d) * -0.03;
            } else if (state.mode === "swarm") {
                const a = angleAt(p.x, p.y, t) + (p.c - 1.5) * 0.5;
                ax = Math.cos(a); ay = Math.sin(a);
                const dx = cx - p.x, dy = cy - p.y;
                const d = Math.hypot(dx, dy) || 1;
                ax += (dx / d) * 0.15; ay += (dy / d) * 0.15;
            } else { // drift
                const a = angleAt(p.x * 0.5, p.y * 0.5, t * 0.6);
                ax = Math.cos(a) * 0.5 + 0.4;
                ay = Math.sin(a) * 0.8;
            }

            // pointer: repel on hover, attract on press (gentle)
            if (pointer.active) {
                const dx = pointer.x - p.x, dy = pointer.y - p.y;
                const d2 = dx * dx + dy * dy;
                if (d2 < 34000) {
                    const d = Math.sqrt(d2) || 1;
                    const force = (1 - d / 184) * (pointer.down ? 1.1 : -0.85);
                    ax += (dx / d) * force * 1.4;
                    ay += (dy / d) * force * 1.4;
                }
            }

            p.vx = p.vx * 0.9 + ax * speed * 0.5;
            p.vy = p.vy * 0.9 + ay * speed * 0.5;
            const px = p.x, py = p.y;
            p.x += p.vx;
            p.y += p.vy;

            if (p.x < 0) p.x += w; else if (p.x > w) p.x -= w;
            if (p.y < 0) p.y += h; else if (p.y > h) p.y -= h;

            p.life -= 0.003;
            if (p.life <= 0) {
                p.life = 1;
                p.x = Math.random() * w;
                p.y = Math.random() * h;
                p.c = Math.floor(Math.random() * 4);
            }

            if (Math.abs(p.x - px) < 60 && Math.abs(p.y - py) < 60) {
                ctx.strokeStyle = pal.ink[p.c];
                ctx.globalAlpha = 0.16 * p.life + 0.05;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
        }

        // click ripples (soft)
        for (let i = bursts.length - 1; i >= 0; i--) {
            const b = bursts[i];
            b.r += 2.4 + (state.flux / 100) * 2.4;
            b.a *= 0.95;
            ctx.globalAlpha = b.a;
            ctx.strokeStyle = pal.ink[b.c];
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
            ctx.stroke();
            if (b.a < 0.02) bursts.splice(i, 1);
        }

        ctx.globalAlpha = 1;
        requestAnimationFrame(step);
    }

    // --- pointer ------------------------------------------------------------
    function setPointer(e) {
        const pt = e.touches ? e.touches[0] : e;
        pointer.x = pt.clientX;
        pointer.y = pt.clientY;
        pointer.active = true;
        moveSeed(pt.clientX, pt.clientY);
    }
    window.addEventListener("pointermove", setPointer);
    window.addEventListener("pointerdown", (e) => {
        pointer.down = true;
        setPointer(e);
        const pal = PALETTES[state.palette];
        bursts.push({ x: pointer.x, y: pointer.y, r: 3, a: 0.5, c: Math.floor(Math.random() * pal.ink.length) });
    });
    window.addEventListener("pointerup", () => { pointer.down = false; });
    window.addEventListener("pointerleave", () => { pointer.active = false; });

    // --- seed (interactive abstract title) ---------------------------------
    const seedSpans = Array.from(document.querySelectorAll("#seed span"));
    function moveSeed(x, y) {
        const nx = (x / w - 0.5);
        const ny = (y / h - 0.5);
        seedSpans.forEach((s, i) => {
            s.style.transform = `translate(${nx * (12 + i * 2)}px, ${ny * (8 + i)}px)`;
        });
    }

    function reglyph() {
        seedSpans.forEach((s, i) => {
            let count = 0;
            const iv = setInterval(() => {
                s.textContent = SEED_GLYPHS[Math.floor(Math.random() * SEED_GLYPHS.length)];
                if (++count > 4 + i) clearInterval(iv);
            }, 70);
        });
    }

    // --- control indicators -------------------------------------------------
    const modeDots = Array.from(document.querySelectorAll("#modeDots i"));
    const swatches = Array.from(document.querySelectorAll("#swatches i"));
    const densityInput = document.getElementById("density");
    const fluxInput = document.getElementById("flux");

    function paintMode() {
        const idx = MODES.indexOf(state.mode);
        modeDots.forEach((d, i) => d.classList.toggle("on", i === idx));
    }

    function paintPalette() {
        const pal = PALETTES[state.palette];
        swatches.forEach((s, i) => { s.style.background = pal.ink[i]; });
        document.documentElement.style.setProperty("--accent", pal.ink[0]);
        document.querySelector('meta[name="theme-color"]').setAttribute("content", pal.bg);
        ctx.fillStyle = pal.bg;
        ctx.fillRect(0, 0, w, h);
    }

    document.getElementById("modeBtn").addEventListener("click", () => {
        state.mode = MODES[(MODES.indexOf(state.mode) + 1) % MODES.length];
        paintMode();
    });
    document.getElementById("paletteBtn").addEventListener("click", () => {
        state.palette = PALETTE_KEYS[(PALETTE_KEYS.indexOf(state.palette) + 1) % PALETTE_KEYS.length];
        paintPalette();
    });
    densityInput.addEventListener("input", (e) => {
        state.density = +e.target.value;
        spawn(particleTarget());
    });
    fluxInput.addEventListener("input", (e) => { state.flux = +e.target.value; });

    // --- shuffle everything (click the seed) -------------------------------
    function shuffleAll() {
        state.mode = MODES[Math.floor(Math.random() * MODES.length)];
        state.palette = PALETTE_KEYS[Math.floor(Math.random() * PALETTE_KEYS.length)];
        state.density = Math.floor(Math.random() * 61) + 40;   // 40..100
        state.flux = Math.floor(Math.random() * 80) + 10;      // 10..89
        densityInput.value = state.density;
        fluxInput.value = state.flux;
        reseed((Math.random() * 0xffffffff) >>> 0);
        spawn(particleTarget());
        reglyph();
        paintMode();
        paintPalette();
    }
    document.getElementById("seed").addEventListener("click", shuffleAll);

    // --- boot ---------------------------------------------------------------
    window.addEventListener("resize", () => {
        clearTimeout(window.__rt);
        window.__rt = setTimeout(resize, 150);
    });

    reseed((Math.random() * 0xffffffff) >>> 0);
    resize();
    paintMode();
    paintPalette();
    requestAnimationFrame(step);
})();
