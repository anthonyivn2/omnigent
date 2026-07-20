import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import { cn } from "@/lib/utils";
import { visualizationThemeColors, type VisualizationThemeColors } from "./visualizationDocument";
import type { VisualizationAction } from "./visualizationRuntimeProtocol";
import type {
  VisualizationDrawingScene,
  VisualizationScene,
  VisualizationSceneElement,
  VisualizationScenePath,
  VisualizationSceneText,
} from "./visualizationSceneProtocol";

const FlowScene = lazy(() => import("./VisualizationFlowScene"));

interface VisualizationSceneProps {
  title: string;
  scene: VisualizationScene;
  theme: "light" | "dark";
  width: number;
  height: number;
  onAction: (event: VisualizationAction) => void;
  className?: string;
}

export function VisualizationSceneRenderer(props: VisualizationSceneProps) {
  if (props.scene.renderer === "flow") {
    const colors = visualizationThemeColors(props.theme);
    return (
      <Suspense
        fallback={
          <div
            className={cn("grid w-full place-items-center text-sm", props.className)}
            style={{ height: props.height, background: colors.background, color: colors.muted }}
          >
            Laying out diagram…
          </div>
        }
      >
        <FlowScene {...props} scene={props.scene} colors={colors} />
      </Suspense>
    );
  }
  return <DrawingSceneRenderer {...props} scene={props.scene} />;
}

