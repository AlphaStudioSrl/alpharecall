import * as React from "react";
import { FileText, ImageIcon, Loader2, Paperclip, X, Download } from "lucide-react";
import { ATTACHMENT_ACCEPT, ATTACHMENT_MAX_FILES, AttachmentUploadError, attachmentBlob, attachmentErrorText, attachmentExpiry, attachmentLabels,
  attachmentOverflowText, checkAttachmentFile, formatAttachmentSize, type AttachmentClient, type ChatAttachment } from "@/lib/chat-attachments";
import { SurfacePortal } from "@/components/ui/surface-portal";
import "./attachments.css";

type DraftFile = { key: string; filename: string; state: "uploading" | "ready" | "error"; attachment?: ChatAttachment; error?: string };

export function useAttachmentDraft(client?: AttachmentClient, scope?: string, locale?: string) {
  const [files, setFiles] = React.useState<DraftFile[]>([]);
  const [error, setError] = React.useState("");
  const items = React.useRef<DraftFile[]>([]);
  const requests = React.useRef(new Map<string, AbortController>());
  const clientRef = React.useRef(client); clientRef.current = client;
  const generation = React.useRef(0);
  const labels = attachmentLabels(locale);
  const update = (next: DraftFile[]) => { items.current = next; setFiles(next); };
  const reset = () => {
    generation.current++;
    requests.current.forEach(request => request.abort()); requests.current.clear();
    for (const item of items.current) if (item.attachment) void clientRef.current?.remove(item.attachment.id).catch(() => {});
    items.current = [];
  };
  React.useEffect(() => { setFiles([]); setError(""); return reset; }, [scope]);
  const add = async (chosen: File[]) => {
    if (!clientRef.current || !chosen.length) return;
    const free = ATTACHMENT_MAX_FILES - items.current.length;
    if (free <= 0) { setError(labels.tooMany); return; }
    // A refused file is named with its reason (type or size); the others still upload.
    const notes: string[] = [];
    const valid = chosen.filter(file => {
      const problem = checkAttachmentFile(file);
      if (problem) notes.push(`${file.name}: ${attachmentErrorText(problem, locale)}`);
      return !problem;
    });
    // More valid files than free slots: the first ones go, the rest are named (card 4ctdtub8dgtr).
    const selected = valid.slice(0, free);
    const left = valid.slice(free);
    if (left.length) notes.push(attachmentOverflowText(selected.length, chosen.length, left.map(file => file.name), locale));
    setError(notes.join("\n"));
    if (!selected.length) return;
    const version = generation.current;
    const batch = selected.map(file => ({ key: crypto.randomUUID(), filename: file.name, state: "uploading" as const }));
    update([...items.current, ...batch]);
    for (let index = 0; index < selected.length; index++) {
      const item = batch[index];
      if (version !== generation.current || !items.current.some(value => value.key === item.key)) continue;
      const controller = new AbortController(); requests.current.set(item.key, controller);
      try {
        const attachment = await clientRef.current.upload(selected[index], controller.signal);
        if (controller.signal.aborted || version !== generation.current) {
          void clientRef.current.remove(attachment.id).catch(() => {}); continue;
        }
        update(items.current.map(value => value.key === item.key ? { ...value, filename: attachment.filename, state: "ready", attachment } : value));
      } catch (cause) {
        if (!controller.signal.aborted && version === generation.current) {
          // Only a refusal the server explained is shown as such; never its English text.
          const error = cause instanceof AttachmentUploadError ? attachmentErrorText(cause.problem, locale) : labels.failed;
          update(items.current.map(value => value.key === item.key ? { ...value, state: "error", error } : value));
        }
      } finally { requests.current.delete(item.key); }
    }
  };
  const remove = (key: string) => {
    requests.current.get(key)?.abort();
    const item = items.current.find(value => value.key === key);
    if (item?.attachment) void clientRef.current?.remove(item.attachment.id).catch(() => {});
    update(items.current.filter(value => value.key !== key)); setError("");
  };
  const clearSent = () => { update([]); setError(""); };
  return { files, error, add, remove, clearSent, labels, client, locale,
    busy: files.some(file => file.state === "uploading"),
    blocked: files.some(file => file.state !== "ready"),
    ready: files.flatMap(file => file.attachment ? [file.attachment] : []),
  };
}

export type AttachmentDraft = ReturnType<typeof useAttachmentDraft>;

export function AttachmentPicker({ draft, disabled }: { draft: AttachmentDraft; disabled?: boolean }) {
  const input = React.useRef<HTMLInputElement>(null);
  // The hidden input is driven by the button: only the button is announced (card z5f6pyphwy9r).
  return <><input className="sr-only" ref={input} type="file" accept={ATTACHMENT_ACCEPT} multiple tabIndex={-1}
    aria-hidden="true" disabled={disabled || draft.busy} onChange={event => {
      void draft.add(Array.from(event.target.files || [])); event.target.value = "";
    }} /><button type="button" className="ar-attachment-add" disabled={disabled || draft.busy || draft.files.length >= ATTACHMENT_MAX_FILES}
      aria-label={draft.labels.add} title={draft.labels.hint} onClick={() => input.current?.click()}><Paperclip size={19} /></button></>;
}

