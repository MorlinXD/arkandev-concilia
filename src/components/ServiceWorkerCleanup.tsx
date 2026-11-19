"use client";
import { useEffect } from "react";

/** Concilia no usa service workers: si hay alguno registrado (de otro proyecto), lo quita y recarga una vez. */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(async (regs) => {
      if (regs.length === 0) return;
      await Promise.all(regs.map((r) => r.unregister()));
      if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k);
      if (!sessionStorage.getItem("sw-cleaned")) {
        sessionStorage.setItem("sw-cleaned", "1");
        location.reload();
      }
    });
  }, []);
  return null;
}
