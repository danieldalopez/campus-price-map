// Read aloud (docs/SPEC.md section 7, Step 10): the phone's built-in speech (speechSynthesis), no library and
// no network. Browser only. Only ever starts from a tap.

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export function isSpeaking(): boolean {
  return canSpeak() && window.speechSynthesis.speaking;
}

/** Speak the text, replacing anything already being read. `onEnd` runs when it finishes or is stopped. */
export function speak(text: string, onEnd?: () => void): void {
  if (!canSpeak()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-CA";
  u.rate = 1;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
