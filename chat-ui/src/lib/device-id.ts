const STORAGE_KEY = "alpharecall_device_id";
const DEVICE_ID_RE = /^[a-f0-9]{32}$/;

let memoryDeviceId: string | null = null;

function readStoredDeviceId(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value && DEVICE_ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storeDeviceId(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // The in-memory copy remains available for this page lifetime.
  }
}

export function getDeviceId(): string | null {
  if (memoryDeviceId) return memoryDeviceId;

  if (typeof window !== "undefined") {
    const stored = readStoredDeviceId();
    if (stored) {
      memoryDeviceId = stored;
      return stored;
    }
  }

  const cryptoApi = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") return null;

  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  memoryDeviceId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (typeof window !== "undefined") storeDeviceId(memoryDeviceId);
  return memoryDeviceId;
}
