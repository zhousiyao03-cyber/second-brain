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
