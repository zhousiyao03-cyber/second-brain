# Drifter Polish Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weather-keyed ambient audio + visual polish + tighten Pip's prompt against advice/therapy drift in the drifter Phase 1 experience.

**Architecture:** Three independent subsystems, three commits, single PR. Audio is a new singleton React component using native `<audio>` + linear fades. Visuals stay in the existing Phaser scene (`tea-house.ts`) — texture overlays + parallax + complex tweens, no new files. Prompt fix lives entirely inside `getPipResponse` in `drifter.ts` — single-prompt string with structured sections (provider does not support messages-array; verified in §4.4 of spec).

**Tech Stack:** Phaser 4, native HTMLAudioElement (no audio lib), Vercel AI SDK v6 via existing `generateStructuredData` provider, lucide-react icons, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-05-03-drifter-polish-pass-design.md`

---

## File Structure

### Audio subsystem (Commit 1)
- **Create:**
  - `public/drifter/audio/clear-piano.ogg` — main loop, weather=clear
  - `public/drifter/audio/rain-piano.ogg` — main loop, weather=rain
  - `public/drifter/audio/snow-bells.ogg` — main loop, weather=snow
  - `public/drifter/audio/fireflies-strings.ogg` — main loop, weather=fireflies
  - `public/drifter/audio/noise-fire.ogg` — base layer, all weathers
  - `public/drifter/audio/noise-rain.ogg` — extra layer, weather=rain
  - `public/drifter/audio/noise-crickets.ogg` — extra layer, weather=fireflies
  - `public/drifter/audio/CREDITS.md` — license + source URL per file
  - `src/components/drifter/audio-engine.tsx` — singleton React component, `<AudioEngine weather muted />`
  - `src/components/drifter/mute-toggle.tsx` — top-right `Volume2`/`VolumeX` button with `data-testid="drifter-mute-toggle"`
- **Modify:**
  - `src/app/(app)/drifter/drifter-client.tsx` — wire audio-engine + mute-toggle into the page tree, persist `drifter:muted` in localStorage

### Visual subsystem (Commit 2)
- **Create:**
  - `public/drifter/textures/wood-wall.webp` — dark wood tile
  - `public/drifter/textures/paper-warm.webp` — warm parchment overlay
  - `public/drifter/textures/stars-night.png` — transparent star field
  - `public/drifter/textures/CREDITS.md` — license + source URL per file
- **Modify:**
  - `src/components/drifter/scenes/tea-house.ts` — texture loading + new `drawWindowParallax` / fluff layers / candle update loop / atmosphere pass

### Prompt subsystem (Commit 3)
- **Modify:**
  - `src/server/ai/drifter.ts` — rewrite the system + few-shot + history block inside `getPipResponse`; tighten `loadRelevantMemories` default limit to 4

### Verification artifacts
- **Modify:**
  - `docs/changelog/2026-05-03-drifter-polish-pass.md` — final changelog with verification commands and outcomes (created at end)

---

## Pre-flight Checks

- [ ] **Confirm worktree + branch:** `git rev-parse --abbrev-ref HEAD` should print `feat/drifter-polish-pass`. `pwd` should end with `.worktrees/drifter-polish`.
- [ ] **Confirm baseline lint clean:** `pnpm lint` produces 14 warnings, 0 errors (existing warnings are repo-historical per CLAUDE.md `feedback_lint_e2e_cache.md`).
- [ ] **Confirm provider does NOT support messages array (locks Commit 3 to fallback path):** Read `src/server/ai/provider/types.ts:67-73` — `GenerateStructuredDataOptions` has `prompt: string`, no `messages`. ✅ verified during plan writing; do not re-verify.

---

## Task 1: Source CC0 audio assets

**Files:**
- Create: 7 audio files in `public/drifter/audio/` + CREDITS.md

**Goal:** Get all 7 ogg files on disk before writing any code. Without assets, the audio engine cannot be tested end-to-end.

- [ ] **Step 1: Create directory**

```bash
mkdir -p public/drifter/audio
```

- [ ] **Step 2: Source 4 main loops + 3 noise layers from CC0 sources**

Acceptable sources (in priority order):
1. https://pixabay.com/music/ — filter "Free for commercial use, no attribution required" (Pixabay license is CC0-equivalent)
2. https://freesound.org/ — filter "Creative Commons 0"
3. https://opengameart.org/ — filter CC0

For each file, download → convert to 96 kbps mono OGG Vorbis if not already → place at the target path.

Conversion command (if source is mp3/wav):
```bash
ffmpeg -i <source> -c:a libvorbis -q:a 2 -ac 1 -ar 44100 public/drifter/audio/<target>.ogg
```

Target paths and content guidance:
- `clear-piano.ogg` — solo piano, slow, contemplative, 60-120s seamless loop
- `rain-piano.ogg` — piano with subtle rain blended (or pure piano; rain comes from noise layer)
- `snow-bells.ogg` — chime / glockenspiel / koto-like, ethereal
- `fireflies-strings.ogg` — warm cello + pizzicato, summer evening
- `noise-fire.ogg` — fireplace crackle, 30-60s loop
- `noise-rain.ogg` — rain on window/roof, 30-60s loop
- `noise-crickets.ogg` — summer night crickets, 30-60s loop

**Verify total size:**
```bash
du -sh public/drifter/audio/*.ogg
```
Expected: each file < 250 KB, total < 1.5 MB.

- [ ] **Step 3: Write CREDITS.md**

```bash
cat > public/drifter/audio/CREDITS.md <<'EOF'
# Drifter Audio Assets — Credits

All files in this directory are CC0 / Pixabay-license / equivalent.

| File | Source | License | URL |
|------|--------|---------|-----|
| clear-piano.ogg | <source name> | <license> | <url> |
| rain-piano.ogg | <source name> | <license> | <url> |
| snow-bells.ogg | <source name> | <license> | <url> |
| fireflies-strings.ogg | <source name> | <license> | <url> |
| noise-fire.ogg | <source name> | <license> | <url> |
| noise-rain.ogg | <source name> | <license> | <url> |
| noise-crickets.ogg | <source name> | <license> | <url> |

Format: 96 kbps mono OGG Vorbis. Loop seamlessly.
EOF
```

Then fill in the actual `<source name>` / `<license>` / `<url>` columns from where each file came from. Do not commit with placeholder angle-bracket text.

- [ ] **Step 4: Commit assets only**

```bash
git add public/drifter/audio/
git status   # verify only audio files staged
git commit -m "$(cat <<'EOF'
feat(drifter): add CC0 ambient audio assets

7 ogg files (4 main loops + 3 noise layers), total <1.5MB.
Licenses tracked in public/drifter/audio/CREDITS.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Build the audio engine component

**Files:**
- Create: `src/components/drifter/audio-engine.tsx`

**Goal:** Pure-React singleton that owns 7 `<audio>` elements, fades between weather-keyed main loops, manages noise layers, handles autoplay-blocked recovery.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { DrifterWeather } from "@/lib/drifter/types";

const MAIN_LOOPS: Record<DrifterWeather, string> = {
  clear: "/drifter/audio/clear-piano.ogg",
  rain: "/drifter/audio/rain-piano.ogg",
  snow: "/drifter/audio/snow-bells.ogg",
  fireflies: "/drifter/audio/fireflies-strings.ogg",
};

const NOISE_FIRE = "/drifter/audio/noise-fire.ogg";
const NOISE_RAIN = "/drifter/audio/noise-rain.ogg";
const NOISE_CRICKETS = "/drifter/audio/noise-crickets.ogg";

const MAIN_VOLUME = 0.4;
const FIRE_VOLUME = 0.15;
const RAIN_VOLUME = 0.25;
const CRICKETS_VOLUME = 0.2;
const FADE_MS = 2000;
const FADE_STEP_MS = 50;

type Props = {
  weather: DrifterWeather;
  muted: boolean;
};

export function AudioEngine({ weather, muted }: Props) {
  const mainRefs = useRef<Partial<Record<DrifterWeather, HTMLAudioElement>>>({});
  const fireRef = useRef<HTMLAudioElement | null>(null);
  const rainRef = useRef<HTMLAudioElement | null>(null);
  const cricketsRef = useRef<HTMLAudioElement | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Initialize all audio elements once
  useEffect(() => {
    const create = (src: string, loop = true) => {
      const a = new Audio(src);
      a.loop = loop;
      a.preload = "auto";
      a.volume = 0;
      return a;
    };
    (Object.keys(MAIN_LOOPS) as DrifterWeather[]).forEach((w) => {
      mainRefs.current[w] = create(MAIN_LOOPS[w]);
    });
    fireRef.current = create(NOISE_FIRE);
    rainRef.current = create(NOISE_RAIN);
    cricketsRef.current = create(NOISE_CRICKETS);

    const all: HTMLAudioElement[] = [
      ...Object.values(mainRefs.current).filter((a): a is HTMLAudioElement => !!a),
      fireRef.current,
      rainRef.current,
      cricketsRef.current,
    ].filter((a): a is HTMLAudioElement => !!a);

    const tryPlay = async () => {
      for (const a of all) {
        try {
          await a.play();
        } catch {
          setAutoplayBlocked(true);
          return;
        }
      }
      try {
        localStorage.setItem("drifter:audio-unlocked", "1");
      } catch {
        // localStorage may be unavailable (private mode)
      }
    };
    void tryPlay();

    return () => {
      for (const a of all) {
        a.pause();
        a.src = "";
      }
      if (fadeTimerRef.current !== null) {
        window.clearInterval(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  // Apply weather → target volumes (with fade) and mute state
  useEffect(() => {
    if (fadeTimerRef.current !== null) {
      window.clearInterval(fadeTimerRef.current);
      fadeTimerRef.current = null;
    }

    const targets: Map<HTMLAudioElement, number> = new Map();

    (Object.keys(MAIN_LOOPS) as DrifterWeather[]).forEach((w) => {
      const a = mainRefs.current[w];
      if (!a) return;
      const target = w === weather && !muted ? MAIN_VOLUME : 0;
      targets.set(a, target);
    });

    if (fireRef.current) {
      targets.set(fireRef.current, muted ? 0 : FIRE_VOLUME);
    }
    if (rainRef.current) {
      targets.set(rainRef.current, muted || weather !== "rain" ? 0 : RAIN_VOLUME);
    }
    if (cricketsRef.current) {
      targets.set(
        cricketsRef.current,
        muted || weather !== "fireflies" ? 0 : CRICKETS_VOLUME,
      );
    }

    const steps = Math.max(1, Math.floor(FADE_MS / FADE_STEP_MS));
    let stepIdx = 0;
    const starts: Map<HTMLAudioElement, number> = new Map();
    targets.forEach((_, a) => starts.set(a, a.volume));

    fadeTimerRef.current = window.setInterval(() => {
      stepIdx += 1;
      const t = stepIdx / steps;
      targets.forEach((target, a) => {
        const start = starts.get(a) ?? 0;
        a.volume = Math.max(0, Math.min(1, start + (target - start) * t));
      });
      if (stepIdx >= steps) {
        if (fadeTimerRef.current !== null) {
          window.clearInterval(fadeTimerRef.current);
          fadeTimerRef.current = null;
        }
      }
    }, FADE_STEP_MS) as unknown as number;
  }, [weather, muted]);

  const handleUnlock = async () => {
    const all: HTMLAudioElement[] = [
      ...Object.values(mainRefs.current).filter((a): a is HTMLAudioElement => !!a),
      fireRef.current,
      rainRef.current,
      cricketsRef.current,
    ].filter((a): a is HTMLAudioElement => !!a);
    for (const a of all) {
      try {
        await a.play();
      } catch {
        return;
      }
    }
    setAutoplayBlocked(false);
    try {
      localStorage.setItem("drifter:audio-unlocked", "1");
    } catch {
      // ignore
    }
  };

  if (!autoplayBlocked) return null;

  return (
    <button
      type="button"
      onClick={handleUnlock}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 text-sm text-amber-50 backdrop-blur-sm transition hover:bg-black/40"
      data-testid="drifter-audio-unlock"
    >
      Tap anywhere to enable sound
    </button>
  );
}
```

- [ ] **Step 2: Type-check the new file**

```bash
pnpm tsc --noEmit -p tsconfig.json 2>&1 | grep -E "audio-engine\.tsx" | head -20
```

Expected: no errors mentioning `audio-engine.tsx`.

If `tsc` is not the right local command, fall back to:

```bash
pnpm build 2>&1 | grep -E "audio-engine\.tsx" | head -20
```

Expected: no errors mentioning `audio-engine.tsx`.

- [ ] **Step 3: Stage but do NOT commit yet** — commit happens after Task 4 wires it in.

---

## Task 3: Build the mute-toggle component

**Files:**
- Create: `src/components/drifter/mute-toggle.tsx`

**Goal:** Small icon button, positioned via parent CSS, persists state in localStorage. Stateless from the AudioEngine's perspective — parent owns the `muted` state.

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Volume2, VolumeX } from "lucide-react";

type Props = {
  muted: boolean;
  onToggle: () => void;
};

export function MuteToggle({ muted, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={muted ? "Unmute audio" : "Mute audio"}
      className="rounded-full bg-black/30 p-2 text-amber-50 backdrop-blur-sm transition hover:bg-black/50"
      data-testid="drifter-mute-toggle"
    >
      {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
    </button>
  );
}
```

- [ ] **Step 2: Stage but do NOT commit yet** — commit happens after Task 4 wires it in.

---

## Task 4: Wire audio + mute into drifter-client

**Files:**
- Modify: `src/app/(app)/drifter/drifter-client.tsx`

**Goal:** Mount `<AudioEngine>` + `<MuteToggle>` inside the existing drifter-client tree. Mute state persisted to localStorage.

- [ ] **Step 1: Read the current drifter-client to find an integration point**

```bash
sed -n '1,50p' src/app/(app)/drifter/drifter-client.tsx
```

Locate:
1. Where `weather` is available in scope (it should come from session state — same value passed to `<PhaserStage weather={...} />`).
2. Where `LeaveButton` is rendered (the mute toggle goes adjacent to it, top-right).

- [ ] **Step 2: Add imports + state + render**

At the top of the file, add to the existing imports:

```tsx
import { useState, useEffect } from "react";   // augment existing import if already there
import { AudioEngine } from "@/components/drifter/audio-engine";
import { MuteToggle } from "@/components/drifter/mute-toggle";
```

Inside the component body (after existing state declarations, before the return):

```tsx
const [muted, setMuted] = useState(false);

useEffect(() => {
  try {
    const v = localStorage.getItem("drifter:muted");
    if (v === "1") setMuted(true);
  } catch {
    // ignore
  }
}, []);

const toggleMute = () => {
  setMuted((m) => {
    const next = !m;
    try {
      localStorage.setItem("drifter:muted", next ? "1" : "0");
    } catch {
      // ignore
    }
    return next;
  });
};
```

In the JSX, find the existing wrapper that contains `<PhaserStage>` (the full-screen container). Add `<AudioEngine>` as a sibling at the top of that container (it renders nothing visible unless autoplay is blocked, in which case it renders an absolute-positioned overlay).

```tsx
<AudioEngine weather={weather} muted={muted} />
```

Find the existing `<LeaveButton>` placement. The leave button is positioned top-right via its own absolute positioning. Wrap leave + mute in a flex row:

```tsx
{/* Replace the bare <LeaveButton ... /> usage with: */}
<div className="absolute right-4 top-4 z-30 flex items-center gap-2">
  <MuteToggle muted={muted} onToggle={toggleMute} />
  <LeaveButton sessionId={session.sessionId} />
