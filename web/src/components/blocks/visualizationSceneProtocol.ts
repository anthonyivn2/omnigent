export const VISUALIZATION_SCENE_COLORS = [
  "background",
  "surface",
  "text",
  "muted",
  "grid",
  "accent",
  "blue",
  "cyan",
  "violet",
  "pink",
  "orange",
  "lime",
  "teal",
  "positive",
  "warning",
  "negative",
] as const;

export type VisualizationSceneColor = (typeof VISUALIZATION_SCENE_COLORS)[number];
export type VisualizationSceneRenderer = "react" | "canvas" | "flow";

interface VisualizationSceneElementBase {
  id: string;
  action?: string;
  value?: string;
  ariaLabel?: string;
  opacity?: number;
}

export interface VisualizationSceneRect extends VisualizationSceneElementBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
  fill?: VisualizationSceneColor;
  stroke?: VisualizationSceneColor;
  strokeWidth?: number;
  label?: string;
  labelColor?: VisualizationSceneColor;
  fontSize?: number;
}

export interface VisualizationSceneCircle extends VisualizationSceneElementBase {
  type: "circle";
  x: number;
  y: number;
  radius: number;
  fill?: VisualizationSceneColor;
  stroke?: VisualizationSceneColor;
  strokeWidth?: number;
  label?: string;
  labelColor?: VisualizationSceneColor;
  fontSize?: number;
}

export interface VisualizationSceneText extends VisualizationSceneElementBase {
  type: "text";
  x: number;
  y: number;
  text: string;
  color?: VisualizationSceneColor;
  fontSize?: number;
  maxWidth?: number;
  fontWeight?: "normal" | "medium" | "bold" | number;
  align?: "left" | "center" | "right";
}

export interface VisualizationScenePath extends VisualizationSceneElementBase {
  type: "path";
  points: Array<{ x: number; y: number }>;
  stroke?: VisualizationSceneColor;
  strokeWidth?: number;
  dashed?: boolean;
  arrowEnd?: boolean;
  label?: string;
  labelColor?: VisualizationSceneColor;
  fontSize?: number;
}

export type VisualizationSceneElement =
  | VisualizationSceneRect
  | VisualizationSceneCircle
  | VisualizationSceneText
  | VisualizationScenePath;

interface VisualizationSceneBase {
  width: number;
  height: number;
  ariaLabel?: string;
  panZoom: boolean;
}

export interface VisualizationDrawingScene extends VisualizationSceneBase {
  renderer: "react" | "canvas";
  elements: VisualizationSceneElement[];
}

export interface VisualizationFlowNode {
  id: string;
  title: string;
  subtitle?: string;
  details?: string;
  badge?: string;
  tone?: VisualizationSceneColor;
  selected?: boolean;
  action?: string;
  value?: string;
  ariaLabel?: string;
}

export interface VisualizationFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  tone?: VisualizationSceneColor;
  dashed?: boolean;
}

export interface VisualizationFlowScene extends VisualizationSceneBase {
  renderer: "flow";
  direction: "horizontal" | "vertical";
  nodes: VisualizationFlowNode[];
  edges: VisualizationFlowEdge[];
}

export type VisualizationScene = VisualizationDrawingScene | VisualizationFlowScene;

const MAX_SCENE_SIZE = 500_000;
const MAX_ELEMENTS = 2_000;
const MAX_FLOW_NODES = 250;
const MAX_FLOW_EDGES = 500;
const MAX_PATH_POINTS = 20_000;
const MAX_COORDINATE = 100_000;
const MAX_LABEL = 2_000;
const COLORS = new Set<string>(VISUALIZATION_SCENE_COLORS);

export function parseVisualizationScene(value: unknown): VisualizationScene {
  if (!isRecord(value)) throw new Error("rendered scene must be an object");
  if (JSON.stringify(value).length > MAX_SCENE_SIZE) throw new Error("rendered scene is too large");
  const renderer = value.renderer;
  if (renderer !== "react" && renderer !== "canvas" && renderer !== "flow") {
    throw new Error('scene.renderer must be "react", "canvas", or "flow"');
  }
  const width = number(value.width, "scene.width", 100, 10_000);
  const height = number(value.height, "scene.height", 100, 10_000);
  const common = {
    width,
    height,
    panZoom: value.panZoom === undefined ? true : boolean(value.panZoom, "scene.panZoom"),
    ...(value.ariaLabel === undefined
      ? {}
      : { ariaLabel: string(value.ariaLabel, "scene.ariaLabel", MAX_LABEL) }),
  };
  if (renderer === "flow") return parseFlowScene(value, common);
  if (!Array.isArray(value.elements) || value.elements.length > MAX_ELEMENTS) {
    throw new Error(`scene.elements must contain at most ${MAX_ELEMENTS} elements`);
  }

  const ids = new Set<string>();
  let pointCount = 0;
  const elements = value.elements.map((element, index) => {
    const parsed = parseElement(element, index);
    if (ids.has(parsed.id)) throw new Error(`scene element id must be unique: ${parsed.id}`);
    ids.add(parsed.id);
    if (parsed.type === "path") pointCount += parsed.points.length;
    return parsed;
  });
  if (pointCount > MAX_PATH_POINTS) {
    throw new Error(`scene paths must contain at most ${MAX_PATH_POINTS} points`);
  }

  return { renderer, ...common, elements };
}

