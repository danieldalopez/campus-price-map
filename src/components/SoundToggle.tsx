"use client";

import { useSyncExternalStore } from "react";
import { isMuted, setMuted, subscribeSound } from "@/lib/sounds";
import { Icon } from "./Icon";

/**
 * Sound on/off (SPEC section 9c), remembered on the phone. Starts off when the phone asks for reduced motion.
 * A 44 px outlined square (2 px ink, 8 px corners, flat: a supporting control), with its state in words for
 * screen readers.
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
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-control border-2 border-ink bg-card hover:bg-tag-pale aria-pressed:bg-tag ${className}`}
    >
      <Icon name={muted ? "sound-off" : "sound-on"} className="h-6 w-6" />
    </button>
  );
}
