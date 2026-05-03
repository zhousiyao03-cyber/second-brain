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
