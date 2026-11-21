export const SOUND_TYPES = ["none", "chime", "pop", "ding", "bubble", "gentle"] as const;
export type SoundType = typeof SOUND_TYPES[number];
export type FeedbackEvent = "open" | "send" | "reply" | "attention";

let context: AudioContext | undefined;
let muted = false;
const active = new Set<OscillatorNode>();
const listeners = new Set<() => void>();

export const getSoundMuted = () => muted;
export const subscribeSoundMuted = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function setSoundMuted(value: boolean) {
  muted = value;
  if (value) stopSounds();
  listeners.forEach((listener) => listener());
}
export function stopSounds() {
  active.forEach((osc) => { try { osc.stop(); } catch { /* Already stopped. */ } });
  active.clear();
}

// Call only from a real gesture. Never queue a blocked cue for later playback.
export async function unlockAudio(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Audio) return false;
    if (!context || context.state === "closed") context = new Audio();
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch { return false; }
}

export function playSound(type: string, volume = 35): boolean {
  if (!SOUND_TYPES.includes(type as SoundType) || type === "none" || !context || context.state !== "running") return false;
  if (document.visibilityState === "hidden") return false;
  const level = Math.max(0, Math.min(100, Number.isFinite(volume) ? volume : 35)) / 100;
  if (level === 0) return false;
  const ctx = context;
  // Separate envelopes avoid clicks and keep all presets at a similar level.
  const note = (frequency: number, delay: number, duration: number, endFrequency?: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + delay;
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, start);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * 0.16, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    active.add(osc);
    osc.onended = () => { active.delete(osc); osc.disconnect(); gain.disconnect(); };
    osc.start(start);
    osc.stop(start + duration + 0.01);
  };
  try {
    switch (type as SoundType) {
      case "chime": note(660, 0, 0.22); note(880, 0.1, 0.32); break;
      case "pop": note(520, 0, 0.12, 240); break;
      case "ding": note(1047, 0, 0.42); break;
      case "bubble": note(320, 0, 0.18, 640); break;
      case "gentle": note(440, 0, 0.3); note(554, 0.1, 0.34); break;
    }
    return true;
  } catch { return false; }
}

export function hasWidgetSounds(config: Record<string, unknown>): boolean {
  return [config.openSound, config.sendSound, config.notificationSound, config.attention_sound || config.attentionSound]
    .some((type) => typeof type === "string" && type !== "none" && SOUND_TYPES.includes(type as SoundType));
}

export function playWidgetSound(event: FeedbackEvent): boolean {
  if (muted || typeof window === "undefined") return false;
  const config = (window as any).AlphaRecallChat?.config || {};
  const type = event === "reply" ? config.notificationSound : event === "attention"
    ? config.attention_sound || config.attentionSound : config[`${event}Sound`];
  return playSound(type || "none", Number(config.soundVolume ?? 35));
}
