import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Image, Loader2, Upload } from "@/components/icons";
import { Link, Undo2 } from "lucide-react";
import { useApp } from "@/admin/app-context";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { LabelWithHelp } from "@/admin/components/shared/help-tooltip";
import { isImageFile, uploadImageFile } from "@/admin/lib/wp-media";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AvatarPicker } from "./avatar-picker";

const HTTP_URL = /^https?:\/\//i;

/**
 * One visible action, with explicit preset/upload/URL paths. URL edits are a
 * draft until applied; device uploads still become WordPress media attachments.
 */
export function ImageField({
  id,
  label,
  help,
  value,
  fallbackUrl = "",
  avatarPool = false,
  actionLabel,
  description,
  clearLabel,
  tone,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  /** One quiet line under the label. */
  description?: string;
  value: string;
  fallbackUrl?: string;
  avatarPool?: boolean;
  /** The button and dialog title: "Cambia l'avatar" unless the image is not an avatar. */
  actionLabel?: string;
  /** Offers "back to the fallback" (onChange("")) in the dialog, e.g. the dark avatar back to the light one. */
  clearLabel?: string;
  /** "dark" shows the thumbnail on a dark tile, as the image will appear. */
  tone?: "dark";
  onChange: (url: string) => void;
}) {
  const { t } = useApp();
  const action = actionLabel || t("widget.changeAvatar");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"choices" | "presets" | "url">("choices");
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const choiceRef = useRef<HTMLButtonElement>(null);
  const uploadRevision = useRef(0);

  function changeOpen(next: boolean) {
    uploadRevision.current++;
    setOpen(next);
    setView("choices");
    setDraft(value);
    setError("");
    setBusy(false);
  }

  const choose = (url: string) => { onChange(url); changeOpen(false); };

  useEffect(() => () => { uploadRevision.current++; }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      (view === "url" ? urlRef.current : view === "presets" ? backRef.current : choiceRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, view]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isImageFile(file)) {
      setError(t("widget.uploadNotImage"));
      return;
    }
    setBusy(true);
    setError("");
    const revision = uploadRevision.current;
    try {
      const url = await uploadImageFile(file);
      if (revision === uploadRevision.current) choose(url);
    } catch {
      if (revision === uploadRevision.current) setError(t("widget.uploadFailed"));
    } finally {
      if (revision === uploadRevision.current) setBusy(false);
    }
  }

  const image = value || fallbackUrl;
  const showThumb = HTTP_URL.test(image);
  // A settings row (kit .ark-row): label and help on the left, the image and
  // its one action on the right.
  return (
    <div className="ark-row we-image-row" data-avatar-field={id}>
      <span className="ark-row-text">
        <LabelWithHelp help={help}>
          <Label htmlFor={id} className="ark-row-label">{label}</Label>
        </LabelWithHelp>
        {description && <small className="ark-row-desc">{description}</small>}
      </span>
      <div className="we-image-control">
        <div className={`ar-image-preview flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full border-0${tone === "dark" ? " bg-[#18181b]" : showThumb ? " bg-[hsl(var(--ar-control))]" : ""}`} data-empty={showThumb ? undefined : ""} data-tone={tone}>
          {showThumb ? (
            <img src={image} alt="" className="size-full border-0 object-cover" />
          ) : (
            <Image className="size-5 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <Dialog open={open} onOpenChange={changeOpen}>
          <DialogTrigger asChild><Button id={id} type="button" variant="secondary" size="sm" aria-label={action}>{action}</Button></DialogTrigger>
          <DialogContent className="max-w-lg" aria-busy={busy}>
            <DialogHeader>
              <DialogTitle>{view === "presets" ? t("widget.selectPresetAvatars") : view === "url" ? t("widget.enterAvatarUrl") : action}</DialogTitle>
              <DialogDescription>{view === "presets" ? t("widget.avatarPoolHelp") : t("widget.changeAvatarHelp")}</DialogDescription>
            </DialogHeader>
            {view !== "choices" && <Button ref={backRef} type="button" variant="ghost" className="w-fit gap-2" onClick={() => { setError(""); setView("choices"); }}><ArrowLeft className="size-4" />{t("common.back")}</Button>}
            {view === "choices" && <div className="grid gap-2">
              {avatarPool && <Button ref={choiceRef} type="button" variant="secondary" disabled={busy} className="h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left whitespace-normal" onClick={() => { setError(""); setView("presets"); }}><Image className="size-5 shrink-0" />{t("widget.selectPresetAvatars")}</Button>}
              <Button type="button" variant="secondary" disabled={busy} className="h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left whitespace-normal" onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="size-5 shrink-0 animate-spin" /> : <Upload className="size-5 shrink-0" />}{t("widget.uploadAvatarPhoto")}</Button>
              <Button type="button" variant="secondary" disabled={busy} className="h-auto min-h-14 justify-start gap-3 px-4 py-3 text-left whitespace-normal" onClick={() => { setError(""); setView("url"); }}><Link className="size-5 shrink-0" />{t("widget.enterAvatarUrl")}</Button>
              {clearLabel && value && <Button type="button" variant="ghost" disabled={busy} className="h-auto min-h-11 justify-start gap-3 px-4 py-2 text-left whitespace-normal" onClick={() => choose("")}><Undo2 className="size-5 shrink-0" />{clearLabel}</Button>}
            </div>}
            {view === "presets" && <AvatarPicker value={value} fallbackUrl={fallbackUrl} restoreLabel={clearLabel} onChange={choose} />}
            {view === "url" && <form className="space-y-4" onSubmit={(event) => {
              event.preventDefault();
              try {
                const url = new URL(draft.trim());
                if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invalid image URL");
                choose(url.href);
              } catch { setError(t("widget.invalidAvatarUrl")); }
            }}>
              <div className="space-y-2"><Label htmlFor={`${id}-url`}>{t("widget.avatarUrl")}</Label><Input ref={urlRef} id={`${id}-url`} value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }} placeholder="https://…" autoComplete="url" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} /></div>
              <Button type="submit" className="w-full" disabled={!draft.trim()}>{t("widget.uploadImageUse")}</Button>
            </form>}
            {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
          </DialogContent>
        </Dialog>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label={t("widget.uploadAvatarPhoto")} className="hidden" onChange={(event) => void onFile(event)} />
    </div>
  );
}
