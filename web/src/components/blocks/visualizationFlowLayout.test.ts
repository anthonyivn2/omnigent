import { describe, expect, it } from "vitest";
import { layoutVisualizationFlow } from "./visualizationFlowLayout";
import type { VisualizationFlowScene } from "./visualizationSceneProtocol";

const scene: VisualizationFlowScene = {
  renderer: "flow",
  width: 1200,
  height: 700,
  direction: "horizontal",
  panZoom: true,
  nodes: [
    { id: "input", title: "Input" },
    { id: "attention", title: "Attention" },
    { id: "mlp", title: "MLP" },
    { id: "output", title: "Output" },
  ],
  edges: [
    { id: "a", source: "input", target: "attention" },
    { id: "b", source: "input", target: "mlp" },
    { id: "c", source: "attention", target: "output" },
    { id: "d", source: "mlp", target: "output" },
  ],
};

describe("visualization flow layout", () => {
  it("places graph levels automatically without generated coordinates", () => {
    const layout = layoutVisualizationFlow(scene, 1200, 700);
    const positions = new Map(layout.nodes.map((node) => [node.id, node.position]));

    expect(layout.mode).toBe("horizontal");
    expect(positions.get("input")!.x).toBeLessThan(positions.get("attention")!.x);
    expect(positions.get("attention")!.x).toBe(positions.get("mlp")!.x);
    expect(positions.get("attention")!.y).not.toBe(positions.get("mlp")!.y);
    expect(positions.get("output")!.x).toBeGreaterThan(positions.get("attention")!.x);
  });

  it("uses a vertical flow in narrow portrait cards", () => {
    const layout = layoutVisualizationFlow(scene, 480, 600);
    const positions = new Map(layout.nodes.map((node) => [node.id, node.position]));

    expect(layout.mode).toBe("vertical");
    expect(positions.get("input")!.y).toBeLessThan(positions.get("attention")!.y);
    expect(positions.get("attention")!.y).toBe(positions.get("mlp")!.y);
    expect(positions.get("attention")!.x).not.toBe(positions.get("mlp")!.x);
  });

  it("wraps long flows instead of shrinking them into one row", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `stage-${index}`,
      title: `Stage ${index + 1}`,
    }));
    const longScene: VisualizationFlowScene = {
      ...scene,
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        id: `edge-${index}`,
        source: nodes[index]!.id,
        target: node.id,
      })),
    };
    const layout = layoutVisualizationFlow(longScene, 704, 660);

    expect(layout.mode).toBe("wrapped");
    expect(layout.scale).toBeGreaterThan(0.7);
    expect(new Set(layout.nodes.map((node) => node.position.y)).size).toBeGreaterThan(1);
  });
});
