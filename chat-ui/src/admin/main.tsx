import { createRoot } from "react-dom/client";
import { AdminApp } from "./app";
import { AdminToaster } from "./components/shared/admin-toaster";
import "@fontsource-variable/geist";
import "./admin.css";

// Shared primitives own body-level portal roots and copy their originating
// theme. Unrelated WordPress dialogs stay outside the plugin style scope.

const root = document.getElementById("alpharecall-admin-app");

if (root && window.AlphaRecallAdmin) {
  root.innerHTML = "";
  createRoot(root).render(
    <>
      <AdminApp />
      <AdminToaster className="!bg-card !text-foreground !border-border" />
    </>
  );

  // Remove boot loader after React mounts
  const loader = document.getElementById("ar-boot-loader");
  if (loader) {
    loader.style.transition = "opacity 0.3s ease";
    loader.style.opacity = "0";
    setTimeout(() => loader.remove(), 300);
  }
}
