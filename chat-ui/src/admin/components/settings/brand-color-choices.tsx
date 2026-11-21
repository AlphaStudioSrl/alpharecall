import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { ColorPicker } from "@/admin/components/shared/color-picker";
import { contrastColor } from "@/lib/brand-color";
import { brandChoices, normalizeHex, recentColorsOf, stableChoices, type BrandChoice } from "./widget-colors";

/**
 * The swatches of Aspetto > Colore and whether the current color is one of
 * them. The history (chat_config.recentColors, newest first) takes the slots
 * of the default colors one by one from the left (brandChoices); while the
 * owner is choosing (focus in the row) every color keeps its slot, see
 * stableChoices, and the row settles when focus leaves it.
 */
export function useBrandChoices(value: string, recent: unknown) {
  const savedKey = JSON.stringify(recentColorsOf(recent));
  const saved = useMemo(() => brandChoices(JSON.parse(savedKey) as string[]), [savedKey]);
  const [shown, setShown] = useState<BrandChoice[]>(saved);
  const choosing = useRef(false);
  useEffect(() => {
    setShown((previous) => {
      const next = choosing.current ? stableChoices(previous, saved) : saved;
      return JSON.stringify(next) === JSON.stringify(previous) ? previous : next;
    });
  }, [saved]);
  const current = normalizeHex(value);
  const recentCount = shown.filter((choice) => choice.recent).length;
  return {
    choices: shown,
    current,
    /** "defaultColors", "recentAndDefaultColors" or "recentColors": what the row holds, for its name. */
    groupLabel: recentCount === 0 ? "defaultColors" : recentCount === shown.length ? "recentColors" : "recentAndDefaultColors",
    /** Not one of the swatches: the picker shows it. */
    custom: !shown.some((choice) => choice.value === current),
    startChoosing: () => { choosing.current = true; },
    /** Focus left the row: show the history in its saved order. */
    stopChoosing: () => {
      choosing.current = false;
      setShown(saved);
    },
  };
}

type BrandChoicesState = ReturnType<typeof useBrandChoices>;

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * The color picker first, then the recently used colors and the defaults left
 * in their slots as a radio group: one Tab stop on the checked color, arrows
 * move and choose, every color named with its code ("Usato di recente, #2b59a8").
 */
export function BrandColorChoices({ value, state, onPick, onPickerOpenChange }: {
  value: string;
  state: BrandChoicesState;
  onPick: (color: string) => void;
  /** The picker opened or closed: the editor saves its color once, on close (use-settings holdChatSaves). */
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const { t } = useApp();
  const { choices, current, custom, groupLabel } = state;
  const listRef = useRef<HTMLDivElement>(null);
  const checkedIndex = choices.findIndex((choice) => choice.value === current);
  // The Tab stop of the group: the checked color, else the first.
  const tabStop = checkedIndex >= 0 ? checkedIndex : 0;
  const labelOf = (choice: BrandChoice) => {
    const name = choice.label ? t(`widget.editor.${choice.label}`) : "";
    if (!choice.recent) return interpolate(t("widget.editor.defaultColor"), { name, hex: choice.value });
    return name
      ? interpolate(t("widget.editor.recentNamedColor"), { name, hex: choice.value })
      : interpolate(t("widget.editor.recentColor"), { hex: choice.value });
  };
  const pickerLabel = custom && current ? interpolate(t("widget.editor.customColorValue"), { hex: current }) : t("widget.editor.otherColor");

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !radios.length) return;
    let next: number;
    if (event.key in STEP) next = (index + STEP[event.key] + radios.length) % radios.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = radios.length - 1;
    else return;
    event.preventDefault();
    radios[next].focus();
    const color = radios[next].dataset.color;
    if (color) onPick(color);
  };

  return (
    <div
      className="we-swatches"
      onFocus={state.startChoosing}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) state.stopChoosing();
      }}
    >
      {/* Any color: the picker (area, hue, pasted code), first. */}
      <ColorPicker value={value} onChange={onPick} label={t("labels.primaryColor")} enableGradients={false}
        onOpenChange={onPickerOpenChange}
        trigger={
          <button type="button" className="we-swatch we-swatch-custom" aria-pressed={custom}
            aria-label={pickerLabel} title={pickerLabel}
            style={custom && current ? { background: current, color: contrastColor(current) } : undefined}>
            {custom ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
        } />
      <div ref={listRef} className="we-swatch-list" role="radiogroup" onKeyDown={onKeyDown}
        aria-label={t(`widget.editor.${groupLabel}`)}>
        {choices.map((choice, index) => {
          const on = choice.value === current;
          const label = labelOf(choice);
          return (
            <button key={choice.value} type="button" role="radio" className="we-swatch" aria-checked={on}
              tabIndex={index === tabStop ? 0 : -1} data-color={choice.value}
              aria-label={label} title={label}
              style={{ background: choice.value, color: contrastColor(choice.value) }}
              onClick={() => onPick(choice.value)}>
              {on && <Check aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
