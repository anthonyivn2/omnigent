import { isAndroidShell, isElectronShell, isIOSShell } from "./nativeBridge";
import type { DisplayProfile } from "./types";

/** Return coarse capabilities only; no user agent or device identity leaves the client. */
export function getDisplayProfile(): DisplayProfile {
  const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const width = coarseDimension(viewportWidth);
  const height = coarseDimension(viewportHeight);
  const mountedAssistantWidth = document
    .querySelector<HTMLElement>('[data-role="assistant"]')
    ?.getBoundingClientRect().width;
  return {
    surface: isIOSShell()
      ? "ios"
      : isAndroidShell()
        ? "android"
        : isElectronShell()
          ? "desktop"
          : "web",
    viewport_width: width,
    viewport_height: height,
    canvas_width: coarseDimension(
      mountedAssistantWidth || Math.min(768, Math.max(240, viewportWidth - 32)),
    ),
    canvas_height: coarseDimension(Math.min(800, Math.max(240, Math.floor(viewportHeight * 0.6)))),
    layout: width <= 640 ? "compact" : width <= 1024 ? "regular" : "wide",
    orientation: width > height ? "landscape" : "portrait",
    pointer: window.matchMedia("(pointer: coarse)").matches ? "coarse" : "fine",
    color_scheme: document.documentElement.classList.contains("dark") ? "dark" : "light",
  };
}

function coarseDimension(value: number): number {
  return Math.min(4096, Math.max(240, Math.round(value / 16) * 16));
}