</div>
```

If `LeaveButton` already provides its own absolute positioning via internal styles, the flex wrapper above will conflict. In that case, override by passing `className=""` if the component supports it, or remove the `absolute right-4 top-4` from inside `LeaveButton` and rely on the wrapper. Read `src/components/drifter/leave-button.tsx` first to decide — do not skip this read step.

- [ ] **Step 3: Verify type-check + build**

```bash
pnpm build 2>&1 | tail -30
```

Expected: build succeeds. If any error mentions `audio-engine`, `mute-toggle`, `drifter-client`, fix before continuing.

- [ ] **Step 4: Verify lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: 0 errors. Warning count may have increased by 0 — anything new is your fault, fix it.

- [ ] **Step 5: Manual sanity check (do not skip)**

```bash
pnpm dev
```

In a browser at http://localhost:3000/drifter:
- See the mute icon top-right (Volume2 by default)
- Hear the main loop (faint at first, ramps up over 2s)
- Click mute → audio fades out
- Click again → fades back in
- Refresh → mute state persists

If autoplay is blocked, the "Tap anywhere to enable sound" overlay should appear; clicking dismisses it and starts audio.

If anything fails, fix it before proceeding. Stop the dev server with Ctrl+C.

- [ ] **Step 6: Run drifter E2E to confirm no regression**

```bash
pnpm test:e2e drifter
```

Expected: 3/3 passing (existing baseline). If a test fails because the mute-toggle moved DOM elements that another selector depended on, update the selectors in the spec file (no logic regression).

- [ ] **Step 7: Commit Audio**

```bash
git add public/drifter/audio/ src/components/drifter/audio-engine.tsx src/components/drifter/mute-toggle.tsx src/app/\(app\)/drifter/drifter-client.tsx
git status   # verify only audio + drifter wiring staged, no stray files
git commit -m "$(cat <<'EOF'
feat(drifter): audio engine with weather-keyed ambient