function parseFlowScene(
  value: Record<string, unknown>,
  common: Omit<VisualizationFlowScene, "renderer" | "direction" | "nodes" | "edges">,
): VisualizationFlowScene {
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > MAX_FLOW_NODES
  ) {
    throw new Error(`scene.nodes must contain between 1 and ${MAX_FLOW_NODES} nodes`);
  }
  if (!Array.isArray(value.edges) || value.edges.length > MAX_FLOW_EDGES) {
    throw new Error(`scene.edges must contain at most ${MAX_FLOW_EDGES} edges`);
  }
  const direction = value.direction ?? "horizontal";
  if (direction !== "horizontal" && direction !== "vertical") {
    throw new Error('scene.direction must be "horizontal" or "vertical"');
  }
  const ids = new Set<string>();
  const nodes = value.nodes.map((candidate, index): VisualizationFlowNode => {
    if (!isRecord(candidate)) throw new Error(`scene.nodes[${index}] must be an object`);
    const field = `scene.nodes[${index}]`;
    const id = string(candidate.id, `${field}.id`, 100);
    if (ids.has(id)) throw new Error(`scene node id must be unique: ${id}`);
    ids.add(id);
    return {
      id,
      title: string(candidate.title, `${field}.title`, 200),
      ...(candidate.subtitle === undefined
        ? {}
        : { subtitle: string(candidate.subtitle, `${field}.subtitle`, 500) }),
      ...(candidate.details === undefined
        ? {}
        : { details: string(candidate.details, `${field}.details`, 2_000) }),
      ...(candidate.badge === undefined
        ? {}
        : { badge: string(candidate.badge, `${field}.badge`, 100) }),
      ...(candidate.tone === undefined ? {} : { tone: color(candidate.tone, `${field}.tone`) }),
      ...(candidate.selected === undefined
        ? {}
        : { selected: boolean(candidate.selected, `${field}.selected`) }),
      ...(candidate.action === undefined
        ? {}
        : { action: string(candidate.action, `${field}.action`, 100) }),
      ...(candidate.value === undefined
        ? {}
        : { value: string(candidate.value, `${field}.value`, 2_000) }),
      ...(candidate.ariaLabel === undefined
        ? {}
        : { ariaLabel: string(candidate.ariaLabel, `${field}.ariaLabel`, MAX_LABEL) }),
    };
  });
  const edgeIds = new Set<string>();
  const edges = value.edges.map((candidate, index): VisualizationFlowEdge => {
    if (!isRecord(candidate)) throw new Error(`scene.edges[${index}] must be an object`);
    const field = `scene.edges[${index}]`;
    const id = string(candidate.id, `${field}.id`, 100);
    if (edgeIds.has(id)) throw new Error(`scene edge id must be unique: ${id}`);
    edgeIds.add(id);
    const source = string(candidate.source, `${field}.source`, 100);
    const target = string(candidate.target, `${field}.target`, 100);
    if (!ids.has(source) || !ids.has(target)) {
      throw new Error(`${field} must reference existing nodes`);
    }
    return {
      id,
      source,
      target,
      ...(candidate.label === undefined
        ? {}
        : { label: string(candidate.label, `${field}.label`, 200) }),
      ...(candidate.tone === undefined ? {} : { tone: color(candidate.tone, `${field}.tone`) }),
      ...(candidate.dashed === undefined
        ? {}
        : { dashed: boolean(candidate.dashed, `${field}.dashed`) }),
    };
  });
  return { renderer: "flow", ...common, direction, nodes, edges };
}

