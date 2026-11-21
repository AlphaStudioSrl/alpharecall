import { useSyncExternalStore } from "react";
import { apiFetch } from "./api";

export const NOTIFICATION_TYPES = ["chat", "message", "escalation", "lead", "submission", "appointment", "feedback"] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];
export type NotificationPreferences = Record<NotificationType, boolean>;
const CHANGED = "ar:notification-preferences-changed";

export function normalizeNotificationPreferences(value: unknown): NotificationPreferences {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(NOTIFICATION_TYPES.map(type => [type, record[type] !== false])) as NotificationPreferences;
}

const defaults = normalizeNotificationPreferences(null);
let cachedScope = "";
let cachedValue: unknown;
let snapshot = defaults;

function scope() {
  const config = window.AlphaRecallAdmin;
  return JSON.stringify([config?.siteUrl, config?.settings?.tenant_id, config?.currentUser?.id]);
}

function readPreferences() {
  const value = window.AlphaRecallAdmin?.notificationPreferences;
  const key = scope();
  if (key !== cachedScope || value !== cachedValue) {
    cachedScope = key;
    cachedValue = value;
    snapshot = normalizeNotificationPreferences(value);
  }
  return snapshot;
}

function subscribe(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

export function useNotificationPreferences() {
  return useSyncExternalStore(subscribe, readPreferences, () => defaults);
}

function publish(preferences: NotificationPreferences) {
  if (window.AlphaRecallAdmin) window.AlphaRecallAdmin.notificationPreferences = preferences;
  window.dispatchEvent(new Event(CHANGED));
}

export async function saveNotificationPreferences(patch: Partial<NotificationPreferences>) {
  const key = scope();
  const before = readPreferences();
  publish({ ...before, ...patch });
  try {
    const result = await apiFetch<{ notifications: NotificationPreferences }>("/ui-prefs", {
      method: "POST", body: JSON.stringify({ notifications: patch }),
    });
    if (!result?.notifications || NOTIFICATION_TYPES.some(type => typeof result.notifications[type] !== "boolean")) {
      throw new Error("Invalid notification preferences response");
    }
    if (scope() === key) publish(normalizeNotificationPreferences(result.notifications));
  } catch (error) {
    if (scope() === key) publish(before);
    throw error;
  }
}