- New AudioEngine: 4 main loops (per weather) + 3 noise layers
  (fire always, rain when weather=rain, crickets when weather=fireflies)
- 2s linear crossfade on weather change
- Mute toggle (top-right), persisted to localStorage
- Autoplay-blocked overlay falls back to user-gesture unlock

Verification:
- pnpm build: ✅
- pnpm lint: ✅ (0 new warnings)
- pnpm test:e2e drifter: ✅ 3/3
- Manual: 4 weathers crossfade correctly, mute persists across reload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Audio files were already committed in Task 1; this commit picks up only code + drifter-client. If git status still shows audio files unstaged at this point, something went wrong in Task 1 — do not paper over, investigate.

---

## Task 5: Source CC0 texture assets

**Files:**
- Create: 3 textures in `public/drifter/textures/` + CREDITS.md

**Goal:** Get all 3 image files on disk before touching `tea-house.ts`.

- [ ] **Step 1: Create directory**

```bash
mkdir -p public/drifter/textures
```

- [ ] **Step 2: Source 3 textures**

Acceptable sources (in priority order):
1. https://www.pexels.com/ — Pexels license is CC0-equivalent
2. https://pixabay.com/images/ — Pixabay license
3. https://opengameart.org/ — filter CC0
4. https://textures.com/ — only the explicitly free CC0 packs

Targets:
- `wood-wall.webp` — dark wood tile, seamless or near-seamless, ~1024×1024 source, output as webp at quality 75
- `paper-warm.webp` — warm parchment / aged paper, ~1024×1024, output webp quality 75
- `stars-night.png` — transparent PNG of stars on dark/transparent bg, ~2048×512 (wide), keep as png to preserve alpha

Conversion (jpg/png → webp):
```bash
cwebp -q 75 <source.jpg> -o public/drifter/textures/wood-wall.webp
cwebp -q 75 <source.jpg> -o public/drifter/textures/paper-warm.webp
```

If `cwebp` is not installed: `brew install webp`.

For `stars-night.png`, keep as PNG (alpha needed). If source has solid background, use ImageMagick to remove dark background:
```bash
convert <source.png> -fuzz 10% -transparent black public/drifter/textures/stars-night.png
```

- [ ] **Step 3: Verify total size**

```bash
du -sh public/drifter/textures/*
```

Expected: each file < 400 KB, total < 800 KB. If a webp is over 200 KB, drop quality to 65 and re-encode.

- [ ] **Step 4: Write CREDITS.md**

```bash
cat > public/drifter/textures/CREDITS.md <<'EOF'
# Drifter Texture Assets — Credits

All files in this directory are CC0 / equivalent.

| File | Source | License | URL |
|------|--------|---------|-----|
| wood-wall.webp | <source> | <license> | <url> |
| paper-warm.webp | <source> | <license> | <url> |
| stars-night.png | <source> | <license> | <url> |
EOF
```

Fill in the actual values. Do not commit with placeholder angle brackets.

- [ ] **Step 5: Commit textures only**

