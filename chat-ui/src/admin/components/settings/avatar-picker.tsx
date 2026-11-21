import { Button } from "@/components/ui/button";
import { useApp } from "@/admin/app-context";
import { getConfig } from "@/admin/lib/config";
import { cn } from "@/lib/utils";

const PORTRAIT_COUNT = 16;

export function AvatarPicker({ value, fallbackUrl, restoreLabel, onChange }: {
  value: string;
  fallbackUrl: string;
  /** The button that clears the choice (onChange("")); defaults to "back to the assigned avatar". */
  restoreLabel?: string;
  onChange: (url: string) => void;
}) {
  const { t } = useApp();
  const assetsUrl = getConfig()?.assetsUrl;
  const base = assetsUrl ? new URL(assetsUrl, window.location.origin).href.replace(/\/$/, "") : "";
  if (!base) return null;
  return (
    <>
        <div className="grid grid-cols-4 gap-3" role="group" aria-label={t("widget.avatarPool")}>
          {Array.from({ length: PORTRAIT_COUNT }, (_, i) => {
            const number = String(i + 1).padStart(2, "0");
            const url = `${base}/img/bot-avatars/portrait-${number}.webp`;
            const selected = (value || fallbackUrl) === url;
            return (
              <button key={number} type="button" aria-label={`Avatar ${number}`} aria-pressed={selected}
                onClick={() => onChange(url)}
                className={cn("relative aspect-square overflow-hidden rounded-2xl border-0 transition-[padding,background-color]", selected ? "bg-fill-2 p-1.5" : "p-0.5 hover:bg-fill")}>
                {/* The chosen portrait sits framed in a soft fill; no badge, no ring. */}
                <img src={url} alt="" width={384} height={384} className="size-full rounded-xl object-cover" />
              </button>
            );
          })}
        </div>
        {fallbackUrl && <Button type="button" variant="secondary" onClick={() => onChange("")}>{restoreLabel || t("widget.restoreAssignedAvatar")}</Button>}
    </>
  );
}
