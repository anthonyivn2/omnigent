/// <reference lib="webworker" />

import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import {
  buildVisualizationProgram,
  parseVisualizationRenderOutput,
  type VisualizationAction,
  type VisualizationLayout,
  type VisualizationRenderOutput,
  type VisualizationWorkerRequest,
  type VisualizationWorkerResponse,
} from "./visualizationRuntimeProtocol";

const quickJS = newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
let javascript = "";
let data: Record<string, unknown> = {};
let fallbackHtml = "";
let state: Record<string, unknown> = {};
let queue = Promise.resolve();

self.onmessage = (message: MessageEvent<VisualizationWorkerRequest>) => {
  queue = queue.then(() => handle(message.data)).catch(() => undefined);
};

async function handle(request: VisualizationWorkerRequest): Promise<void> {
  if (request.type === "init") {
    javascript = request.javascript;
    data = request.data;
    fallbackHtml = request.fallbackHtml;
    state = {};
  }
  try {
    const snapshot = await render(request.type === "render" ? request.event : null, request.layout);
    state = snapshot.state ?? state;
    post({ type: "snapshot", requestId: request.requestId, snapshot });
  } catch (error) {
    post({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function render(
  event: VisualizationAction | null,
  layout: VisualizationLayout,
): Promise<VisualizationRenderOutput> {
  const module = await quickJS;
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = performance.now() + 100;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const context = runtime.newContext();
  try {
    const result = context.evalCode(
      buildVisualizationProgram(javascript, {
        data,
        state,
        event,
        layout,
      }),
      "visualization.js",
    );
    const outputHandle = context.unwrapResult(result);
    try {
      const serialized = context.dump(outputHandle);
      if (typeof serialized !== "string") {
        throw new Error("render(context) returned a non-serializable value");
      }
      return parseVisualizationRenderOutput(JSON.parse(serialized), fallbackHtml);
    } finally {
      outputHandle.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

function post(message: VisualizationWorkerResponse): void {
  self.postMessage(message);
}
