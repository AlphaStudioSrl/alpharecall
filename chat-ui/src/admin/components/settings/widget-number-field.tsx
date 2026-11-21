import { useState } from "react";
import { useApp } from "@/admin/app-context";
import { interpolate } from "@/admin/lib/i18n";
import { Input } from "@/components/ui/input";
import { readWidgetNumber, WIDGET_NUMBERS, type WidgetNumberKey } from "@/lib/widget-numbers";

/**
 * A typed widget number (Distanza dai bordi). Every keystroke autosaves, so a
 * value is clamped to its range before it is saved and the field shows the
 * clamped value; an empty or partial entry saves nothing and, on blur, the field
 * goes back to the value it had (card b2ikiv66usde). `onHint` gets the short
 * line that says so, or "" once the value is back in range.
 *
 * Above the maximum the edge is shown at once: more keys only go further out.
 * Below the minimum the typed text stays while the field has focus (the minimum
 * is saved and the hint shown) and the edge is shown on blur, because showing it
 * at once makes it the start of the next key: "-5" shown as "0" turned a typed
 * -25 into "05", saved as 5.
 */
export function WidgetNumberField({ field, label, name, value, onCommit, onHint, hintId }: {
  field: WidgetNumberKey;
  /** Accessible name of the input. */
  label: string;
  /** The short visible name used in the hint (Lato, Sotto). */
  name: string;
  value: number;
  onCommit: (value: number) => void;
  onHint: (text: string) => void;
  hintId?: string;
}) {
  const { t } = useApp();
  const rule = WIDGET_NUMBERS[field];
  // The text held instead of the saved value: an entry that is not a number yet
  // ("" or "-"), or one below the minimum while it is still being typed.
  const [pending, setPending] = useState<{ text: string; below: boolean } | null>(null);
  const [hinted, setHinted] = useState(false);
  const hint = (text: string) => { setHinted(text !== ""); onHint(text); };

  return (
    <Input
      type="number"
      inputMode="numeric"
      min={rule.min}
      max={rule.max}
      step={1}
      aria-label={label}
      aria-describedby={hinted ? hintId : undefined}
      value={pending?.text ?? String(value)}
      onChange={(event) => {
        const text = event.target.value;
        const read = readWidgetNumber(field, text);
        if (read.kind === "empty") {
          setPending({ text, below: false });
          return;
        }
        setPending(read.kind === "clamped" && read.edge === "min" ? { text, below: true } : null);
        if (read.kind === "clamped") {
          hint(interpolate(t(read.edge === "max" ? "widget.editor.numberMax" : "widget.editor.numberMin"), {
            label: name, n: read.edge === "max" ? rule.max : rule.min,
          }));
        } else if (hinted) {
          hint("");
        }
        if (read.value !== value) onCommit(read.value);
      }}
      onBlur={() => {
        if (pending === null) return;
        setPending(null);
        // A held entry below the minimum keeps its hint and now shows the minimum.
        if (!pending.below) hint(interpolate(t("widget.editor.numberEmpty"), { label: name, n: value }));
      }}
    />
  );
}
