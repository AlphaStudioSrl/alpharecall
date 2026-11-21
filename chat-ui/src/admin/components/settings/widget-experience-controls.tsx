import { useState } from "react";
import { Play, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/admin/app-context";
import { named } from "@/admin/lib/i18n";
import { assistantName } from "@/admin/components/assistant/shared";
import { Group, IconButton, Segmented, SelectPill, Toggle } from "@/admin/components/shared/kit";
import { Button } from "@/components/ui/button";
import { SOUND_TYPES, playSound, unlockAudio, stopSounds } from "@/sounds";
import { SettingRow, StackRow } from "./widget-editor-rows";

export type PreviewDemo = { id: number; event: "open" | "launcher" };

const PROFILES = [
  { id: "quiet", patch: { motionStyle: "none", motionSpeed: "balanced", animateMessages: false, launcher_animation: "none", launcherRepeat: "once", launcherInterval: 15, openSound: "none", sendSound: "none", notificationSound: "none", attention_sound: "none", soundVolume: 35 } },
  { id: "balanced", patch: { motionStyle: "subtle", motionSpeed: "balanced", animateMessages: true, launcher_animation: "breathe", launcherRepeat: "once", launcherInterval: 15, openSound: "none", sendSound: "none", notificationSound: "gentle", attention_sound: "none", soundVolume: 30 } },
  { id: "expressive", patch: { motionStyle: "expressive", motionSpeed: "relaxed", animateMessages: true, launcher_animation: "bounce", launcherRepeat: "interval", launcherInterval: 30, openSound: "bubble", sendSound: "pop", notificationSound: "chime", attention_sound: "none", soundVolume: 40 } },
] as const;
const DEFAULTS: Record<string, unknown> = { motionStyle: "subtle", motionSpeed: "balanced", animateMessages: true, launcher_animation: "pulse", launcherRepeat: "once", launcherInterval: 15, openSound: "none", sendSound: "none", notificationSound: "none", attention_sound: "none", soundVolume: 35 };

/** Motion and sound of the widget: two kit Groups for the widget editor. */
export function WidgetExperienceControls({ chat, update, onDemo }: {
  chat: Record<string, unknown>;
  update: (patch: Record<string, unknown>) => void;
  onDemo: (event: PreviewDemo["event"]) => void;
}) {
  const { t, settings } = useApp();
  const botName = assistantName(settings, "");
  const value = (key: string, fallback: string) => String(chat[key] ?? fallback);
  const motionOff = value("motionStyle", "subtle") === "none";
  const launcherStill = motionOff || value("launcher_animation", "pulse") === "none";
  const volume = Number(chat.soundVolume ?? 35);
  const profile = PROFILES.find(({ patch }) => Object.entries(patch).every(([key, v]) => (chat[key] ?? DEFAULTS[key]) === v))?.id ?? "";
  const select = (key: string, fallback: string, options: string[], disabled = false) => (
    <SelectPill aria-label={t(`widget.experience.${key}Label`)} value={value(key, fallback)} disabled={disabled}
      onValueChange={(v) => update({ [key]: v })}
      options={options.map((v) => ({ value: v, label: t(`widget.experience.${key}.${v}`) }))} />
  );

  return <>
    <Group label={t("widget.experience.motion")}>
      <StackRow label={t("widget.experience.presets")} description={profile ? t(`widget.experience.preset.${profile}Desc`) : undefined}>
        <Segmented aria-label={t("widget.experience.presets")} value={profile} onValueChange={(id) => {
          const chosen = PROFILES.find((p) => p.id === id);
          if (chosen) update({ ...chosen.patch });
        }} options={PROFILES.map(({ id }) => ({ value: id, label: t(`widget.experience.preset.${id}`) }))} />
      </StackRow>
      <SettingRow label={t("widget.experience.motionStyleLabel")} help={t("widget.experience.motionStyleHelp")}>
        {select("motionStyle", "subtle", ["none", "subtle", "expressive"])}
      </SettingRow>
      <SettingRow label={t("widget.experience.motionSpeedLabel")} help={t("widget.experience.motionSpeedHelp")} disabled={motionOff}>
        {select("motionSpeed", "balanced", ["snappy", "balanced", "relaxed"], motionOff)}
      </SettingRow>
      <SettingRow label={t("widget.experience.animateMessages")} help={t("widget.experience.animateMessagesHelp")} htmlFor="widget-animate-messages" disabled={motionOff}>
        <Toggle id="widget-animate-messages" disabled={motionOff} checked={chat.animateMessages !== false} onCheckedChange={(checked) => update({ animateMessages: checked })} />
      </SettingRow>
      <SettingRow label={t("widget.launcherAnimation")} help={t("widget.helpLauncherAnimation")} disabled={motionOff}>
        <SelectPill aria-label={t("widget.launcherAnimation")} value={value("launcher_animation", "pulse")} disabled={motionOff}
          onValueChange={(v) => update({ launcher_animation: v })}
          options={[
            ["none", "animNone"], ["pulse", "animPulse"], ["bounce", "animBounce"], ["wiggle", "animWiggle"], ["breathe", "animBreathe"], ["rubberBand", "animRubberBand"],
          ].map(([v, key]) => ({ value: v, label: t(`widget.${key}`) }))} />
      </SettingRow>
      <SettingRow label={t("widget.experience.launcherRepeatLabel")} help={t("widget.experience.launcherRepeatHelp")} disabled={launcherStill}>
        {select("launcherRepeat", "once", ["once", "interval"], launcherStill)}
      </SettingRow>
      {value("launcherRepeat", "once") === "interval" && (
        <SettingRow label={t("widget.experience.launcherIntervalLabel")} help={t("widget.experience.launcherIntervalHelp")} disabled={launcherStill}>
          <SelectPill aria-label={t("widget.experience.launcherIntervalLabel")} value={String(chat.launcherInterval ?? 15)} disabled={launcherStill}
            onValueChange={(v) => update({ launcherInterval: Number(v) })}
            options={[8, 15, 30, 60].map((v) => ({ value: String(v), label: `${v}s` }))} />
        </SettingRow>
      )}
      <div className="ark-row we-row-actions">
        <Button type="button" variant="secondary" size="sm" onClick={() => onDemo("open")}><Play aria-hidden="true" />{t("widget.experience.previewOpen")}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => onDemo("launcher")}><Play aria-hidden="true" />{t("widget.experience.previewLauncher")}</Button>
      </div>
    </Group>
    <p className="we-note">{t("widget.experience.motionHint")}</p>

    <Group label={t("widget.experience.sounds")}>
      <SettingRow label={t("widget.experience.volume")} help={t("widget.experience.volumeHelp")} htmlFor="ar-sound-volume">
        <span className="we-range">
          <input id="ar-sound-volume" type="range" min="0" max="100" step="5" value={volume} onChange={(e) => update({ soundVolume: Number(e.target.value) })} />
          <output htmlFor="ar-sound-volume">{volume}%</output>
        </span>
      </SettingRow>
      {(["openSound", "sendSound", "notificationSound", "attention_sound"] as const).map((key) => (
        <SoundRow key={key} label={t(`widget.experience.${key}`)} help={key === "notificationSound" ? named(t, "widget.experience.notificationSoundHelp", botName) : t(`widget.experience.${key}Help`)} value={value(key, "none")} volume={volume} onChange={(v) => update({ [key]: v })} />
      ))}
    </Group>
    <p className="we-note">{t("widget.experience.soundHint")}</p>
  </>;
}

function SoundRow({ label, help, value, volume, onChange }: { label: string; help: string; value: string; volume: number; onChange: (v: string) => void }) {
  const { t } = useApp();
  const [playing, setPlaying] = useState(false);
  const test = async () => {
    setPlaying(true);
    stopSounds();
    const ready = await unlockAudio();
    if (!ready || !playSound(value, volume)) toast.info(t("widget.experience.soundUnavailable"));
    setPlaying(false);
  };
  return (
    <SettingRow label={label} help={help}>
      <SelectPill aria-label={label} value={value} onValueChange={onChange}
        options={SOUND_TYPES.map((v) => ({ value: v, label: t(`widget.sound${v[0].toUpperCase()}${v.slice(1)}`) }))} />
      <IconButton icon={Volume2} size="sm" label={`${t("widget.experience.testSound")}: ${label}`}
        disabled={value === "none" || volume === 0 || playing} onClick={() => { void test(); }} />
    </SettingRow>
  );
}