function parseElement(value: unknown, index: number): VisualizationSceneElement {
  if (!isRecord(value)) throw new Error(`scene.elements[${index}] must be an object`);
  const field = `scene.elements[${index}]`;
  const base = {
    id: string(value.id, `${field}.id`, 100),
    ...(value.action === undefined ? {} : { action: string(value.action, `${field}.action`, 100) }),
    ...(value.value === undefined ? {} : { value: string(value.value, `${field}.value`, 2_000) }),
    ...(value.ariaLabel === undefined
      ? {}
      : { ariaLabel: string(value.ariaLabel, `${field}.ariaLabel`, MAX_LABEL) }),
    ...(value.opacity === undefined
      ? {}
      : { opacity: number(value.opacity, `${field}.opacity`, 0, 1) }),
  };

  if (value.type === "rect") {
    return {
      ...base,
      type: "rect",
      x: coordinate(value.x, `${field}.x`),
      y: coordinate(value.y, `${field}.y`),
      width: number(value.width, `${field}.width`, 0, MAX_COORDINATE),
      height: number(value.height, `${field}.height`, 0, MAX_COORDINATE),
      ...shapeStyle(value, field),
      ...(value.radius === undefined
        ? {}
        : { radius: number(value.radius, `${field}.radius`, 0, MAX_COORDINATE) }),
      ...labelStyle(value, field),
    };
  }
  if (value.type === "circle") {
    return {
      ...base,
      type: "circle",
      x: coordinate(value.x, `${field}.x`),
      y: coordinate(value.y, `${field}.y`),
      radius: number(value.radius, `${field}.radius`, 0, MAX_COORDINATE),
      ...shapeStyle(value, field),
      ...labelStyle(value, field),
    };
  }
  if (value.type === "text") {
    const fontWeight = value.fontWeight;
    if (
      fontWeight !== undefined &&
      typeof fontWeight !== "number" &&
      !["normal", "medium", "bold"].includes(String(fontWeight))
    ) {
      throw new Error(`${field}.fontWeight is invalid`);
    }
    const align = value.align;
    if (align !== undefined && !["left", "center", "right"].includes(String(align))) {
      throw new Error(`${field}.align is invalid`);
    }
    return {
      ...base,
      type: "text",
      x: coordinate(value.x, `${field}.x`),
      y: coordinate(value.y, `${field}.y`),
      text: string(value.text, `${field}.text`, MAX_LABEL),
      ...(value.color === undefined ? {} : { color: color(value.color, `${field}.color`) }),
      ...(value.fontSize === undefined
        ? {}
        : { fontSize: number(value.fontSize, `${field}.fontSize`, 8, 128) }),
      ...(value.maxWidth === undefined
        ? {}
        : { maxWidth: number(value.maxWidth, `${field}.maxWidth`, 1, MAX_COORDINATE) }),
      ...(fontWeight === undefined
        ? {}
        : {
            fontWeight:
              typeof fontWeight === "number"
                ? number(fontWeight, `${field}.fontWeight`, 100, 900)
                : (fontWeight as VisualizationSceneText["fontWeight"]),
          }),
      ...(align === undefined ? {} : { align: align as VisualizationSceneText["align"] }),
    };
  }
  if (value.type === "path") {
    if (!Array.isArray(value.points) || value.points.length < 2 || value.points.length > 2_000) {
      throw new Error(`${field}.points must contain between 2 and 2000 points`);
    }
    return {
      ...base,
      type: "path",
      points: value.points.map((point, pointIndex) => {
        if (!isRecord(point)) throw new Error(`${field}.points[${pointIndex}] must be an object`);
        return {
          x: coordinate(point.x, `${field}.points[${pointIndex}].x`),
          y: coordinate(point.y, `${field}.points[${pointIndex}].y`),
        };
      }),
      ...(value.stroke === undefined ? {} : { stroke: color(value.stroke, `${field}.stroke`) }),
      ...(value.strokeWidth === undefined
        ? {}
        : { strokeWidth: number(value.strokeWidth, `${field}.strokeWidth`, 0, 32) }),
      ...(value.dashed === undefined ? {} : { dashed: boolean(value.dashed, `${field}.dashed`) }),
      ...(value.arrowEnd === undefined
        ? {}
        : { arrowEnd: boolean(value.arrowEnd, `${field}.arrowEnd`) }),
      ...labelStyle(value, field),
    };
  }
  throw new Error(`${field}.type must be rect, circle, text, or path`);
}

function shapeStyle(value: Record<string, unknown>, field: string) {
  return {
    ...(value.fill === undefined ? {} : { fill: color(value.fill, `${field}.fill`) }),
    ...(value.stroke === undefined ? {} : { stroke: color(value.stroke, `${field}.stroke`) }),
    ...(value.strokeWidth === undefined
      ? {}
      : { strokeWidth: number(value.strokeWidth, `${field}.strokeWidth`, 0, 32) }),
  };
}

function labelStyle(value: Record<string, unknown>, field: string) {
  return {
    ...(value.label === undefined
      ? {}
      : { label: string(value.label, `${field}.label`, MAX_LABEL) }),
    ...(value.labelColor === undefined
      ? {}
      : { labelColor: color(value.labelColor, `${field}.labelColor`) }),
    ...(value.fontSize === undefined
      ? {}
      : { fontSize: number(value.fontSize, `${field}.fontSize`, 8, 128) }),
  };
}

function coordinate(value: unknown, field: string): number {
  return number(value, field, -MAX_COORDINATE, MAX_COORDINATE);
}

function number(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}`);
  }
  return value;
}

function string(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${field} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function color(value: unknown, field: string): VisualizationSceneColor {
  if (typeof value !== "string" || !COLORS.has(value)) {
    throw new Error(`${field} must be a supported visualization color`);
  }
  return value as VisualizationSceneColor;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
