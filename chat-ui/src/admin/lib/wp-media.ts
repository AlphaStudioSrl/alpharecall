import { wpFetch } from "./api";

// The admin SPA runs inside wp-admin, where class-ar-admin-ui.php enqueues the
// media library (wp_enqueue_media). The picker below is the same frame the
// post editor opens, so uploads land in the site's media library and the URL
// we store is a normal attachment URL. The REST fallback covers the case where
// wp.media failed to load (or the standalone dev harness).

type MediaAttachment = { url?: string };
type MediaSelection = { first(): { toJSON(): MediaAttachment } };
type MediaFrame = {
  on(event: string, callback: () => void): void;
  open(): void;
  state(): { get(key: "selection"): MediaSelection };
};
type WpMedia = (options: Record<string, unknown>) => MediaFrame;

function mediaApi(): WpMedia | null {
  const wp = (window as Window & { wp?: { media?: unknown } }).wp;
  return typeof wp?.media === "function" ? (wp.media as WpMedia) : null;
}

export function hasMediaLibrary(): boolean {
  return mediaApi() !== null;
}

/**
 * Opens the WordPress media library restricted to images. Resolves with the
 * chosen attachment URL, or null when the frame is dismissed. Returns null
 * synchronously when the library is not loaded so the caller can fall back.
 */
export function pickImageFromLibrary(labels: { title: string; button: string }): Promise<string | null> | null {
  const media = mediaApi();
  if (!media) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (url: string | null) => {
      if (settled) return;
      settled = true;
      resolve(url);
    };
    const frame = media({
      title: labels.title,
      button: { text: labels.button },
      library: { type: "image" },
      multiple: false,
    });
    frame.on("select", () => {
      const attachment = frame.state().get("selection").first().toJSON();
      done(typeof attachment.url === "string" && attachment.url ? attachment.url : null);
    });
    // The toolbar closes the frame and only then triggers "select", both in
    // the same tick, so a dismissal is settled one macrotask later: a real
    // selection lands first and wins, an Escape or backdrop click resolves null.
    frame.on("close", () => {
      setTimeout(() => done(null), 0);
    });
    frame.open();
  });
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isImageFile(file: File): boolean {
  return IMAGE_TYPES.has(file.type);
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[._-]+/, "");
  return cleaned || "image";
}

/** Uploads one image to the media library over the core REST API. */
export async function uploadImageFile(file: File): Promise<string> {
  const { data } = await wpFetch<{ source_url?: string }>("/wp/v2/media", {
    method: "POST",
    body: file,
    headers: {
      "Content-Type": file.type,
      // WordPress reads the name verbatim (no percent decoding), so keep it ASCII.
      "Content-Disposition": `attachment; filename="${safeFilename(file.name)}"`,
    },
  });
  if (typeof data.source_url !== "string" || !data.source_url) throw new Error("The upload didn't work.");
  return data.source_url;
}
