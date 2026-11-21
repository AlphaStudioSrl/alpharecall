import { useState, useRef, useEffect, useCallback, useId } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { Pipette } from "@/components/icons";
import { useApp } from "@/admin/app-context";
import { contrastColor } from "@/lib/brand-color";
import { hexToHsv, hsvToHex, parseColorInput, type Hsv } from "@/admin/lib/color";

const PRESET_COLORS = [
  "#000000", "#374151", "#6b7280", "#9ca3af", "#d1d5db", "#ffffff",
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6",
  "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb",
  "#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa",
  "#8b5cf6", "#a855f7", "#d946ef", "#ec4899", "#f43f5e", "#6366f1",
];

const PRESET_GRADIENTS = [
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
  "linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)",
  "linear-gradient(135deg, #0c0c0c 0%, #1a1a2e 100%)",
  "linear-gradient(135deg, #1e3a5f 0%, #2d8f6f 100%)",
  "linear-gradient(135deg, #ff6b6b 0%, #556270 100%)",
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  defaultLabel?: string;
  enableGradients?: boolean;
  /** Opens the picker instead of the default full-width field (the Widget color row's swatch). */
  trigger?: React.ReactElement;
  /**
   * The panel opened or closed, however it closed (Esc, a click outside, a
   * preset, Applica). Aspetto > Colore saves the color once, on close, not
   * every shade the area passes through.
   */
  onOpenChange?: (open: boolean) => void;
}

type Tab = "solid" | "gradient" | "custom";

function isGradient(v: string) {
  return v.includes("gradient");
}

function previewStyle(v: string): React.CSSProperties {
  if (isGradient(v)) return { background: v };
  return { backgroundColor: v };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A solid color: the presets, a saturation/brightness area with a hue slider,
 * and a field that takes a pasted #RRGGBB, #RGB or rgb() code. Every pick
 * calls onChange with a lowercase #rrggbb; a code that is not a color says so
 * under the field and changes nothing.
 */
export function ColorPanel({ value, onChange, label, presets = PRESET_COLORS, onPick }: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
  presets?: readonly string[];
  /** A preset was clicked or Enter pressed on a valid code (the popover closes then). */
  onPick?: () => void;
}) {
  const { t } = useApp();
  const errorId = useId();
  const solid = parseColorInput(value);
  // HSV is kept here, not derived from `value`: black and greys have no hue,
  // and the slider must not jump back to red when the area reaches them.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(solid ?? "#000000"));
  const emitted = useRef(solid);
  const [text, setText] = useState(solid ?? "");
  const [invalid, setInvalid] = useState(false);

  // Dragging fires far more moves than frames; send one color per frame.
  const frame = useRef(0);
  const pending = useRef<string | null>(null);
  const dragging = useRef(false);
  useEffect(() => {
    // While a color waits for its frame (or the area is being dragged) the
    // parent can still be echoing an earlier one: it must not win.
    if (solid === emitted.current || dragging.current || frame.current) return;
    emitted.current = solid;
    if (solid) setHsv(hexToHsv(solid));
    setText(solid ?? "");
    setInvalid(false);
  }, [solid]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const emit = useCallback((next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    emitted.current = hex;
    setText(hex);
    setInvalid(false);
    pending.current = hex;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) onChange(pending.current);
    });
  }, [onChange]);

  const area = useRef<HTMLDivElement>(null);
  const pointAt = (event: React.PointerEvent) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect?.width || !rect.height) return;
    emit({ h: hsv.h, s: clamp((event.clientX - rect.left) / rect.width), v: clamp(1 - (event.clientY - rect.top) / rect.height) });
  };
  const areaKey = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.01;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    emit({ h: hsv.h, s: clamp(hsv.s + move[0]), v: clamp(hsv.v + move[1]) });
  };

  const typeCode = (next: string) => {
    setText(next);
    const parsed = parseColorInput(next);
    setInvalid(!parsed && next.trim() !== "");
    if (parsed && parsed !== emitted.current) {
      emitted.current = parsed;
      setHsv(hexToHsv(parsed));
      onChange(parsed);
    }
  };

  const current = solid ?? hsvToHex(hsv);
  const percent = (n: number) => Math.round(n * 100);

  return (
    <div className="ar-color-panel">
      {presets.length > 0 && (
        <div className="grid grid-cols-6 gap-1.5">
          {presets.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={solid === color}
              onClick={() => { typeCode(color); onPick?.(); }}
              className="ar-color-swatch size-7 rounded-md border-0 transition-transform cursor-pointer hover:scale-110"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}

      <div
        ref={area}
        className="ar-color-area"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        role="slider"
        tabIndex={0}
        aria-label={t("colorPicker.area")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent(hsv.s)}
        aria-valuetext={t("colorPicker.areaValue").replace("{s}", String(percent(hsv.s))).replace("{v}", String(percent(hsv.v)))}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus();
          dragging.current = true;
          pointAt(event);
        }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointAt(event); }}
        onPointerUp={() => { dragging.current = false; }}
        onLostPointerCapture={() => { dragging.current = false; }}
        onKeyDown={areaKey}
      >
        <span className="ar-color-area-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, backgroundColor: current }} />
      </div>

      <input
        type="range"
        className="ar-color-hue"
        min={0}
        max={359}
        step={1}
        value={Math.round(hsv.h) % 360}
        aria-label={t("colorPicker.hue")}
        onChange={(event) => emit({ ...hsv, h: Number(event.target.value) })}
      />

      <div className="flex items-center gap-2">
        <span className="ar-color-swatch ar-color-sample" style={{ backgroundColor: current, color: contrastColor(current) }} aria-hidden="true">Aa</span>
        <Input
          aria-label={label ? `${label}: ${t("colorPicker.code")}` : t("colorPicker.code")}
          value={text}
          onChange={(e) => typeCode(e.target.value)}
          onBlur={() => { if (!text.trim()) { setText(solid ?? ""); setInvalid(false); } }}
          onKeyDown={(e) => { if (e.key === "Enter" && parseColorInput(text)) onPick?.(); }}
          placeholder="#2b59a8"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="font-mono text-xs h-8"
          maxLength={40}
        />
      </div>
      {invalid && <p id={errorId} className="ar-field-error" role="alert">{t("colorPicker.invalid")}</p>}
    </div>
  );
}

