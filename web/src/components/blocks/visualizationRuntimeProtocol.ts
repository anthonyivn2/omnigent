import { parseVisualizationScene, type VisualizationScene } from "./visualizationSceneProtocol";

export interface VisualizationLayout {
  width: number;
  height: number;
  mode: "compact" | "regular" | "wide";
  pointer: "coarse" | "fine";
  colorScheme: "light" | "dark";
}

export interface VisualizationAction {
  action: string;
  value: string | null;
  checked: boolean | null;
}

export interface VisualizationRenderInput {
  data: Record<string, unknown>;
  state: Record<string, unknown>;
  event: VisualizationAction | null;
  layout: VisualizationLayout;
}

export interface VisualizationRenderOutput {
  html: string;
  css?: string;
  state?: Record<string, unknown>;
  scene?: VisualizationScene;
}

export type VisualizationWorkerRequest =
  | {
      type: "init";
      requestId: number;
      javascript: string;
      data: Record<string, unknown>;
      fallbackHtml: string;
      layout: VisualizationLayout;
    }
  | {
      type: "render";
      requestId: number;
      event: VisualizationAction | null;
      layout: VisualizationLayout;
    };

export type VisualizationWorkerResponse =
  | { type: "snapshot"; requestId: number; snapshot: VisualizationRenderOutput }
  | { type: "error"; requestId: number; message: string };

export function buildVisualizationProgram(
  javascript: string,
  input: VisualizationRenderInput,
): string {
  const serializedInput = JSON.stringify(JSON.stringify(input));
  return `"use strict";
${javascript}
if (typeof render !== "function") throw new Error("javascript must define render(context)");
const __omnigentInput = JSON.parse(${serializedInput});
const __omnigentOutput = render(__omnigentInput);
if (__omnigentOutput && typeof __omnigentOutput.then === "function") {
  throw new Error("render(context) must be synchronous");
}
JSON.stringify(__omnigentOutput);`;
}

export function parseVisualizationRenderOutput(
  value: unknown,
  fallbackHtml = "",
): VisualizationRenderOutput {
  if (!isRecord(value)) throw new Error("render(context) must return an object");
  const html = value.html === undefined ? fallbackHtml : value.html;
  if (typeof html !== "string" || html.trim().length === 0) {
    throw new Error("render(context) must return non-empty html");
  }
  if (html.length > 200_000) throw new Error("rendered html is too long");
  if (value.css !== undefined && typeof value.css !== "string") {
    throw new Error("rendered css must be a string");
  }
  if (typeof value.css === "string" && value.css.length > 100_000) {
    throw new Error("rendered css is too long");
  }
  if (value.state !== undefined && !isRecord(value.state)) {
    throw new Error("rendered state must be an object");
  }
  if (value.state !== undefined && JSON.stringify(value.state).length > 250_000) {
    throw new Error("rendered state is too large");
  }
  const scene = value.scene === undefined ? undefined : parseVisualizationScene(value.scene);
  return {
    html,
    ...(typeof value.css === "string" ? { css: value.css } : {}),
    ...(isRecord(value.state) ? { state: value.state } : {}),
    ...(scene === undefined ? {} : { scene }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
