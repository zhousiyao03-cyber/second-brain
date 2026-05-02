import type Phaser from "phaser";
import type { DrifterEmotion, DrifterWeather } from "@/lib/drifter/types";

/**
 * Tea-house scene — placeholder visuals built from Phaser geometry while
 * we wait for proper half-realistic illustrated assets (Phase B per spec).
 *
 * Layout:
 *  - back wall (dark wood gradient)
 *  - window on the upper-left with weather particles behind it
 *  - shelf with bookshelf silhouette
 *  - desk along the bottom with a lamp + steaming mug + small Pip silhouette
 *  - foreground vignette
 *
 * Pip "sprite" is a stylized rounded shape — eye + ear glyphs change with
 * emotion. This is intentionally low-fidelity; it should feel cozy and
 * consistent rather than imitate a real character.
 */

type SceneEmitter = {
  emit: (event: string, ...args: unknown[]) => void;
};

export type TeaHouseSceneInit = {
  weather: DrifterWeather;
  emitter: SceneEmitter;
};

export function createTeaHouseScene(
  Phaser: typeof import("phaser"),
  init: TeaHouseSceneInit
) {
  return class TeaHouseScene extends Phaser.Scene {
    private pipBody!: Phaser.GameObjects.Container;
    private leftEye!: Phaser.GameObjects.Ellipse;
    private rightEye!: Phaser.GameObjects.Ellipse;
    private mouth!: Phaser.GameObjects.Graphics;
    private currentEmotion: DrifterEmotion = "gentle";
    private weatherParticles?: Phaser.GameObjects.Particles.ParticleEmitter;
    private lampGlow!: Phaser.GameObjects.Arc;
    private steamGroup!: Phaser.GameObjects.Container;

    constructor() {
      super("tea-house");
    }

    preload() {
      // No external assets in placeholder mode. We build a 1x1 white pixel
      // texture for particle emitters since we can't load image files.
      const g = this.add.graphics({ x: 0, y: 0 });
      g.fillStyle(0xffffff, 1);
      g.fillRect(0, 0, 4, 4);
      g.generateTexture("dot4", 4, 4);
      g.destroy();
    }

    create() {
      const { width, height } = this.scale;

      this.drawBackWall(width, height);
      this.drawWindow(width, height);
      this.drawShelf(width, height);
      this.drawDesk(width, height);
      this.drawLamp(width, height);
      this.drawMug(width, height);
      this.drawPip(width, height);
      this.drawVignette(width, height);

      this.spawnWeather(init.weather);

      this.scale.on("resize", this.handleResize, this);

      init.emitter.emit("scene:ready");
    }

    private handleResize = () => {
      // Naive responsive: just rebuild everything. Cheap because it's all
      // geometry, no asset reloads.
      this.children.removeAll(true);
      this.weatherParticles?.destroy();
      this.weatherParticles = undefined;
      const { width, height } = this.scale;
      this.drawBackWall(width, height);
      this.drawWindow(width, height);
      this.drawShelf(width, height);
      this.drawDesk(width, height);
      this.drawLamp(width, height);
      this.drawMug(width, height);
      this.drawPip(width, height);
      this.drawVignette(width, height);
      this.spawnWeather(init.weather);
    };

    private drawBackWall(w: number, h: number) {
      const g = this.add.graphics();
      g.fillGradientStyle(0x2a1a14, 0x2a1a14, 0x140a08, 0x140a08, 1);
      g.fillRect(0, 0, w, h);

      // soft warm ambient light from the lamp area
      const glow = this.add.circle(w * 0.7, h * 0.55, w * 0.45, 0xd4a05a, 0.18);
      glow.setBlendMode(Phaser.BlendModes.SCREEN);
    }

    private drawWindow(w: number, h: number) {
      const wx = w * 0.18;
      const wy = h * 0.22;
      const ww = w * 0.18;
      const wh = h * 0.28;

      // Sky beyond the window
      const sky = this.add.graphics();
      sky.fillGradientStyle(0x1a2a4a, 0x1a2a4a, 0x0e1a3a, 0x0e1a3a, 1);
      sky.fillRect(wx, wy, ww, wh);

      // Frame
      const frame = this.add.graphics();
      frame.lineStyle(6, 0x5a3520, 1);
      frame.strokeRect(wx, wy, ww, wh);
      frame.lineStyle(3, 0x5a3520, 1);
      frame.lineBetween(wx + ww / 2, wy, wx + ww / 2, wy + wh);
      frame.lineBetween(wx, wy + wh / 2, wx + ww, wy + wh / 2);

      // Sill
      const sill = this.add.graphics();
      sill.fillStyle(0x6b4226, 1);
      sill.fillRect(wx - 8, wy + wh, ww + 16, 10);
    }

    private drawShelf(w: number, h: number) {
      const sx = w * 0.78;
      const sy = h * 0.22;
      const sw = w * 0.16;

      const shelf = this.add.graphics();
      shelf.fillStyle(0x5a3520, 1);
      shelf.fillRect(sx, sy + 56, sw, 8);

      // Books — a row of colored rectangles
      const colors = [0x8b3a3a, 0x2a4a6a, 0xd4a040, 0x4a6a4a, 0x6a4a6a, 0xb06030, 0x2a4a6a];
      const bookW = sw / colors.length;
      colors.forEach((c, i) => {
        const b = this.add.graphics();
        b.fillStyle(c, 1);
        b.fillRect(sx + i * bookW + 2, sy + 8, bookW - 4, 48);
      });
    }

    private drawDesk(w: number, h: number) {
      const dy = h * 0.74;
      const desk = this.add.graphics();
      desk.fillGradientStyle(0x6b4226, 0x6b4226, 0x4a2a16, 0x4a2a16, 1);
      desk.fillRect(0, dy, w, h - dy);
      desk.lineStyle(2, 0x8b5a3c, 1);
      desk.lineBetween(0, dy, w, dy);
    }

    private drawLamp(w: number, h: number) {
      const cx = w * 0.78;
      const baseY = h * 0.74;
      const shadeY = baseY - 70;

      // Base
      const base = this.add.graphics();
      base.fillStyle(0x5a3a20, 1);
      base.fillRect(cx - 14, baseY - 4, 28, 4);

      // Neck
      const neck = this.add.graphics();
      neck.fillStyle(0x5a3a20, 1);
      neck.fillRect(cx - 2, shadeY + 26, 4, 14);

      // Shade (triangle)
      const shade = this.add.graphics();
      shade.fillStyle(0xd4a05a, 1);
      shade.fillTriangle(cx - 26, shadeY + 26, cx + 26, shadeY + 26, cx, shadeY);

      // Bulb glow under shade
      this.lampGlow = this.add.circle(cx, shadeY + 32, 100, 0xffd690, 0.35);
      this.lampGlow.setBlendMode(Phaser.BlendModes.SCREEN);
      this.tweens.add({
        targets: this.lampGlow,
        scale: { from: 1, to: 1.06 },
        alpha: { from: 0.32, to: 0.4 },
        duration: 2200,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    private drawMug(w: number, h: number) {
      const mx = w * 0.32;
      const my = h * 0.71;

      const mug = this.add.graphics();
      mug.fillStyle(0xc8c3b8, 1);
      mug.fillRoundedRect(mx, my, 30, 26, { tl: 4, tr: 4, bl: 8, br: 8 });
      mug.lineStyle(3, 0xc8c3b8, 1);
      mug.strokeRoundedRect(mx + 30, my + 6, 8, 12, 4);

      this.steamGroup = this.add.container(mx + 15, my - 2);
      for (let i = 0; i < 2; i++) {
        const puff = this.add.circle(i * 6 - 3, 0, 4, 0xffffff, 0.35);
        puff.setBlendMode(Phaser.BlendModes.SCREEN);
        this.steamGroup.add(puff);
        this.tweens.add({
          targets: puff,
          y: -28,
          alpha: 0,
          duration: 2400,
          delay: i * 1200,
          repeat: -1,
          ease: "Sine.easeOut",
        });
      }
    }

    private drawPip(w: number, h: number) {
      const cx = w * 0.55;
      const cy = h * 0.62;

      this.pipBody = this.add.container(cx, cy);

      // Tail (drawn first so it sits behind)
      const tail = this.add.graphics();
      tail.fillStyle(0x8b5a3c, 1);
      tail.fillEllipse(60, -10, 32, 70);
      tail.fillStyle(0xb87a4a, 1);
      tail.fillEllipse(60, -10, 22, 60);
      this.pipBody.add(tail);

      // Body
      const body = this.add.ellipse(0, 30, 80, 90, 0x8b5a3c);
      this.pipBody.add(body);

      // Belly
      const belly = this.add.ellipse(0, 38, 50, 60, 0xead7be);
      this.pipBody.add(belly);

      // Head
      const head = this.add.ellipse(0, -28, 70, 60, 0x8b5a3c);
      this.pipBody.add(head);

      // Cheeks (light fluff)
      const cheekL = this.add.ellipse(-22, -22, 22, 18, 0xead7be);
      const cheekR = this.add.ellipse(22, -22, 22, 18, 0xead7be);
      this.pipBody.add([cheekL, cheekR]);

      // Ears
      const earL = this.add.ellipse(-22, -56, 18, 22, 0x6b3e1f);
      const earR = this.add.ellipse(22, -56, 18, 22, 0x6b3e1f);
      this.pipBody.add([earL, earR]);

      // Eyes
      this.leftEye = this.add.ellipse(-14, -28, 10, 12, 0x1a1208);
      this.rightEye = this.add.ellipse(14, -28, 10, 12, 0x1a1208);
      this.pipBody.add([this.leftEye, this.rightEye]);

      // Tiny eye highlights
      const lh = this.add.circle(-12, -30, 2, 0xfff8e8);
      const rh = this.add.circle(16, -30, 2, 0xfff8e8);
      this.pipBody.add([lh, rh]);

      // Mouth
      this.mouth = this.add.graphics();
      this.pipBody.add(this.mouth);

      this.applyEmotion("gentle");

      // Idle breathing
      this.tweens.add({
        targets: this.pipBody,
        scaleY: { from: 1, to: 1.025 },
        duration: 1800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });

      // Tail sway
      this.tweens.add({
        targets: tail,
        rotation: { from: -0.04, to: 0.04 },
        duration: 2400,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }

    private drawVignette(w: number, h: number) {
      const v = this.add.graphics();
      v.fillStyle(0x000000, 0.35);
      v.fillRect(0, 0, w, 60);
      v.fillRect(0, h - 60, w, 60);
    }

    private spawnWeather(weather: DrifterWeather) {
      const { width, height } = this.scale;
      const wx = width * 0.18;
      const wy = height * 0.22;
      const ww = width * 0.18;
      const wh = height * 0.28;

      if (weather === "clear") return;

      // Phaser 4 syntax: scene.add.particles(x, y, texture, config)
      const p = this.add.particles(0, 0, "dot4", {
        x: { min: wx, max: wx + ww },
        y: { min: wy, max: wy + wh },
        lifespan: weather === "rain" ? 700 : 2400,
        speedY: weather === "rain" ? { min: 350, max: 500 } : { min: 12, max: 28 },
        speedX:
          weather === "fireflies"
            ? { min: -10, max: 10 }
            : weather === "snow"
              ? { min: -10, max: 10 }
              : { min: 0, max: 10 },
        scale:
          weather === "fireflies"
            ? { start: 0.6, end: 0.1 }
            : { start: 0.5, end: 0.5 },
        alpha:
          weather === "fireflies"
            ? { start: 0.8, end: 0 }
            : { start: 0.6, end: 0.6 },
        tint: weather === "fireflies" ? 0xffe17a : 0xb8d4f0,
        frequency: weather === "rain" ? 25 : 200,
        emitting: true,
      });
      this.weatherParticles = p;
    }

    public setEmotion(emotion: DrifterEmotion) {
      if (emotion === this.currentEmotion) return;
      this.currentEmotion = emotion;
      this.applyEmotion(emotion);
    }

    private applyEmotion(emotion: DrifterEmotion) {
      this.mouth.clear();
      this.mouth.lineStyle(2, 0x4a2a16, 1);

      // Eyes default
      this.leftEye.setScale(1, 1);
      this.rightEye.setScale(1, 1);

      switch (emotion) {
        case "gentle":
          this.mouth.beginPath();
          this.mouth.arc(0, -10, 5, 0, Math.PI, false);
          this.mouth.strokePath();
          break;
        case "smile":
          this.leftEye.setScale(1, 0.5);
          this.rightEye.setScale(1, 0.5);
          this.mouth.beginPath();
          this.mouth.arc(0, -10, 7, 0, Math.PI, false);
          this.mouth.strokePath();
          break;
        case "thinking":
          this.leftEye.setScale(1, 1);
          this.rightEye.setScale(1, 1);
          this.mouth.lineBetween(-3, -8, 3, -8);
          break;
        case "concerned":
          this.mouth.beginPath();
          this.mouth.arc(0, -6, 5, Math.PI, 2 * Math.PI, false);
          this.mouth.strokePath();
          break;
        case "sleepy":
          this.leftEye.setScale(1, 0.25);
          this.rightEye.setScale(1, 0.25);
          this.mouth.lineBetween(-3, -8, 3, -8);
          break;
      }
    }
  };
}