export function ColorPicker({ value, onChange, label, defaultLabel, enableGradients = true, trigger, onOpenChange }: ColorPickerProps) {
  const { t } = useApp();
  const [open, setOpenState] = useState(false);
  const openChange = useRef(onOpenChange);
  openChange.current = onOpenChange;
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    openChange.current?.(next);
  }, []);
  const [tab, setTab] = useState<Tab>(isGradient(value) ? "gradient" : "solid");
  const [customInput, setCustomInput] = useState(value);

  useEffect(() => {
    setCustomInput(value);
  }, [value]);

  const selectColor = useCallback(
    (color: string) => {
      setCustomInput(color);
      setOpen(false);
      // Call onChange last so state is settled before any re-render from parent
      onChange(color);
    },
    [onChange, setOpen]
  );

  const handleCustomApply = useCallback(() => {
    const trimmed = customInput.trim();
    if (trimmed) {
      onChange(trimmed);
      setOpen(false);
    }
  }, [customInput, onChange, setOpen]);

  const displayValue = isGradient(value)
    ? (PRESET_GRADIENTS.includes(value) ? t("colorPicker.presetGradient") : t("colorPicker.customGradient"))
    : value || defaultLabel || "";

  // Rendered through a portal: the settings sections are collapsibles with
  // overflow-hidden, which used to slice the panel off at the section's edge.
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
      {trigger ?? (
      <button
        type="button"
        aria-label={`${label || t("colorPicker.pickCustomColor")}: ${displayValue}`}
        className={cn(
          "ar-ui-select flex items-center gap-2.5 w-full h-10 rounded-md border-0 bg-muted px-3 py-2",
          "text-sm transition-colors"
        )}
      >
        <div
          className="ar-color-swatch size-5 rounded-md shrink-0"
          style={previewStyle(value || "hsl(var(--ar-selected))")}
        />
        <span className="font-mono text-xs text-foreground flex-1 text-left truncate">
          {displayValue}
        </span>
        <Pipette className="size-3.5 text-muted-foreground shrink-0" />
      </button>
      )}
      </PopoverTrigger>

      <PopoverContent
        align={trigger ? "end" : "start"}
        sideOffset={4}
        aria-label={label || t("colorPicker.pickCustomColor")}
        className={cn(
          "ar-ui-menu min-w-[260px] rounded-lg border-0 bg-card p-0 shadow-lg overflow-hidden",
          trigger ? "w-[272px]" : "w-[var(--radix-popover-trigger-width)]"
        )}
      >
          {/* Tabs */}
          {enableGradients && (
            <div className="flex gap-1 bg-muted p-1">
              {(["solid", "gradient", "custom"] as Tab[]).map((tabKey) => (
                <button
                  key={tabKey}
                  type="button"
                  aria-pressed={tab === tabKey}
                  onClick={() => setTab(tabKey)}
                  className={cn(
                    "flex-1 rounded-md border-0 py-2 text-[11px] font-medium uppercase tracking-wider transition-colors",
                    tab === tabKey
                      ? "text-foreground bg-accent font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tabKey === "solid" ? t("colorPicker.solid") : tabKey === "gradient" ? t("colorPicker.gradient") : t("colorPicker.custom")}
                </button>
              ))}
            </div>
          )}

          <div className="p-3">
            {/* Solid colors: presets, the color area and the code field */}
            {tab === "solid" && (
              <ColorPanel value={isGradient(value) ? "" : value} onChange={onChange} label={label} onPick={() => setOpen(false)} />
            )}

            {/* Gradient presets tab */}
            {tab === "gradient" && (
              <div className="grid grid-cols-3 gap-2">
                {PRESET_GRADIENTS.map((grad) => (
                  <button
                    key={grad}
                    type="button"
                    aria-pressed={value === grad}
                    onClick={() => selectColor(grad)}
                    className={cn(
                      "ar-color-swatch h-10 rounded-md border-0 transition-transform cursor-pointer",
                      "hover:scale-105"
                    )}
                    style={{ background: grad }}
                    title={t("colorPicker.gradient")}
                  />
                ))}
              </div>
            )}

            {/* Custom input tab */}
            {tab === "custom" && (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  {t("colorPicker.cssHint")}
                </p>
                <div className="flex items-center gap-2">
                  <div
                    className="ar-color-swatch size-8 rounded-md shrink-0"
                    style={previewStyle(customInput || value)}
                  />
                  <Input
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCustomApply();
                    }}
                    placeholder="linear-gradient(135deg, #667eea, #764ba2)"
                    className="font-mono text-xs h-8"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCustomApply}
                  className="w-full py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                >
                  {t("colorPicker.apply")}
                </button>
              </div>
            )}
          </div>
      </PopoverContent>
    </Popover>
  );
}
