import { afterEach, describe, expect, it, vi } from "vitest";
import { getDisplayProfile } from "./displayProfile";

afterEach(() => {
  document.documentElement.classList.remove("dark");
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("getDisplayProfile", () => {
  it("returns coarse capabilities without device identity", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 383 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 847 });
    document.documentElement.classList.add("dark");
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(pointer: coarse)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });

    expect(getDisplayProfile()).toEqual({
      surface: "web",
      viewport_width: 384,
      viewport_height: 848,
      canvas_width: 352,
      canvas_height: 512,
      layout: "compact",
      orientation: "portrait",
      pointer: "coarse",
      color_scheme: "dark",
    });
  });

  it("uses the mounted assistant column as the visualization canvas width", () => {
    document.body.innerHTML = '<div data-role="assistant"></div>';
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 704 }),
    );

    expect(getDisplayProfile().canvas_width).toBe(704);
  });
});
