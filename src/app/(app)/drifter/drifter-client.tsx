"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PhaserStage } from "@/components/drifter/phaser-stage";
import { DrifterHud } from "@/components/drifter/hud";
import { LeaveButton } from "@/components/drifter/leave-button";
import { DialogueBox } from "@/components/drifter/dialogue-box";
import { InputBar } from "@/components/drifter/input-bar";
import { AudioEngine } from "@/components/drifter/audio-engine";
import { MuteToggle } from "@/components/drifter/mute-toggle";
import {
  pickClientLang,
  t,
  type DrifterLang,
} from "@/lib/drifter/i18n";
import type {
  DrifterChatResponse,
  DrifterEmotion,
  DrifterMessage,
  DrifterSession,
} from "@/lib/drifter/types";

type SessionInitResponse = {
  session: DrifterSession;
  greeting: { text: string; emotion: DrifterEmotion } | null;
  history: DrifterMessage[];
};

export function DrifterClient() {
  const router = useRouter();

  const [session, setSession] = useState<DrifterSession | null>(null);
  const [history, setHistory] = useState<DrifterMessage[]>([]);
  const [emotion, setEmotion] = useState<DrifterEmotion>("gentle");
  const [pipPending, setPipPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phaserOk, setPhaserOk] = useState(true);
  const [muted, setMuted] = useState(false);
  const sceneReadyRef = useRef(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem("drifter:muted");
      if (v === "1") setMuted(true);
    } catch {
      // ignore
    }
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem("drifter:muted", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  // Initial session bootstrap.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/drifter/session", { method: "POST" });
        if (!res.ok) {
          throw new Error(`Session init failed: ${res.status}`);
        }
        const data: SessionInitResponse = await res.json();
        if (cancelled) return;
        setSession(data.session);
        const initial: DrifterMessage[] = [...data.history];
        if (data.greeting) {
          // The greeting is already inserted into history server-side for new
          // sessions, so it's covered by data.history. For existing sessions
          // greeting is null. No special handling needed beyond setting state.
          if (initial.length === 0) {
            initial.push({
              id: "greeting-fallback",
              role: "pip",
              content: data.greeting.text,
              emotion: data.greeting.emotion,
              hooks: null,
              createdAt: Date.now(),
            });
          }
        }
        setHistory(initial);
        const lastPip = [...initial]
          .reverse()
          .find((m) => m.role === "pip" && m.emotion);
        if (lastPip?.emotion) setEmotion(lastPip.emotion);
      } catch (err) {
        if (!cancelled) {
          const e = err instanceof Error ? err : new Error("init failed");
          setError(e.message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Best-effort leave on unload.
  useEffect(() => {
    if (!session) return;
    const sessionId = session.id;
    const handler = () => {
      const blob = new Blob([JSON.stringify({ sessionId })], {
        type: "application/json",
      });
      navigator.sendBeacon?.("/api/drifter/leave", blob);
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [session]);

  const lang: DrifterLang = useMemo(
    () => (session ? pickClientLang(session.language) : "en"),
    [session]
  );

  const tx = t(lang);

  const handleSend = useCallback(
    async (text: string) => {
      if (!session || pipPending) return;
      setError(null);
      const optimisticUserMsg: DrifterMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        emotion: null,
        hooks: null,
        createdAt: Date.now(),
      };
      setHistory((prev) => [...prev, optimisticUserMsg]);
      setPipPending(true);

      try {
        const res = await fetch("/api/drifter/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, message: text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `Chat failed: ${res.status}`);
        }
        const data: DrifterChatResponse = await res.json();
        setHistory((prev) => [
          ...prev.map((m) =>
            m.id === optimisticUserMsg.id ? { ...m, id: data.userMessageId } : m
          ),
          {
            id: data.pip.id,
            role: "pip",
            content: data.pip.text,
            emotion: data.pip.emotion,
            hooks: data.pip.hooks,
            createdAt: Date.now(),
          },
        ]);
        setEmotion(data.pip.emotion);
      } catch (err) {
        const e = err instanceof Error ? err : new Error("chat failed");
        setError(e.message);
      } finally {
        setPipPending(false);
      }
    },
    [pipPending, session]
  );

  const handleLeave = useCallback(async () => {
    if (session) {
      try {
        await fetch("/api/drifter/leave", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id }),
        });
      } catch {
        // best-effort
      }
    }
    router.push("/dashboard");
  }, [router, session]);

  const lastPipMessage = useMemo(() => {
    return [...history].reverse().find((m) => m.role === "pip");
  }, [history]);
  const currentHooks = lastPipMessage?.hooks ?? null;

  if (error && !session) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="max-w-md rounded-lg border border-amber-200/20 bg-black/40 p-6 text-amber-100/80">
          <p className="mb-3">{tx.error}</p>
          <p className="text-xs text-amber-100/40">{error}</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-full w-full items-center justify-center text-amber-100/60">
        <p className="font-mono text-sm tracking-wider" data-testid="drifter-loading">
          {tx.loading}
        </p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {phaserOk && (
        <PhaserStage
          weather={session.weather}
          emotion={emotion}
          onReady={() => {
            sceneReadyRef.current = true;
          }}
          onFailed={() => setPhaserOk(false)}
        />
      )}
      {!phaserOk && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-[radial-gradient(circle_at_30%_60%,rgba(212,160,90,0.12),transparent_60%)] p-8 text-amber-100/70"
          data-testid="drifter-fallback"
        >
          <div className="max-w-md text-center">
            <h2 className="mb-2 text-lg tracking-widest text-amber-200/80">
              {tx.fallbackTitle}
            </h2>
            <p className="text-sm text-amber-100/60">{tx.fallbackBody}</p>
          </div>
        </div>
      )}

      <AudioEngine weather={session.weather} muted={muted} />

      <DrifterHud
        lang={lang}
        dayNumber={session.dayNumber}
        weather={session.weather}
        timeOfDay={session.timeOfDay}
      />
      <div className="absolute top-4 right-28 z-30">
        <MuteToggle muted={muted} onToggle={toggleMute} />
      </div>
      <LeaveButton lang={lang} onLeave={handleLeave} />

      <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-6 pt-3">
        <div className="mx-auto max-w-3xl space-y-3">
          <DialogueBox lang={lang} history={history} pipPending={pipPending} />
          <InputBar
            lang={lang}
            hooks={currentHooks}
            disabled={pipPending}
            onSend={handleSend}
          />
          {error && (
            <p className="text-xs text-amber-100/50">
              <span className="text-rose-300/80">·</span> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
