"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { canSpeak, speak, stopSpeaking } from "@/lib/speech";
import { buttonClasses } from "./Button";

const noop = () => () => {};

/**
 * Read aloud (SPEC section 7, Step 10): one tap reads the decision line and the top results with the phone's
 * built-in voice; tap again to stop. Hidden when the browser can't speak. Never starts on its own.
 */
export function ReadAloud({ text, className = "" }: { text: string | null; className?: string }) {
  const supported = useSyncExternalStore(noop, canSpeak, () => false);
  const [speaking, setSpeaking] = useState(false);

  // Stop reading when the student leaves the page.
  useEffect(() => () => stopSpeaking(), []);

  if (!supported || !text) return null;

  return (
    <button
      type="button"
      className={buttonClasses("secondary", "md", `shrink-0 px-3 ${className}`)}
      aria-pressed={speaking}
      onClick={() => {
        if (speaking) {
          stopSpeaking();
          setSpeaking(false);
          return;
        }
        setSpeaking(true);
        speak(text, () => setSpeaking(false));
      }}
    >
      <span aria-hidden="true">{speaking ? "■" : "🔈"}</span> {speaking ? "Stop" : "Read aloud"}
    </button>
  );
}
