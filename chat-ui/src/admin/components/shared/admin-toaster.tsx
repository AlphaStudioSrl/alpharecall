/**
 * The admin's toasts, for the plugin entry and the dev harness alike.
 *
 * They sit at the top centre, under the WordPress admin bar (32px). At the
 * bottom right they covered the buttons that had just been pressed: "Segna
 * come fatta" and "Rispondi via email" in the Richieste sheet, the Inbox
 * composer's send button. On a phone they sit at the very top, over the admin
 * bar, so they stay above the bottom sheet's top bar (status, menu, close).
 */
import { Toaster } from "sonner";
import { getStoredLang } from "@/admin/lib/i18n";

export function AdminToaster({ className }: { className?: string }) {
  return (
    <Toaster
      position="top-center"
      offset={{ top: 48 }}
      mobileOffset={{ top: 8 }}
      // sonner appends the shortcut (" alt+T") itself.
      containerAriaLabel={getStoredLang() === "en" ? "Notifications, open with" : "Notifiche, apri con"}
      toastOptions={className ? { className } : undefined}
      theme="dark"
      richColors
    />
  );
}
