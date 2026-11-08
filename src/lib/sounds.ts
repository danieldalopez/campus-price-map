// UI sounds (docs/SPEC.md section 9c, Step 10). Synthesised with the Web Audio API, so there are no files to
// load. Browser only.
//
// Rules (section 9c): only right after a tap, a mute toggle remembered on the phone, muted by default when the
// phone asks for reduced motion, and a sound is never the only feedback (every caller also shows text).

export type SoundName = "snap" | "slap" | "chaching" | "thud" | "chime";

const KEY = "cpm.sound";
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;

/** True when sounds are off: the student muted them, or the phone asks for reduced motion and they didn't unmute. */
export function isMuted(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "on") return false;
    if (saved === "off") return true;
  } catch {
    // Storage blocked: fall through to the default.
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function setMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(KEY, muted ? "off" : "on");
  } catch {
    // Not remembered; still applies until the page closes.
  }
  for (const l of listeners) l();
  if (!muted) play("chime");
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A tone with a quick attack and an exponential fade. */
function tone(a: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, gain: number, endFreq?: number) {
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(a.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** A burst of filtered noise: clicks, slaps and thuds. */
function noise(a: AudioContext, start: number, dur: number, filterFreq: number, gain: number, type: BiquadFilterType = "lowpass") {
  const length = Math.max(1, Math.floor(a.sampleRate * dur));
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(filter).connect(g).connect(a.destination);
  src.start(start);
}

const SOUNDS: Record<SoundName, (a: AudioContext, t: number) => void> = {
  // Camera shutter: two short bright clicks.
  snap: (a, t) => {
    noise(a, t, 0.03, 3000, 0.5, "highpass");
    noise(a, t + 0.07, 0.03, 2500, 0.4, "highpass");
  },
  // A sticker slapped on paper: a soft broadband smack.
  slap: (a, t) => {
    noise(a, t, 0.09, 1800, 0.7);
    tone(a, 180, t, 0.08, "sine", 0.25, 90);
  },
  // A small cash register: a bell ding, then a brighter one.
  chaching: (a, t) => {
    noise(a, t, 0.04, 4000, 0.25, "highpass");
    tone(a, 1318, t + 0.05, 0.25, "triangle", 0.18);
    tone(a, 1760, t + 0.12, 0.35, "triangle", 0.18);
  },
  // A soft cardboard thud.
  thud: (a, t) => {
    tone(a, 120, t, 0.18, "sine", 0.45, 55);
    noise(a, t, 0.06, 400, 0.4);
  },
  // A bright two-note chime.
  chime: (a, t) => {
    tone(a, 880, t, 0.22, "sine", 0.2);
    tone(a, 1319, t + 0.11, 0.35, "sine", 0.2);
  },
};

/** Play a UI sound, unless muted. Call only from a tap handler or its immediate result. */
export function play(name: SoundName): void {
  if (isMuted()) return;
  try {
    const a = audio();
    if (a) SOUNDS[name](a, a.currentTime + 0.01);
  } catch {
    // Audio isn't available: the on-screen text carries the meaning anyway.
  }
}
