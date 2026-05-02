"use client";

import { useEffect, useRef, useState } from "react";
import type { DrifterEmotion, DrifterWeather } from "@/lib/drifter/types";

type PhaserStageProps = {
  weather: DrifterWeather;
  emotion: DrifterEmotion;
  onReady?: () => void;
  onFailed?: () => void;
};

type SceneApi = {
  setEmotion: (e: DrifterEmotion) => void;
};

export function PhaserStage({
  weather,
  emotion,
  onReady,
  onFailed,
}: PhaserStageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<unknown>(null);
  const sceneApiRef = useRef<SceneApi | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;

    const targetEl = containerRef.current;

    (async () => {
      try {
        const PhaserModule = await import("phaser");
        const Phaser = PhaserModule.default ?? PhaserModule;
        if (cancelled) return;

        const { createTeaHouseScene } = await import(
          "@/components/drifter/scenes/tea-house"
        );
        if (cancelled) return;

        let scene: InstanceType<ReturnType<typeof createTeaHouseScene>> | null = null;
        const SceneClass = createTeaHouseScene(Phaser, {
          weather,
          emitter: {
            emit: (event: string) => {
              if (event === "scene:ready") {
                if (!cancelled) onReady?.();
                if (scene) {
                  sceneApiRef.current = {
                    setEmotion: (e) => scene?.setEmotion(e),
                  };
                }
              }
            },
          },
        });

        const config = {
          type: Phaser.AUTO,
          parent: targetEl,
          backgroundColor: "#0a0608",
          scale: {
            mode: Phaser.Scale.FIT,
            autoCenter: Phaser.Scale.CENTER_BOTH,
            width: 1280,
            height: 720,
          },
          scene: SceneClass,
        };

        const game = new Phaser.Game(config);
        gameRef.current = game;

        // Hook scene reference once it's instantiated
        game.events.once("ready", () => {
          scene = game.scene.getScene("tea-house") as InstanceType<
            ReturnType<typeof createTeaHouseScene>
          >;
          if (scene) {
            sceneApiRef.current = {
              setEmotion: (e) => scene?.setEmotion(e),
            };
          }
        });
      } catch (err) {
        if (!cancelled) {
          const e = err instanceof Error ? err : new Error("Phaser failed to load");
          setError(e);
          onFailed?.();
        }
      }
    })();

    return () => {
      cancelled = true;
      const game = gameRef.current as { destroy?: (removeCanvas: boolean) => void } | null;
      if (game?.destroy) {
        try {
          game.destroy(true);
        } catch {
          // game may already be torn down
        }
      }
      gameRef.current = null;
      sceneApiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-emit emotion changes
  useEffect(() => {
    sceneApiRef.current?.setEmotion(emotion);
  }, [emotion]);

  if (error) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 [&>canvas]:!h-full [&>canvas]:!w-full"
      data-testid="drifter-phaser-stage"
    />
  );
}