function DrawingSceneRenderer({
  title,
  scene,
  theme,
  width,
  height,
  onAction,
  className,
}: VisualizationSceneProps & { scene: VisualizationDrawingScene }) {
  const colors = useMemo(() => visualizationThemeColors(theme), [theme]);
  const viewport = useSceneViewport(scene, width, height);
  const common = {
    title,
    scene,
    colors,
    width,
    height,
    onAction,
    viewport,
  };

  return (
    <div
      className={cn("relative w-full overflow-hidden", className)}
      style={{
        height,
        background: colors.background,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      {scene.renderer === "canvas" ? <CanvasScene {...common} /> : <ReactScene {...common} />}
      {scene.panZoom && (
        <SceneControls colors={colors} onZoom={viewport.zoomBy} onReset={viewport.reset} />
      )}
    </div>
  );
}

interface SceneSurfaceProps {
  title: string;
  scene: VisualizationDrawingScene;
  colors: VisualizationThemeColors;
  width: number;
  height: number;
  onAction: (event: VisualizationAction) => void;
  viewport: ReturnType<typeof useSceneViewport>;
}

function ReactScene({
  title,
  scene,
  colors,
  width,
  height,
  onAction,
  viewport,
}: SceneSurfaceProps) {
  const markerId = `visualization-arrow-${useId().replaceAll(":", "")}`;
  const trigger = (element: VisualizationSceneElement) => {
    if (!element.action) return;
    onAction({ action: element.action, value: element.value ?? element.id, checked: null });
  };

  const hasActions = scene.elements.some((element) => element.action);
  return (
    <svg
      role={hasActions ? "group" : "img"}
      aria-label={scene.ariaLabel ?? title}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("block h-full w-full", scene.panZoom && "touch-none cursor-grab")}
      onPointerDown={viewport.onPointerDown}
      onPointerMove={viewport.onPointerMove}
      onPointerUp={viewport.onPointerUp}
      onPointerCancel={viewport.onPointerUp}
      onWheel={viewport.onWheel}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" />
        </marker>
      </defs>
      <rect width={width} height={height} fill={colors.background} />
      <g
        transform={`translate(${viewport.transform.x} ${viewport.transform.y}) scale(${viewport.transform.scale})`}
      >
        {scene.elements.map((element) => {
          const interactionProps = element.action
            ? {
                role: "button",
                tabIndex: 0,
                "aria-label": element.ariaLabel ?? elementLabel(element),
                onPointerDown: (event: PointerEvent<SVGGElement>) => event.stopPropagation(),
                onClick: () => trigger(element),
                onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  trigger(element);
                },
                style: { cursor: "pointer" },
              }
            : {};
          return (
            <g key={element.id} opacity={element.opacity ?? 1} {...interactionProps}>
              {renderSvgElement(element, colors, markerId)}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function CanvasScene({
  title,
  scene,
  colors,
  width,
  height,
  onAction,
  viewport,
}: SceneSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.fillStyle = colors.background;
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(viewport.transform.x, viewport.transform.y);
    context.scale(viewport.transform.scale, viewport.transform.scale);
    for (const element of scene.elements) drawCanvasElement(context, element, colors);
    context.restore();
  }, [colors, height, scene, viewport.transform, width]);

  const activate = (element: VisualizationSceneElement) => {
    if (!element.action) return;
    onAction({ action: element.action, value: element.value ?? element.id, checked: null });
  };
  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!viewport.consumeClick()) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const screenX = (event.clientX - rect.left) * (width / Math.max(1, rect.width));
    const screenY = (event.clientY - rect.top) * (height / Math.max(1, rect.height));
    const point = {
      x: (screenX - viewport.transform.x) / viewport.transform.scale,
      y: (screenY - viewport.transform.y) / viewport.transform.scale,
    };
    const target = [...scene.elements]
      .reverse()
      .find((element) => element.action && hitTest(element, point));
    if (target) activate(target);
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={scene.ariaLabel ?? title}
        className={cn("block h-full w-full", scene.panZoom && "touch-none cursor-grab")}
        onPointerDown={viewport.onPointerDown}
        onPointerMove={viewport.onPointerMove}
        onPointerUp={viewport.onPointerUp}
        onPointerCancel={viewport.onPointerUp}
        onWheel={viewport.onWheel}
        onClick={onClick}
      />
      <div className="sr-only">
        {scene.elements.map((element) => {
          const label = accessibleElementLabel(element);
          if (!label) return null;
          return element.action ? (
            <button key={element.id} type="button" onClick={() => activate(element)}>
              {label}
            </button>
          ) : (
            <span key={element.id}>{label}</span>
          );
        })}
      </div>
    </>
  );
}

function useSceneViewport(scene: VisualizationDrawingScene, width: number, height: number) {
  const [view, setView] = useState({ panX: 0, panY: 0, zoom: 1 });
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const dragged = useRef(false);
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const baseScale = Math.min(safeWidth / scene.width, safeHeight / scene.height);
  const baseX = (safeWidth - scene.width * baseScale) / 2;
  const baseY = (safeHeight - scene.height * baseScale) / 2;
  const transform = {
    x: baseX + view.panX,
    y: baseY + view.panY,
    scale: baseScale * view.zoom,
  };

  useEffect(() => setView({ panX: 0, panY: 0, zoom: 1 }), [scene.height, scene.width]);

  const zoomAt = (nextZoom: number, x = safeWidth / 2, y = safeHeight / 2) => {
    setView((current) => {
      const zoom = Math.max(0.25, Math.min(8, nextZoom));
      const ratio = zoom / current.zoom;
      return {
        zoom,
        panX: x - baseX - (x - baseX - current.panX) * ratio,
        panY: y - baseY - (y - baseY - current.panY) * ratio,
      };
    });
  };
  const eventPoint = (event: PointerEvent<Element> | WheelEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (safeWidth / Math.max(1, rect.width)),
      y: (event.clientY - rect.top) * (safeHeight / Math.max(1, rect.height)),
    };
  };

  return {
    transform,
    onPointerDown: (event: PointerEvent<Element>) => {
      if (!scene.panZoom || event.button !== 0) return;
      const point = eventPoint(event);
      drag.current = { ...point, panX: view.panX, panY: view.panY };
      dragged.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<Element>) => {
      if (!drag.current) return;
      const point = eventPoint(event);
      const dx = point.x - drag.current.x;
      const dy = point.y - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged.current = true;
      setView((current) => ({
        ...current,
        panX: drag.current!.panX + dx,
        panY: drag.current!.panY + dy,
      }));
    },
    onPointerUp: (event: PointerEvent<Element>) => {
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    onWheel: (event: WheelEvent<Element>) => {
      if (!scene.panZoom) return;
      event.preventDefault();
      const point = eventPoint(event);
      zoomAt(view.zoom * Math.exp(-event.deltaY * 0.0015), point.x, point.y);
    },
    zoomBy: (factor: number) => zoomAt(view.zoom * factor),
    reset: () => setView({ panX: 0, panY: 0, zoom: 1 }),
    consumeClick: () => {
      const click = !dragged.current;
      dragged.current = false;
      return click;
    },
  };
}

function SceneControls({
  colors,
  onZoom,
  onReset,
}: {
  colors: VisualizationThemeColors;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  const style = { background: colors.surface, color: colors.text, borderColor: colors.grid };
  return (
    <div
      className="absolute right-2 top-2 flex overflow-hidden rounded-lg border opacity-20 shadow-sm transition-opacity hover:opacity-100 focus-within:opacity-100"
      style={style}
    >
      <button
        type="button"
        aria-label="Zoom in"
        className="h-11 min-h-11 w-11 border-r text-lg"
        style={{ borderColor: colors.grid }}
        onClick={() => onZoom(1.25)}
      >
        +
      </button>
      <button
        type="button"
        aria-label="Zoom out"
        className="h-11 min-h-11 w-11 border-r text-lg"
        style={{ borderColor: colors.grid }}
        onClick={() => onZoom(0.8)}
      >
        −
      </button>
      <button
        type="button"
        aria-label="Reset view"
        className="h-11 min-h-11 px-3 text-xs"
        onClick={onReset}
      >
        Reset
      </button>
    </div>
  );
}

function renderSvgElement(
  element: VisualizationSceneElement,
  colors: VisualizationThemeColors,
  markerId: string,
) {
  if (element.type === "rect") {
    return (
      <>
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rx={element.radius ?? 8}
          fill={colors[element.fill ?? "surface"]}
          stroke={colors[element.stroke ?? "grid"]}
          strokeWidth={element.strokeWidth ?? 1.5}
        />
        {element.label &&
          svgText(
            element.label,
            element.x + element.width / 2,
            element.y + element.height / 2,
            "center",
            element.fontSize ?? 15,
            colors[element.labelColor ?? "text"],
            "medium",
            Math.max(1, element.width - 16),
          )}
      </>
    );
  }
  if (element.type === "circle") {
    return (
      <>
        <circle
          cx={element.x}
          cy={element.y}
          r={element.radius}
          fill={colors[element.fill ?? "surface"]}
          stroke={colors[element.stroke ?? "grid"]}
          strokeWidth={element.strokeWidth ?? 1.5}
        />
        {element.label &&
          svgText(
            element.label,
            element.x,
            element.y,
            "center",
            element.fontSize ?? 15,
            colors[element.labelColor ?? "text"],
            "medium",
            element.radius * 1.6,
          )}
      </>
    );
  }
  if (element.type === "text") {
    return svgText(
      element.text,
      element.x,
      element.y,
      element.align ?? "left",
      element.fontSize ?? 15,
      colors[element.color ?? "text"],
      element.fontWeight ?? "normal",
      element.maxWidth,
    );
  }
  const midpoint = element.points[Math.floor(element.points.length / 2)]!;
  return (
    <>
      <polyline
        points={element.points.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={colors[element.stroke ?? "grid"]}
        strokeWidth={element.strokeWidth ?? 2}
        strokeDasharray={element.dashed ? "7 6" : undefined}
        markerEnd={element.arrowEnd ? `url(#${markerId})` : undefined}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {element.label &&
        svgText(
          element.label,
          midpoint.x,
          midpoint.y - (element.fontSize ?? 13),
          "center",
          element.fontSize ?? 13,
          colors[element.labelColor ?? "muted"],
          "medium",
          undefined,
        )}
    </>
  );
}

function svgText(
  value: string,
  x: number,
  y: number,
  align: "left" | "center" | "right",
  fontSize: number,
  fill: string,
  fontWeight: NonNullable<VisualizationSceneText["fontWeight"]>,
  maxWidth?: number,
) {
  const lines = wrapText(value, maxWidth, fontSize);
  const anchor = align === "left" ? "start" : align === "right" ? "end" : "middle";
  const firstY = y - ((lines.length - 1) * fontSize * 1.2) / 2;
  return (
    <text
      x={x}
      y={firstY}
      fill={fill}
      fontSize={fontSize}
      fontWeight={fontWeight === "medium" ? 600 : fontWeight}
      textAnchor={anchor}
      dominantBaseline="middle"
      pointerEvents="none"
    >
      {lines.map((line, index) => (
        <tspan
          key={lines.slice(0, index + 1).join("\n")}
          x={x}
          dy={index === 0 ? 0 : fontSize * 1.2}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

function drawCanvasElement(
  context: CanvasRenderingContext2D,
  element: VisualizationSceneElement,
  colors: VisualizationThemeColors,
): void {
  context.save();
  context.globalAlpha = element.opacity ?? 1;
  if (element.type === "rect") {
    roundedRect(context, element.x, element.y, element.width, element.height, element.radius ?? 8);
    context.fillStyle = colors[element.fill ?? "surface"];
    context.fill();
    context.strokeStyle = colors[element.stroke ?? "grid"];
    context.lineWidth = element.strokeWidth ?? 1.5;
    context.stroke();
    if (element.label) {
      drawCanvasText(
        context,
        element.label,
        element.x + element.width / 2,
        element.y + element.height / 2,
        "center",
        element.fontSize ?? 15,
        colors[element.labelColor ?? "text"],
        "medium",
        Math.max(1, element.width - 16),
      );
    }
  } else if (element.type === "circle") {
    context.beginPath();
    context.arc(element.x, element.y, element.radius, 0, Math.PI * 2);
    context.fillStyle = colors[element.fill ?? "surface"];
    context.fill();
    context.strokeStyle = colors[element.stroke ?? "grid"];
    context.lineWidth = element.strokeWidth ?? 1.5;
    context.stroke();
    if (element.label) {
      drawCanvasText(
        context,
        element.label,
        element.x,
        element.y,
        "center",
        element.fontSize ?? 15,
        colors[element.labelColor ?? "text"],
        "medium",
        element.radius * 1.6,
      );
    }
  } else if (element.type === "text") {
    drawCanvasText(
      context,
      element.text,
      element.x,
      element.y,
      element.align ?? "left",
      element.fontSize ?? 15,
      colors[element.color ?? "text"],
      element.fontWeight ?? "normal",
      element.maxWidth,
    );
  } else {
    drawCanvasPath(context, element, colors);
  }
  context.restore();
}

function drawCanvasPath(
  context: CanvasRenderingContext2D,
  element: VisualizationScenePath,
  colors: VisualizationThemeColors,
): void {
  context.beginPath();
  context.moveTo(element.points[0]!.x, element.points[0]!.y);
  for (const point of element.points.slice(1)) context.lineTo(point.x, point.y);
  context.strokeStyle = colors[element.stroke ?? "grid"];
  context.lineWidth = element.strokeWidth ?? 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.setLineDash(element.dashed ? [7, 6] : []);
  context.stroke();
  context.setLineDash([]);
  if (element.arrowEnd) {
    const end = element.points.at(-1)!;
    const before = element.points.at(-2)!;
    const angle = Math.atan2(end.y - before.y, end.x - before.x);
    const size = Math.max(6, (element.strokeWidth ?? 2) * 3);
    context.beginPath();
    context.moveTo(end.x, end.y);
    context.lineTo(
      end.x - size * Math.cos(angle - Math.PI / 6),
      end.y - size * Math.sin(angle - Math.PI / 6),
    );
    context.lineTo(
      end.x - size * Math.cos(angle + Math.PI / 6),
      end.y - size * Math.sin(angle + Math.PI / 6),
    );
    context.closePath();
    context.fillStyle = colors[element.stroke ?? "grid"];
    context.fill();
  }
  if (element.label) {
    const midpoint = element.points[Math.floor(element.points.length / 2)]!;
    drawCanvasText(
      context,
      element.label,
      midpoint.x,
      midpoint.y - (element.fontSize ?? 13),
      "center",
      element.fontSize ?? 13,
      colors[element.labelColor ?? "muted"],
      "medium",
      undefined,
    );
  }
}

function drawCanvasText(
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  align: "left" | "center" | "right",
  fontSize: number,
  color: string,
  fontWeight: NonNullable<VisualizationSceneText["fontWeight"]>,
  maxWidth?: number,
): void {
  const lines = wrapText(value, maxWidth, fontSize);
  const weight = fontWeight === "medium" ? 600 : fontWeight;
  context.font = `${weight} ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  const firstY = y - ((lines.length - 1) * fontSize * 1.2) / 2;
  lines.forEach((line, index) => context.fillText(line, x, firstY + index * fontSize * 1.2));
}

function wrapText(value: string, maxWidth: number | undefined, fontSize: number): string[] {
  if (!maxWidth) return value.split("\n");
  const maxCharacters = Math.max(1, Math.floor(maxWidth / (fontSize * 0.62)));
  return value.split("\n").flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) return [""];
    const lines: string[] = [];
    let line = words[0]!;
    for (const word of words.slice(1)) {
      if (`${line} ${word}`.length <= maxCharacters) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    return lines;
  });
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function hitTest(element: VisualizationSceneElement, point: { x: number; y: number }): boolean {
  if (element.type === "rect") {
    return (
      point.x >= element.x &&
      point.x <= element.x + element.width &&
      point.y >= element.y &&
      point.y <= element.y + element.height
    );
  }
  if (element.type === "circle") {
    return Math.hypot(point.x - element.x, point.y - element.y) <= element.radius;
  }
  if (element.type === "text") {
    const fontSize = element.fontSize ?? 14;
    const lines = wrapText(element.text, element.maxWidth, fontSize);
    const width = Math.max(...lines.map((line) => line.length)) * fontSize * 0.62;
    const height = lines.length * fontSize * 1.2;
    const left =
      element.align === "center"
        ? element.x - width / 2
        : element.align === "right"
          ? element.x - width
          : element.x;
    return (
      point.x >= left &&
      point.x <= left + width &&
      point.y >= element.y - height / 2 &&
      point.y <= element.y + height / 2
    );
  }
  const tolerance = Math.max(6, (element.strokeWidth ?? 2) + 4);
  return element.points
    .slice(1)
    .some((end, index) => distanceToSegment(point, element.points[index]!, end) <= tolerance);
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function elementLabel(element: VisualizationSceneElement): string {
  return accessibleElementLabel(element) ?? element.id;
}

function accessibleElementLabel(element: VisualizationSceneElement): string | undefined {
  if (element.ariaLabel) return element.ariaLabel;
  if (element.type === "text") return element.text;
  return element.label;
}
