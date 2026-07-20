import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
import { describe, expect, it } from "vitest";
import {
  buildVisualizationProgram,
  parseVisualizationRenderOutput,
} from "./visualizationRuntimeProtocol";

describe("visualization QuickJS contract", () => {
  it("runs pure render code without browser or network capabilities", async () => {
    const quickJS = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
    const serialized = quickJS.evalCode(
      buildVisualizationProgram(
        `function render({ data, state, event, layout }) {
          return {
            html: "<p>" + data.label + ":" + layout.mode + "</p>",
            state: { selected: event?.value ?? state.selected ?? null },
            css: typeof document + ":" + typeof fetch
          };
        }`,
        {
          data: { label: "Revenue" },
          state: {},
          event: { action: "select", value: "Q4", checked: null },
          layout: {
            width: 400,
            height: 320,
            mode: "compact",
            pointer: "coarse",
            colorScheme: "dark",
          },
        },
      ),
    );

    expect(typeof serialized).toBe("string");
    expect(parseVisualizationRenderOutput(JSON.parse(serialized as string))).toEqual({
      html: "<p>Revenue:compact</p>",
      css: "undefined:undefined",
      state: { selected: "Q4" },
    });
  });

  it("interrupts runaway generated code", async () => {
    const quickJS = await newQuickJSWASMModuleFromVariant(RELEASE_SYNC);
    const runtime = quickJS.newRuntime();
    runtime.setInterruptHandler(() => true);
    const context = runtime.newContext();
    try {
      const result = context.evalCode(
        buildVisualizationProgram("function render() { while (true) {} }", {
          data: {},
          state: {},
          event: null,
          layout: {
            width: 400,
            height: 320,
            mode: "compact",
            pointer: "coarse",
            colorScheme: "dark",
          },
        }),
      );
      expect(() => context.unwrapResult(result)).toThrow(/interrupted/i);
    } finally {
      context.dispose();
      runtime.dispose();
    }
  });

  it("validates a declarative React scene returned by generated code", () => {
    expect(
      parseVisualizationRenderOutput({
        html: "<p>Accessible fallback</p>",
        scene: {
          renderer: "react",
          width: 800,
          height: 500,
          panZoom: true,
          elements: [
            {
              type: "circle",
              id: "query",
              x: 120,
              y: 100,
              radius: 40,
              label: "Q",
              action: "inspect",
            },
          ],
        },
      }),
    ).toMatchObject({
      scene: {
        renderer: "react",
        panZoom: true,
        elements: [{ id: "query", action: "inspect" }],
      },
    });
  });

  it("uses the persisted HTML fallback for a scene-only render", () => {
    expect(
      parseVisualizationRenderOutput(
        {
          scene: {
            renderer: "flow",
            width: 1000,
            height: 600,
            nodes: [
              { id: "input", title: "Input", tone: "cyan" },
              { id: "output", title: "Output", action: "inspect" },
            ],
            edges: [{ id: "path", source: "input", target: "output" }],
          },
        },
        "<p>Accessible fallback</p>",
      ),
    ).toMatchObject({
      html: "<p>Accessible fallback</p>",
      scene: {
        renderer: "flow",
        direction: "horizontal",
        nodes: [{ id: "input" }, { action: "inspect" }],
      },
    });
  });

  it("rejects invalid render output", () => {
    expect(() => parseVisualizationRenderOutput({ html: "" })).toThrow(
      "must return non-empty html",
    );
  });
});