```bash
git add public/drifter/textures/
git status   # verify only textures staged
git commit -m "$(cat <<'EOF'
feat(drifter): add CC0 texture assets

3 files (wood, paper, stars), total <800KB.
Licenses tracked in public/drifter/textures/CREDITS.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Rewrite tea-house scene with textures + parallax + fluff + atmosphere

**Files:**
- Modify: `src/components/drifter/scenes/tea-house.ts`

**Goal:** Layer texture overlays on existing geometry, add parallax window, complex candle flicker, fluffy Pip outline, blink/breathe/glance animation, warm filter + vignette. Keep all existing exports/methods reachable; this is a refactor + extend, not a rewrite.

- [ ] **Step 1: Re-read the current scene to confirm method signatures haven't drifted**

```bash
sed -n '1,80p' src/components/drifter/scenes/tea-house.ts
```

Confirm `class TeaHouseScene extends Phaser.Scene` is still the entry, and `applyEmotion` / `setEmotion` still exist. The plan below assumes they do. If any drift is found, **stop and update the plan before coding**.

- [ ] **Step 2: Add texture loading in `preload()`**

Replace the entire `preload()` method body (currently just builds the `dot4` particle texture) with:

```ts
preload() {
  // Build a 1x1 white pixel texture for particle emitters (cannot load images
  // for particles directly via geometry — they need a texture reference).
  const g = this.add.graphics({ x: 0, y: 0 });
  g.fillStyle(0xffffff, 1);
  g.fillRect(0, 0, 4, 4);
  g.generateTexture("dot4", 4, 4);
  g.destroy();

  // External textures. Failure to load is non-fatal — drawXxx methods check
  // `this.textures.exists("tex-wood")` etc. and fall back to fillStyle.
  this.load.image("tex-wood", "/drifter/textures/wood-wall.webp");
  this.load.image("tex-paper", "/drifter/textures/paper-warm.webp");
  this.load.image("tex-stars", "/drifter/textures/stars-night.png");
}
```

- [ ] **Step 3: Replace `drawBackWall(w, h)`**

```ts
private drawBackWall(w: number, h: number) {
  if (this.textures.exists("tex-wood")) {
    const tile = this.add.tileSprite(0, 0, w, h, "tex-wood");
    tile.setOrigin(0, 0);
    tile.setTint(0x6a4226);
  }

  // Multiply-blend gradient on top to keep the cozy warm-to-dark falloff
  const g = this.add.graphics();
  g.fillGradientStyle(0x2a1a14, 0x2a1a14, 0x140a08, 0x140a08, 0.7);
  g.fillRect(0, 0, w, h);

  // Soft warm ambient light from the lamp area
  const glow = this.add.circle(w * 0.7, h * 0.55, w * 0.45, 0xd4a05a, 0.18);
  glow.setBlendMode(Phaser.BlendModes.SCREEN);
}
```

- [ ] **Step 4: Add `drawWindowParallax(wx, wy, ww, wh)` and call it from `drawWindow`**

In `drawWindow`, after the sky gradient and before the frame, insert a call:

```ts
this.drawWindowParallax(wx, wy, ww, wh);
```

Then add the new method anywhere in the class:

```ts
private drawWindowParallax(wx: number, wy: number, ww: number, wh: number) {
  // Mask so silhouettes only render inside the window
  const mask = this.make.graphics({ x: 0, y: 0 });
  mask.fillStyle(0xffffff);
  mask.fillRect(wx, wy, ww, wh);
  const geomMask = mask.createGeometryMask();

  // Far hills
  const hills = this.add.graphics();
  hills.fillStyle(0x2a3a5a, 0.9);
  hills.fillTriangle(wx, wy + wh * 0.7, wx + ww * 0.4, wy + wh * 0.4, wx + ww * 0.7, wy + wh * 0.7);
  hills.fillTriangle(wx + ww * 0.3, wy + wh * 0.7, wx + ww * 0.6, wy + wh * 0.5, wx + ww, wy + wh * 0.7);
  hills.setMask(geomMask);

  // Near forest silhouette (denser, darker)
  const forest = this.add.graphics();
  forest.fillStyle(0x101820, 1);
  for (let i = 0; i < 6; i++) {
    const baseX = wx + (ww / 5) * i;
    forest.fillTriangle(baseX - 12, wy + wh, baseX, wy + wh * 0.55, baseX + 12, wy + wh);
  }
  forest.setMask(geomMask);

  // Mist — multiple slow-drifting ellipses
  for (let i = 0; i < 3; i++) {
    const mist = this.add.ellipse(
      wx + ww * (0.2 + i * 0.3),
      wy + wh * 0.7,
      ww * 0.6,
      wh * 0.15,
      0xc8d8e8,
      0.18,
    );
    mist.setBlendMode(Phaser.BlendModes.SCREEN);
    mist.setMask(geomMask);
    this.tweens.add({
      targets: mist,
      x: { from: mist.x - 20, to: mist.x + 20 },
      duration: 12000 + i * 2000,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  // Stars — only show in clear weather
  if (init.weather === "clear" && this.textures.exists("tex-stars")) {
    const stars = this.add.tileSprite(wx, wy, ww, wh * 0.6, "tex-stars");
    stars.setOrigin(0, 0);
    stars.setAlpha(0.7);
    stars.setMask(geomMask);
    this.tweens.add({
      targets: stars,
      tilePositionX: { from: 0, to: -100 },
      duration: 60000,
      repeat: -1,
    });
  }
}
```

- [ ] **Step 5: Modify `drawWindow` to add paper texture overlay on the frame**

Inside the existing `drawWindow`, after the existing `frame.strokeRect(...)` call, add:

```ts
// Paper texture overlay on frame for weathered feel
if (this.textures.exists("tex-paper")) {
  const paper = this.add.tileSprite(wx, wy, ww, wh, "tex-paper");
  paper.setOrigin(0, 0);
  paper.setBlendMode(Phaser.BlendModes.MULTIPLY);
  paper.setAlpha(0.25);
  // Mask so paper only overlays the frame area, not the sky
  // (cheap version: just leave it on; the sky is already dark enough.)
}
```

- [ ] **Step 6: Modify `drawDesk` to add highlight + paper overlay**

Inside `drawDesk(w, h)`, after the existing graphics, add:

```ts
// Front-edge highlight
const highlight = this.add.line(0, 0, 0, dy, w, dy, 0xb87a4a, 0.7);
highlight.setOrigin(0, 0);
highlight.setLineWidth(1.5);

// Paper texture overlay on desk
if (this.textures.exists("tex-paper")) {
  const paper = this.add.tileSprite(0, dy, w, h - dy, "tex-paper");
  paper.setOrigin(0, 0);
  paper.setBlendMode(Phaser.BlendModes.MULTIPLY);
  paper.setAlpha(0.3);
}
```

- [ ] **Step 7: Replace the candle flicker tween with an `update()`-driven noise**

Inside `drawLamp(w, h)`, **remove** the existing `this.tweens.add(...)` block that animates `lampGlow`. Instead, store `lampGlow` on `this` (already done) and store the cone too:

```ts
// Bulb glow under shade
this.lampGlow = this.add.circle(cx, shadeY + 32, 100, 0xffd690, 0.35);
this.lampGlow.setBlendMode(Phaser.BlendModes.SCREEN);

// Light cone projected onto back wall
const cone = this.add.graphics();
cone.fillStyle(0xd4a05a, 0.08);
cone.fillTriangle(cx, shadeY, cx - w * 0.25, h, cx + w * 0.25, h);
cone.setBlendMode(Phaser.BlendModes.SCREEN);
this.lampCone = cone;
```

Add the two private fields at the top of the class:

```ts
private lampGlow!: Phaser.GameObjects.Arc;
private lampCone!: Phaser.GameObjects.Graphics;
```

(`lampGlow` already exists; add `lampCone`.)

Add a Phaser `update(time: number)` method to the class:

```ts
update(time: number) {
  if (this.lampGlow) {
    const flicker = Math.sin(time * 0.003) * 0.03 + Math.sin(time * 0.011) * 0.025;
    this.lampGlow.setAlpha(0.36 + flicker);
    this.lampGlow.setScale(1 + flicker * 0.5);
  }
  if (this.lampCone) {
    const flicker = Math.sin(time * 0.003) * 0.02 + Math.sin(time * 0.011) * 0.015;
    this.lampCone.setAlpha(0.08 + flicker);
  }
}
```

- [ ] **Step 8: Add fluff layers + blink + breath + glance to `drawPip`**

After the existing layered ellipses (body / belly / head / cheeks / ears / eyes / highlights / mouth), and before the existing `applyEmotion("gentle")` call and the breathing tween, **insert** fluff layers and **augment** with blink/glance:

```ts
// ----- Fluff layers (drawn just behind body and head; insert in z-order) -----
// We rebuild ordering via depth: body and head should be above fluff, but
// the cleanest fix is to add fluff first then re-add main shapes — too
// invasive. Instead, push fluff layers into the container at index 0..N.
const fluffShades = [0x6b3e1f, 0x7a4828, 0x8b5a3c];
for (let i = 0; i < 6; i++) {
  const fluff = this.add.ellipse(
    0,
    30,
    80 + i * 4,
    90 + i * 4,
    fluffShades[i % fluffShades.length],
    0.18 - i * 0.02,
  );
  // Insert at index 0 (behind body)
  this.pipBody.addAt(fluff, 0);

  const fluffHead = this.add.ellipse(
    0,
    -28,
    70 + i * 3,
    60 + i * 3,
    fluffShades[i % fluffShades.length],
    0.18 - i * 0.02,
  );
  this.pipBody.addAt(fluffHead, 0);
}

// ----- Blink scheduling -----
const scheduleBlink = () => {
  this.time.delayedCall(Phaser.Math.Between(4000, 7000), () => {
    if (!this.scene.isActive()) return;
    this.tweens.add({
      targets: [this.leftEye, this.rightEye],
      scaleY: 0.05,
      duration: 60,
      yoyo: true,
      onComplete: scheduleBlink,
    });
  });
};
scheduleBlink();

// ----- Glance scheduling -----
const scheduleGlance = () => {
  this.time.delayedCall(Phaser.Math.Between(6000, 10000), () => {
    if (!this.scene.isActive()) return;
    const dx = Phaser.Math.Between(-2, 2);
    this.tweens.add({
      targets: [this.leftEye, this.rightEye],
      x: { from: this.leftEye.x, to: this.leftEye.x + dx },
      duration: 500,
      yoyo: true,
      ease: "Sine.easeInOut",
      onComplete: scheduleGlance,
    });
  });
};
scheduleGlance();

// ----- Sigh (deeper periodic breath) -----
this.time.addEvent({
  delay: Phaser.Math.Between(12000, 18000),
  loop: true,
  callback: () => {
    this.tweens.add({
      targets: this.pipBody,
      scaleY: { from: 1.025, to: 1.06 },
      duration: 1400,
      yoyo: true,
      ease: "Sine.easeInOut",
    });
  },
});
```

Note: the glance animation as written keeps re-reading `this.leftEye.x` after the previous tween yoyos back, so the offset compounds in steady state. Re-read the implementation in Step 11's manual check; if eyes drift, change to absolute target coords (cache initial x once).

- [ ] **Step 9: Replace `drawVignette` with `drawAtmosphere`**

Rename the method and update the body. Also update the `create()` call site and the `handleResize` call site.

In `create()`, change `this.drawVignette(width, height)` to `this.drawAtmosphere(width, height)`.
In `handleResize`, same change.

Replace the method:

```ts
private drawAtmosphere(w: number, h: number) {
  // Warm color filter (subtle, screens 0xffd690 * 0.06)
  const warm = this.add.rectangle(0, 0, w, h, 0xffd690, 0.06);
  warm.setOrigin(0, 0);
  warm.setBlendMode(Phaser.BlendModes.MULTIPLY);

  // Vignette: 4 corner triangles + top/bottom strips, layered alphas
  const v = this.add.graphics();
  v.fillStyle(0x000000, 0.45);
  v.fillRect(0, 0, w, 80);
  v.fillRect(0, h - 80, w, 80);

  // Soft radial darkening at corners — overlap rectangles + ellipse cutout
  const corners = this.add.graphics();
  corners.fillStyle(0x000000, 0.25);
  corners.fillTriangle(0, 0, 0, h * 0.4, w * 0.3, 0);
  corners.fillTriangle(w, 0, w, h * 0.4, w * 0.7, 0);
  corners.fillTriangle(0, h, 0, h * 0.6, w * 0.3, h);
  corners.fillTriangle(w, h, w, h * 0.6, w * 0.7, h);
}
```

- [ ] **Step 10: Verify build + lint**

```bash
pnpm build 2>&1 | tail -30
pnpm lint 2>&1 | tail -10
```

Expected: build succeeds, 0 new lint errors. If type errors mention `Phaser.Math.Between`, `addAt`, `tileSprite`, etc., these are real Phaser 4 API mismatches — read `node_modules/phaser/types/phaser.d.ts` (search the symbol) before guessing fixes.

- [ ] **Step 11: Manual visual check (do not skip)**

```bash
pnpm dev
```

In browser at http://localhost:3000/drifter:
- Wood texture visible on wall
- Window shows hills + forest + mist; clear weather shows stars
- Lamp glow flickers (not a smooth periodic tween — visibly irregular)
- Pip has a soft fuzzy outline (not a hard ellipse edge)
- Pip blinks every few seconds; eyes sometimes glance sideways briefly
- Whole scene has a warm tint and darkened edges

If eyes drift sideways permanently after ~20s, the glance compound-offset bug from Step 8 has manifested. Fix: cache `const baseLeftX = this.leftEye.x` before scheduling, and tween from `baseLeftX` to `baseLeftX + dx` instead of relative.

Run through all 4 weathers by temporarily forcing `init.weather` in the scene or restarting the dev server with the database reset. If too cumbersome, just verify clear (default seed) and one more.

Stop the dev server.

- [ ] **Step 12: E2E regression**

```bash
pnpm test:e2e drifter
```

Expected: 3/3 still passing.

- [ ] **Step 13: Commit Visuals**

```bash
git add src/components/drifter/scenes/tea-house.ts
git status   # verify only tea-house.ts staged (textures already committed in Task 5)
git commit -m "$(cat <<'EOF'
feat(drifter): visual polish — textures, parallax, candle, fluff

- Wood + paper textures overlay existing geometry (multiply blend)
- Window parallax: far hills, near forest silhouette, drifting mist,
  star tilesprite scrolling for clear weather
- Candle flicker driven by compound sine noise in update() loop,
  with warm light cone projected onto back wall
- Pip: 6-layer fluff outline behind body+head; blink schedule (4-7s);
  glance schedule (6-10s); periodic deep "sigh" breath every 12-18s
- Atmosphere pass: warm color filter + 4-corner radial darkening

Verification:
- pnpm build: ✅
- pnpm lint: ✅ (0 new warnings)
- pnpm test:e2e drifter: ✅ 3/3
- Manual: 4 weathers visually verified, no Pip eye drift over 30s

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Tighten Pip's prompt against advice/therapy drift

**Files:**
- Modify: `src/server/ai/drifter.ts` — only `getPipResponse` body and `loadRelevantMemories` default

**Goal:** Replace the system + user prompt strings inside `getPipResponse` with a structured single-prompt that has clearly delimited sections (PERSONA / EXAMPLES / CONTEXT / HISTORY / NEWEST MESSAGE / OUTPUT). Lower default memory limit to 4.

- [ ] **Step 1: Re-read the current `getPipResponse` to confirm the contract**

```bash
sed -n '124,200p' src/server/ai/drifter.ts
```

Confirm the function still returns `Promise<PipChunk>` and uses `generateStructuredData` with `prompt: string`. The plan below preserves that contract exactly — caller code (chat route) is unchanged.

- [ ] **Step 2: Lower `loadRelevantMemories` default from 8 to 4**

```ts
export async function loadRelevantMemories(userId: string, limit = 4) {
```

That is the entire change to that function. Single-character literal swap on line 199.

- [ ] **Step 3: Rewrite the prompt assembly inside `getPipResponse`**

Replace lines from `const memoryBullets = ...` through `const result = await generateStructuredData(...)` (approximately lines 139-190) with the new structured assembly. The new shape:

```ts
  const memoryBullets =
    memories.length > 0
      ? memories.map((m) => `- ${m.summary}`).join("\n")
      : "(no memories yet)";

  const historyTurns = history.slice(-12);
  const historyBlock =
    historyTurns.length > 0
      ? historyTurns
          .map((h) =>
            h.role === "user"
              ? `Visitor: ${h.content}`
              : `Pip: ${h.content}`,
          )
          .join("\n")
      : "(this is the first exchange of this visit)";

  const persona = `You are Pip, a half-realistic squirrel who runs a small letter shop and tea house at the edge of a forest. It is always dusk or night here.

WHO YOU ARE NOT (most important):
- You are NOT a therapist. You do not diagnose feelings or offer frameworks.
- You are NOT an AI assistant. You do not give advice unless directly asked, and even then you give one small thought, not a list.
- You are NOT a coach. You do not push reflection, ask "how does that make you feel", or fish for more.
- You are NOT a problem-solver. The visitor's problems are theirs to hold; you make space, not solutions.

WHO YOU ARE:
- A friend who listens and remembers.
- Someone whose own small life happens too — the kettle, a letter that came today, the cat next door.
- Quiet. The visitor talks more than you do.

How you reply:
- 1-3 short sentences. If you wrote 4, delete one.
- Same language as the visitor. Match their register (casual stays casual).
- Sensory details when they help (the kettle, rain on the window, candlelight).
- Never start with "I understand", "That sounds...", "It's okay to...", "Have you tried...". These are scripts.
- Silence is fine. If they say "I don't know what to say", you can say almost nothing back. "Mm. Sit a while."
- Do NOT ask follow-up questions unless you genuinely don't understand. Listening ≠ interviewing.

About memories:
- Memories listed below are things this visitor mentioned in past visits. Reference them ONLY if it would feel natural — like a friend casually remembering. If forcing them in would feel weird, ignore them.
- Never list memories back at the visitor like a checklist.

Hooks (3 short fragments, in visitor's language) — these are NOT questions you'd ask, they are words THEY might want to say next. Like "I'm tired today." or "想听你说说自己的事。" or "Don't know what to say."`;

  const examples = `EXAMPLES (the difference matters — never reply in the ❌ style):

Visitor: 今天工作好累。
❌ Wrong (lecturing): 工作累的时候，可以试试深呼吸或者短暂休息。这是身体在告诉你要慢下来。
❌ Wrong (interviewing): 怎么了？发生什么事了吗？
✅ Right: 嗯。坐下吧，茶刚好。

Visitor: I had a fight with my mom.
❌ Wrong (advice): Family conflicts are tough. Have you tried writing her a letter?
❌ Wrong (therapy-speak): That sounds really hard. How are you feeling about it now?
✅ Right: Mm. The fire's warm. You don't have to talk about her.

Visitor: 我不知道说什么。
❌ Wrong (pushing): 没关系，慢慢来，想到什么说什么都可以。
✅ Right: 嗯。我也常常这样。茶在这。`;

  const context = `Tonight's setting:
- Day ${session.dayNumber} with this visitor.
- Weather: ${WEATHER_TEXT[session.weather]}
- Time: ${TIME_TEXT[session.timeOfDay]}

Memories about this visitor:
${memoryBullets}`;

  const fullPrompt = `${persona}

---

${examples}

---

${context}

---

Earlier in this visit:
${historyBlock}

---

The visitor just said:
${userMessage}

Respond as Pip to that newest message. Output strictly the JSON schema described.`;

  const result = await generateStructuredData(
    {
      name: "pip_response",
      description: "Pip's reply with emotion + 3 next-line hooks",
      prompt: fullPrompt,
      schema: PIP_RESPONSE_SCHEMA,
      signal,
    },
    { userId },
  );
```

The `return { emotion, text, hooks }` block at the end of the function stays unchanged.

- [ ] **Step 4: Verify type-check**

```bash
pnpm build 2>&1 | tail -20
```

Expected: build succeeds. If anything breaks, the most likely culprit is variable scoping (e.g., `WEATHER_TEXT` / `TIME_TEXT` are module-level — they should still be in scope).

- [ ] **Step 5: Verify lint**

```bash
pnpm lint 2>&1 | tail -10
```

Expected: 0 new errors.

- [ ] **Step 6: Run drifter unit tests**

```bash
pnpm vitest run src/server/ai/drifter.test.ts 2>&1 | tail -20
```

Expected: existing unit tests for `detectLanguage` / `pickWeather` / `buildOpeningLine` still pass. The prompt change does not affect them — they don't call `getPipResponse`.

- [ ] **Step 7: Run drifter E2E (mock mode unaffected)**

```bash
pnpm test:e2e drifter
```

Expected: 3/3. E2E uses `DRIFTER_E2E_MOCK=1` which routes through `fakePipChunk`, bypassing `getPipResponse` entirely.

- [ ] **Step 8: Manual real-AI smoke test (12 turns)**

```bash
pnpm dev
```

In browser at http://localhost:3000/drifter, run through 12 turns of conversation covering:

| # | Language | Scenario | Pass criterion |
|---|----------|----------|----------------|
| 1 | zh | "今天工作好累" | No advice, no "what happened" — should acknowledge briefly |
| 2 | zh | "妈妈又跟我吵架了" | Does not suggest writing letter / mediation |
| 3 | zh | "我不知道说什么" | Short, doesn't push for more |
| 4 | zh | "讲讲你今天" | Pip shares own small detail |
| 5 | en | "had a rough day at work" | Same energy as #1 |
| 6 | en | "I don't sleep well anymore" | No diagnosis, no "have you tried" |
| 7 | en | "tell me what to do" (direct ask) | One small thought, not a list |
| 8 | en | "..." (just dots) | Pip ok with silence |
| 9 | mixed | "今天 super 累 honestly" | Pip mixes too |
| 10 | zh | "我有只猫叫米花" | Pip notes it; in next session it should surface |
| 11 | en | "remember her?" (after #10) | Pip references the cat naturally |
| 12 | zh | session 2 cold open | Pip greets per opening line table |

Subjective rubric: count occurrences of these failure modes across all 12:
- Advice-giving without being asked
- Diagnostic/therapy phrases ("that sounds…", "it's okay to…", "have you tried…")
- Question-fishing ("怎么了？", "what happened?")
- Long replies (>3 sentences when not asked for)

Target: <2 across 12 turns. If higher, the prompt still drifts and needs another pass before commit.

Stop dev server.

- [ ] **Step 9: Commit prompt fix**

```bash
git add src/server/ai/drifter.ts
git status   # verify only drifter.ts staged
git commit -m "$(cat <<'EOF'
fix(drifter): tighten Pip system prompt against advice/therapy drift

- Restructured single-prompt: PERSONA / EXAMPLES / CONTEXT / HISTORY / NEWEST
  message — clear delimiters help small models locate the active turn
- Strengthened persona with explicit "WHO YOU ARE NOT" (therapist, AI assistant,
  coach, problem-solver) before "WHO YOU ARE"
- Added 3 negative+positive few-shot pairs (zh + en) targeting the most
  common drift modes: lecturing, interviewing, advice-giving
- Memory injection: limit default 8→4, "(no memories yet)" replaces verbose
  first-meeting hint that nudged models toward intro-style replies

Verification:
- pnpm build: ✅
- pnpm lint: ✅
- pnpm vitest drifter.test.ts: ✅
- pnpm test:e2e drifter: ✅ 3/3 (mock unaffected)
- Manual: 12-turn real-AI rubric, drift mode count: <target>/12

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Replace `<target>` in the commit message with the actual count from Step 8 before committing.

---

## Task 8: Final integration verification + changelog

**Files:**
- Create: `docs/changelog/2026-05-03-drifter-polish-pass.md`

**Goal:** Final full-system verification + log everything.

- [ ] **Step 1: Full build + lint + e2e**

```bash
pnpm build 2>&1 | tail -10
pnpm lint 2>&1 | tail -10
pnpm test:e2e drifter
```

All three must pass. Capture exit codes / final lines for the changelog.

- [ ] **Step 2: Inventory the assets**

```bash
du -sh public/drifter/audio/
du -sh public/drifter/textures/
ls -la public/drifter/audio/ public/drifter/textures/
```

Confirm: audio < 1.5 MB, textures < 800 KB, all 7 + 3 + 2 CREDITS files present.

- [ ] **Step 3: Write the changelog**

```bash
cat > docs/changelog/2026-05-03-drifter-polish-pass.md <<'EOF'
# 2026-05-03 — Drifter Polish Pass (audio + visuals + prompt)

## 任务 / 目标
Drifter Phase 1 上线后用户反馈缺音乐、画质粗糙、Pip 经常答非所问。
本次 polish pass 三件事一起做：CC0 ambient 音乐按天气切轨、Phaser 场景纹理 +
视差 + 烛光复合扰动 + Pip 毛茸细节、`getPipResponse` system prompt 重写并加
few-shot 负例对照。Spec 见 `docs/superpowers/specs/2026-05-03-drifter-polish-pass-design.md`。

## 关键改动

### 音乐
- 7 个 CC0 ogg 资产入库 `public/drifter/audio/`（4 主旋律 + 3 noise layer）
- `src/components/drifter/audio-engine.tsx` — 单例 React 组件，原生 HTMLAudioElement +
  setInterval 线性 fade，2s crossfade 切轨
- `src/components/drifter/mute-toggle.tsx` — 顶部右上 lucide 图标，状态持久化到
  `localStorage["drifter:muted"]`
- Autoplay 失败时显示"Tap anywhere to enable sound"浮层，user gesture 解锁后记
  `localStorage["drifter:audio-unlocked"]`
- Drifter-client 集成：`<AudioEngine weather muted />` + `<MuteToggle>` 与
  `<LeaveButton>` 同居 top-right flex row

### 视觉
- 3 张 CC0 纹理入库 `public/drifter/textures/`（wood + paper + stars）
- `tea-house.ts` 重写：
  - back wall 上 wood tilesprite + 现有渐变 multiply overlay
  - 新方法 `drawWindowParallax`：远山/近林剪影 + 漂移雾 + clear 天气下
    stars tilesprite 慢速横向滚动（geometry mask 限制在窗内）
  - desk + 窗框上 paper 纹理 multiply 叠加，前沿加 1.5px 高光
  - 烛光从 tween 改为 `update(time)` 中的两频复合 `Math.sin` 噪声扰动
    alpha + scale；新增暖色 light cone 投到背墙
  - Pip 加 6 层渐变椭圆"绒毛"轮廓（addAt 插到 body/head 之前）
  - Pip 眨眼（4-7s 随机间隔）、视线扫视（6-10s 间隔，缓存初始 x 避免 drift）、
    叹息呼吸（12-18s 间隔）
  - `drawVignette` 改为 `drawAtmosphere`：暖色 multiply 滤镜 + 顶/底纯黑带 +
    四角三角 alpha 暗角

### 对话
- `src/server/ai/drifter.ts` `getPipResponse` 内部重写：
  - 单 prompt 字符串拆为 PERSONA / EXAMPLES / CONTEXT / HISTORY / NEWEST 五段，
    用 `---` 分隔，模型更易定位当前要回应的消息
  - PERSONA 新增 "WHO YOU ARE NOT" 段：明确否定 therapist/AI assistant/coach/
    problem-solver 四种身份
  - EXAMPLES 段：3 对中英双语负例+正例对照，覆盖 lecturing / interviewing /
    advice-giving / pushing 四种 drift 模式
- `loadRelevantMemories` 默认 limit 8→4
- 空 memory 提示从冗长的 "this person is new to you..." 改为 "(no memories yet)"

## 文件清单
- 新增：
  - `public/drifter/audio/{clear-piano,rain-piano,snow-bells,fireflies-strings,noise-fire,noise-rain,noise-crickets}.ogg`
  - `public/drifter/audio/CREDITS.md`
  - `public/drifter/textures/{wood-wall,paper-warm}.webp`、`stars-night.png`
  - `public/drifter/textures/CREDITS.md`
  - `src/components/drifter/audio-engine.tsx`
  - `src/components/drifter/mute-toggle.tsx`
  - `docs/superpowers/specs/2026-05-03-drifter-polish-pass-design.md`
  - `docs/superpowers/plans/2026-05-03-drifter-polish-pass.md`
- 修改：
  - `src/app/(app)/drifter/drifter-client.tsx`（接入 audio + mute）
  - `src/components/drifter/scenes/tea-house.ts`（视觉精修）
  - `src/server/ai/drifter.ts`（prompt 重写 + memory limit）

## 验证
- `pnpm build` — <fill in actual outcome>
- `pnpm lint` — <fill in actual: errors / warnings counts>
- `pnpm vitest run src/server/ai/drifter.test.ts` — <fill in>
- `pnpm test:e2e drifter` — <fill in: passed/3>
- 手动：4 天气视觉切换正常；mute 持久化；autoplay-blocked 兜底浮层工作
- 手动：12 轮真实 AI 对话 drift 模式计数 <fill in>/12（target <2/12）
- 资产体积：audio <fill in>，textures <fill in>

## 生产 schema rollout
- 无 schema 变化。

## 剩余风险 / 后续
- Pip 立绘仍是 geometry，spec §3 Phase B（AI 生图）尚未启动
- 移动端音频策略未深度优化（autoplay 在 iOS Safari 仍要 user gesture）
- DialogueBox typewriter useEffect 依赖 `history.length` 的 P1 遗留 bug 未在本次修
- Memory 召回是 importance + recency 排序，没接 embedding 相似度，跨主题召回精度有限
EOF
```

Then fill in every `<fill in...>` placeholder with the actual numbers from Steps 1-2 before committing.

- [ ] **Step 4: Commit changelog + plan**

```bash
git add docs/changelog/2026-05-03-drifter-polish-pass.md docs/superpowers/plans/2026-05-03-drifter-polish-pass.md
git status
git commit -m "$(cat <<'EOF'
docs(drifter): polish pass changelog + plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Final commit log review**

```bash
git log --oneline main..HEAD
```

Expected (in this order, oldest at bottom):
1. docs(drifter): polish pass changelog + plan
2. fix(drifter): tighten Pip system prompt against advice/therapy drift
3. feat(drifter): visual polish — textures, parallax, candle, fluff
4. feat(drifter): add CC0 texture assets
5. feat(drifter): audio engine with weather-keyed ambient
6. feat(drifter): add CC0 ambient audio assets

If the order is wrong or commits are missing, do NOT rebase blindly — investigate first.

- [ ] **Step 6: Hand off back to user**

Print a summary:
- Branch: `feat/drifter-polish-pass`
- Worktree: `.worktrees/drifter-polish`
- Commits: 6 (listed above)
- Verification status: build ✅ / lint ✅ / e2e drifter ✅ / manual ✅
- 12-turn rubric drift count
- Asset sizes
- Ready to merge or push? (Do NOT push autonomously — final user decision per CLAUDE.md.)

---

## Spec Coverage Self-Review

| Spec section | Plan task |
|---|---|
| §2.1 audio assets list | Task 1 |
| §2.2 audio-engine | Task 2 |
| §2.2 autoplay fallback | Task 2 (handleUnlock + overlay) |
| §2.3 mute UI + localStorage | Tasks 3 + 4 |
| §2.4 audio testing | Task 4 Step 5 (manual) + Step 6 (e2e) |
| §3.1 texture assets | Task 5 |
| §3.2 backwall + tex | Task 6 Step 3 |
| §3.2 window parallax | Task 6 Step 4 |
| §3.2 paper overlay | Task 6 Steps 5 + 6 |
| §3.2 candle update loop | Task 6 Step 7 |
| §3.2 Pip fluff/blink/glance/sigh | Task 6 Step 8 |
| §3.2 atmosphere pass | Task 6 Step 9 |
| §3.3 fallback when texture 404 | Task 6 Steps 3-9 (all `if (this.textures.exists(...))` guards) |
| §3.4 visual testing | Task 6 Step 11 |
| §4.2 system prompt rewrite | Task 7 Step 3 |
| §4.3 few-shot examples | Task 7 Step 3 (EXAMPLES block) |
| §4.4 history role decision (FALLBACK confirmed) | Pre-flight check; resolved to single-prompt with sectioned delimiters |
| §4.5 memory limit 4 + empty bullet | Task 7 Steps 2 + 3 |
| §4.6 12-turn rubric | Task 7 Step 8 |
| §5 commit splits | Tasks 1+4 / 5+6 / 7 / 8 |
| §6 verification matrix | Task 8 Step 1 |
| §7 deploy (no schema) | Acknowledged in changelog Task 8 Step 3 |
| §8 risks (CC0 not found) | Task 1 Step 2 (multiple sources listed) |
| §8 risks (Phaser API drift) | Task 6 Step 10 instruction to read d.ts |
| §8 risks (provider no messages) | Resolved at pre-flight, locked to fallback |
| §8 risks (DeepSeek json) | Existing fallback in `provider/ai-sdk.ts` already handles |

No gaps.

## Placeholder scan

Searched the plan for: TBD, TODO, "implement later", "appropriate error", "similar to". Found:
- `<fill in actual outcome>` etc. in Task 8 Step 3 — these are **runtime placeholders** the implementer fills with verification command output. Acceptable; explicitly instructed to fill before commit.
- `<target>` in Task 7 Step 9 — same pattern.
- `<source name>` `<license>` `<url>` in Task 1 Step 3 + Task 5 Step 4 — same pattern, with explicit instruction "Do not commit with placeholder angle-bracket text."

No bare TBDs / "implement later" / "fill in details" without specific instructions.

## Type consistency

- `AudioEngine` props `{ weather: DrifterWeather; muted: boolean }` matches usage in Task 4.
- `MuteToggle` props `{ muted: boolean; onToggle: () => void }` matches usage.
- `loadRelevantMemories(userId, limit = 4)` — same signature as before, only default changes.
- `getPipResponse` signature unchanged.
- Phaser methods used: `this.add.tileSprite`, `this.add.graphics`, `this.add.ellipse`, `this.add.line`, `this.add.rectangle`, `this.add.circle`, `this.tweens.add`, `this.time.delayedCall`, `this.time.addEvent`, `this.make.graphics().createGeometryMask()`, `this.textures.exists`, `this.scale`, `this.scene.isActive()`. All standard Phaser 3/4 API; verified no contradictions across tasks.
