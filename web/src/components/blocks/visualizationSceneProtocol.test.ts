import { describe, expect, it } from "vitest";
import { parseVisualizationScene } from "./visualizationSceneProtocol";

describe("visualization scene protocol", () => {
  it("accepts trusted React and Canvas primitives", () => {
    expect(
      parseVisualizationScene({
        renderer: "canvas",
        width: 1200,
        height: 800,
        ariaLabel: "Transformer architecture",
        elements: [
          {
            type: "rect",
            id: "attention",
            x: 100,
            y: 80,
            width: 240,
            height: 120,
            label: "Attention",
            fill: "surface",
            stroke: "accent",
            action: "select",
          },
          {
            type: "text",
            id: "title",
            x: 600,
            y: 40,
            text: "Transformer architecture",
            fontWeight: 800,
            maxWidth: 240,
          },
          {
            type: "path",
            id: "residual",
            points: [
              { x: 220, y: 200 },
              { x: 220, y: 300 },
            ],
            stroke: "grid",
            arrowEnd: true,
          },
        ],
      }),
    ).toMatchObject({
      renderer: "canvas",
      panZoom: true,
      elements: [
        { id: "attention", action: "select" },
        { id: "title", fontWeight: 800, maxWidth: 240 },
        { id: "residual", arrowEnd: true },
      ],
    });
  });

  it("accepts auto-laid-out flow diagrams", () => {
    expect(
      parseVisualizationScene({
        renderer: "flow",
        width: 1200,
        height: 700,
        direction: "horizontal",
        nodes: [
          { id: "tokens", title: "Tokens", subtitle: "Input embeddings", tone: "blue" },
          {
            id: "attention",
            title: "Attention",
            badge: "Core",
            details: "Mixes information from earlier token positions.",
            tone: "violet",
            selected: true,
            action: "inspect",
          },
        ],
        edges: [
          {
            id: "tokens-attention",
            source: "tokens",
            target: "attention",
            label: "residual stream",
          },
        ],
      }),
    ).toMatchObject({
      renderer: "flow",
      panZoom: true,
      nodes: [
        { tone: "blue" },
        {
          action: "inspect",
          selected: true,
          details: "Mixes information from earlier token positions.",
        },
      ],
      edges: [{ source: "tokens", target: "attention" }],
    });
  });

  it("rejects executable styles and malformed geometry", () => {
    expect(() =>
      parseVisualizationScene({
        renderer: "react",
        width: 500,
        height: 400,
        elements: [
          {
            type: "rect",
            id: "bad",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            fill: "url(https://example.com/x)",
          },
        ],
      }),
    ).toThrow("supported visualization color");
    expect(() =>
      parseVisualizationScene({
        renderer: "canvas",
        width: 500,
        height: 400,
        elements: [{ type: "path", id: "bad", points: [{ x: 0, y: 0 }] }],
      }),
    ).toThrow("between 2 and 2000 points");
  });
});