export function AttachmentDraftList({ draft, disabled }: { draft: AttachmentDraft; disabled?: boolean }) {
  return <div className="ar-attachment-draft">
    {draft.files.length > 0 && <><ul className="ar-attachment-list" aria-live="polite">{draft.files.map(file => <li key={file.key}>
      {file.state === "uploading" ? <Loader2 className="animate-spin" size={16} /> : <FileText size={16} />}
      <span><strong>{file.filename}</strong><small role={file.state === "error" ? "alert" : undefined}>
        {file.state === "uploading" ? draft.labels.uploading : file.state === "error" ? file.error : formatAttachmentSize(file.attachment?.size_bytes || 0, draft.locale)}
      </small></span><button type="button" disabled={disabled} onClick={() => draft.remove(file.key)} aria-label={`${draft.labels.remove} ${file.filename}`}><X size={16} /></button>
    </li>)}</ul><p className="ar-attachment-hint">{draft.labels.hint}</p></>}
    {draft.error && <p className="ar-attachment-error" role="alert">{draft.error}</p>}
  </div>;
}

export function MessageAttachments({ files, client, locale }: { files?: ChatAttachment[]; client?: AttachmentClient; locale?: string }) {
  const [open, setOpen] = React.useState<ChatAttachment | null>(null);
  if (!files?.length || !client) return null;
  return <><ul className="ar-message-attachments">{files.map(file => {
    const expiry = attachmentExpiry(file.expires_at, locale);
    // Past its date the file is gone: shown, never requested (card 6831gtx4dop2).
    const gone = !!expiry?.expired;
    return <li key={file.id}>
      <button type="button" disabled={gone} aria-disabled={gone || undefined} data-expired={gone || undefined}
        onClick={gone ? undefined : () => setOpen(file)}>{file.kind === "image" ? <ImageIcon size={18} /> : <FileText size={18} />}
        <span>{file.filename}<small>{file.kind === "pdf" ? attachmentLabels(locale).extracted : formatAttachmentSize(file.size_bytes, locale)}</small>
          {expiry && <small className="ar-attachment-expiry" data-expired={expiry.expired || undefined}>{expiry.text}</small>}</span>
      </button></li>;
  })}</ul>{open && <AttachmentPreview file={open} client={client} locale={locale} onClose={() => setOpen(null)} />}</>;
}

/** The preview lives in a layer on <body> (SurfacePortal copies the widget's
 * tokens), never inside the thread: a modal <dialog> inherits CSS such as the
 * closed panel's `pointer-events: none` and `visibility`, and its keys bubble
 * through the React tree to the panel, whose Escape handler closed the chat
 * and left the dialog open and the whole page inert (card jwtf934w01te). */
function AttachmentPreview(props: { file: ChatAttachment; client: AttachmentClient; locale?: string; onClose: () => void }) {
  // Read before the dialog's autoFocus moves focus into it: focus goes back here on close.
  const [returnTo] = React.useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  return <SurfacePortal><AttachmentPreviewDialog {...props} returnTo={returnTo} /></SurfacePortal>;
}

/** True when a click on the dialog element landed on its ::backdrop, not on the box. */
export function isBackdropClick(dialog: HTMLElement, event: { target: EventTarget | null; clientX: number; clientY: number }) {
  if (event.target !== dialog) return false;
  const box = dialog.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
}

function AttachmentPreviewDialog({ file, client, locale, onClose, returnTo }: { file: ChatAttachment; client: AttachmentClient; locale?: string; onClose: () => void; returnTo: HTMLElement | null }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const [url, setUrl] = React.useState("");
  const [text, setText] = React.useState("");
  const [failed, setFailed] = React.useState(false);
  const labels = attachmentLabels(locale);
  const closeRef = React.useRef(onClose); closeRef.current = onClose;
  React.useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    // A close the component did not ask for (the browser closing it on Esc
    // without a cancel event, a form method=dialog) still clears the state,
    // otherwise the same file could never be opened again.
    const closed = () => closeRef.current();
    node.addEventListener("close", closed);
    if (!node.open) { try { node.showModal(); } catch { node.setAttribute("open", ""); } }
    return () => {
      node.removeEventListener("close", closed);
      if (node.open) { try { node.close(); } catch { node.removeAttribute("open"); } }
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [returnTo]);
  React.useEffect(() => {
    const controller = new AbortController(); let objectUrl = "";
    void client.read(file.id, controller.signal).then(content => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(attachmentBlob(content)); setUrl(objectUrl); setText(content.text || "");
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, client]);
  return <dialog ref={dialog} className="ar-attachment-modal" aria-label={file.filename}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      // Keys stay in the preview: the chat panel closes itself on Escape.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
    }}
    onClick={event => { if (isBackdropClick(event.currentTarget, event)) onClose(); }}>
    <header><strong>{file.filename}</strong><button type="button" onClick={onClose} aria-label={labels.close} autoFocus><X size={20} /></button></header>
    {failed ? <p role="alert">{labels.unavailable}</p> : !url ? <p role="status">{labels.loading}</p>
      : file.kind === "image" ? <img src={url} alt={file.filename} /> : <pre>{text}</pre>}
    {url && <a href={url} download={file.kind === "pdf" ? `${file.filename}.txt` : file.kind === "image" ? `${file.filename.replace(/\.[^.]+$/, "")}.jpg` : file.filename}>
      <Download size={16} />{file.kind === "pdf" ? labels.extracted : labels.download}</a>}
  </dialog>;
}
