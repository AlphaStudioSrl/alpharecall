import { useEffect, useRef, useState } from "react";

export type MotionSettings = {
  motionStyle?: string;
  motionSpeed?: string;
  animateMessages?: boolean;
  launcherRepeat?: string;
  launcherInterval?: number;
};

export function motionDuration(speed?: string) {
  return speed === "snappy" ? 180 : speed === "relaxed" ? 360 : 260;
}

// The shared scheduler leaves a quiet interval between brief launcher gestures.
// Hidden tabs and reduced motion stop the timer, including inside the preview.
export function useLauncherMotion(animation: string, enabled: boolean, settings: MotionSettings, replay = 0) {
  const consumed = useRef(false);
  const [cycle, setCycle] = useState(0);
  const [active, setActive] = useState(false);
  const { motionStyle = "subtle", launcherRepeat = "once", launcherInterval = 15 } = settings;
  useEffect(() => { consumed.current = false; }, [animation, motionStyle, launcherRepeat, replay]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { clearTimeout(timer); setActive(false); };
    const run = () => {
      clearTimeout(timer);
      if (!enabled || animation === "none" || motionStyle === "none" || media.matches || document.visibilityState === "hidden") {
        setActive(false);
        return;
      }
      if (consumed.current && launcherRepeat === "once") { setActive(false); return; }
      consumed.current = true;
      setCycle((n) => n + 1);
      setActive(true);
      timer = setTimeout(() => {
        setActive(false);
        if (launcherRepeat === "interval") timer = setTimeout(run, Math.max(8, Math.min(60, launcherInterval)) * 1000);
      }, 1800);
    };
    const visibility = () => document.visibilityState === "hidden" ? stop() : run();
    run();
    media.addEventListener("change", run);
    document.addEventListener("visibilitychange", visibility);
    return () => { clearTimeout(timer); media.removeEventListener("change", run); document.removeEventListener("visibilitychange", visibility); };
  }, [animation, enabled, motionStyle, launcherRepeat, launcherInterval, replay]);
  return { animation: active ? animation : "none", cycle };
}

// Count only visible time before an unsolicited greeting is eligible to appear.
export function scheduleVisibleTimeout(callback: () => void, delay: number) {
  let remaining = delay;
  let started = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - started));
      timer = undefined;
    }
    if (document.visibilityState !== "hidden") {
      started = Date.now();
      timer = setTimeout(() => {
        document.removeEventListener("visibilitychange", update);
        callback();
      }, remaining);
    }
  };
  update();
  document.addEventListener("visibilitychange", update);
  return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
}
