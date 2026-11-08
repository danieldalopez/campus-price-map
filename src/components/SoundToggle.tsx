"use client";

import { useSyncExternalStore } from "react";
import { isMuted, setMuted, subscribeSound } from "@/lib/sounds";

/**
 * Sound on/off (SPEC section 9c), remembered on the phone. Starts off when the phone asks for reduced motion.
 * 48 px target, ~22 px icon, no border or shadow (it sits in the header), with its state in words for screen readers.
 */
export function SoundToggle({ className = "" }: { className?: string }) {
  const muted = useSyncExternalStore(subscribeSound, isMuted, () => true);
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      aria-label={muted ? "Sounds are off. Turn them on" : "Sounds are on. Turn them off"}
      title={muted ? "Sounds off" : "Sounds on"}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[1.375rem] hover:bg-paper-2 ${className}`}
    >
      <span aria-hidden="true">{muted ? "🔇" : "🔊"}</span>
    </button>
  );
}
