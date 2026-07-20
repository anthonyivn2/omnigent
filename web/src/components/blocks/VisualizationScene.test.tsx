import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualizationSceneRenderer } from "./VisualizationScene";
import type { VisualizationScene } from "./visualizationSceneProtocol";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const baseScene: VisualizationScene = {
  renderer: "react",
  width: 800,
  height: 500,
  ariaLabel: "Transformer component graph",
  panZoom: true,
  elements: [
    {
      type: "rect",
      id: "attention",
      x: 100,
      y: 80,
      width: 220,
      height: 100,
      label: "Attention",
      action: "inspect",
      value: "attention",
      fill: "surface",
      stroke: "accent",
    },
    {
      type: "path",
      id: "output",
      points: [
        { x: 320, y: 130 },
        { x: 480, y: 130 },
      ],
      arrowEnd: true,
    },
  ],
};

describe("VisualizationSceneRenderer", () => {
  it("renders an interactive React scene with pan and zoom controls", () => {
    const onAction = vi.fn();
    const { container } = render(
      <VisualizationSceneRenderer
        title="Transformer"
        scene={baseScene}
        theme="dark"
        width={800}
        height={500}
        onAction={onAction}
      />,
    );

    expect(screen.getByRole("group", { name: "Transformer component graph" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Attention" }));
    expect(onAction).toHaveBeenCalledWith({
      action: "inspect",
      value: "attention",
      checked: null,
    });
    const sceneGroup = container.querySelector("svg > g");
    const initialTransform = sceneGroup?.getAttribute("transform");
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    expect(zoomIn.parentElement).toHaveClass("opacity-20");
    fireEvent.click(zoomIn);
    expect(sceneGroup?.getAttribute("transform")).not.toBe(initialTransform);
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeInTheDocument();
  });

  it("draws a Canvas scene and keeps actions keyboard accessible", () => {
    const context = new Proxy(
      {},
      {
        get: (target, property) => (property in target ? Reflect.get(target, property) : vi.fn()),
        set: (target, property, value) => Reflect.set(target, property, value),
      },
    ) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    const onAction = vi.fn();
    render(
      <VisualizationSceneRenderer
        title="Transformer"
        scene={{ ...baseScene, renderer: "canvas" }}
        theme="light"
        width={800}
        height={500}
        onAction={onAction}
      />,
    );

    const canvas = screen.getByRole("img", {
      name: "Transformer component graph",
    }) as HTMLCanvasElement;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ width: 800, height: 500 }),
    );
    fireEvent.click(canvas, { clientX: 150, clientY: 120 });
    expect(onAction).toHaveBeenCalledWith({
      action: "inspect",
      value: "attention",
      checked: null,
    });
    expect(screen.getByRole("button", { name: "Attention" })).toBeInTheDocument();
  });
});
