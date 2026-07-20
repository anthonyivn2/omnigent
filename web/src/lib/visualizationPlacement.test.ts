import { describe, expect, it } from "vitest";
import type { AnyBlock, BlockContext } from "./blocks";
import { buildBubbles, type Bubble, type RenderItem } from "./renderItems";
import { placeVisualizationReferences } from "./visualizationPlacement";

function visualization(
  key: string,
  title: string,
  callId: string,
): Extract<RenderItem, { kind: "tool" }> {
  return {
    kind: "tool",
    itemId: `item_${callId}`,
    execution: {
      name: "sys_visualize",
      arguments: {
        key,
        title,
        summary: `${title} summary`,
        html: `<p>${title}</p>`,
      },
      argsSummary: "",
      callId,
      agentName: "test",
      executedBy: "server",
      output: null,
    },
    output: JSON.stringify({ ok: true, visualization_key: key }),
    state: "output-available",
    startedAt: null,
    duration: undefined,
  };
}

function assistant(responseId: string, items: RenderItem[]): Bubble {
  return {
    kind: "assistant",
    responseId,
    stableId: responseId,
    lifecycle: "completed",
    error: null,
    items,
  };
}

function context(responseId: string, itemId: string): BlockContext {
  return {
    agent: "test",
    depth: 0,
    turn: 0,
    timestamp: 0,
    responseId,
    itemId,
  };
}

const user: Bubble = {
  kind: "user",
  itemId: "user_1",
  content: [{ type: "input_text", text: "Compare revenue and architecture" }],
};

describe("visualization placement", () => {
  it("places multiple harness tool calls at different locations in the final explanation", () => {
    const revenue = visualization("quarterly-revenue", "Quarterly revenue", "call_revenue");
    const architecture = visualization("request-flow", "Request flow", "call_flow");
    const bubbles: Bubble[] = [
      user,
      assistant("response_tools_1", [revenue]),
      assistant("response_tools_2", [architecture]),
      assistant("response_final", [
        {
          kind: "text",
          itemId: "answer_1",
          final: true,
          text: [
            "## Quarterly SaaS performance",
            "",
            "[[visualization:quarterly-revenue]]",
            "",
            "Revenue increased throughout the year.",
            "",
            "## Request architecture",
            "",
            "[[visualization:request-flow]]",
            "",
            "The request path explains where that growth is processed.",
          ].join("\n"),
        },
      ]),
    ];

    const placed = placeVisualizationReferences(bubbles);
    const firstTools = placed[1] as Extract<Bubble, { kind: "assistant" }>;
    const secondTools = placed[2] as Extract<Bubble, { kind: "assistant" }>;
    const final = placed[3] as Extract<Bubble, { kind: "assistant" }>;

    expect(firstTools.items).toEqual([]);
    expect(secondTools.items).toEqual([]);
    expect(final.items.map((item) => item.kind)).toEqual(["text", "tool", "text", "tool", "text"]);
    expect(
      final.items.map((item) =>
        item.kind === "text"
          ? item.text
          : item.kind === "tool"
            ? item.execution.arguments.key
            : item.kind,
      ),
    ).toEqual([
      "## Quarterly SaaS performance",
      "quarterly-revenue",
      "Revenue increased throughout the year.\n\n## Request architecture",
      "request-flow",
      "The request path explains where that growth is processed.",
    ]);
  });

  it("places cards from a normalized multi-response harness transcript", () => {
    const revenue = visualization("quarterly-revenue", "Quarterly revenue", "call_revenue");
    const architecture = visualization("request-flow", "Request flow", "call_flow");
    const blocks: AnyBlock[] = [
      {
        type: "user_message",
        ctx: context("response_user", "user_1"),
        content: [{ type: "input_text", text: "Explain revenue and architecture" }],
      },
      {
        type: "tool_group",
        ctx: context("response_tools_1", "item_call_revenue"),
        executions: [revenue.execution],
        iteration: 0,
      },
      {
        type: "tool_result",
        ctx: context("response_tools_1", "output_call_revenue"),
        name: "sys_visualize",
        callId: "call_revenue",
        agentName: "test",
        output: revenue.output!,
      },
      {
        type: "tool_group",
        ctx: context("response_tools_2", "item_call_flow"),
        executions: [architecture.execution],
        iteration: 0,
      },
      {
        type: "tool_result",
        ctx: context("response_tools_2", "output_call_flow"),
        name: "sys_visualize",
        callId: "call_flow",
        agentName: "test",
        output: architecture.output!,
      },
      {
        type: "text_done",
        ctx: context("response_final", "answer_1"),
        fullText:
          "Business view.\n\n[[visualization:quarterly-revenue]]\n\nSystem view.\n\n[[visualization:request-flow]]\n\nConclusion.",
        hasCodeBlocks: false,
      },
    ];

    const placed = placeVisualizationReferences(buildBubbles(blocks, null));
    const final = [...placed]
      .reverse()
      .find(
        (bubble): bubble is Extract<Bubble, { kind: "assistant" }> =>
          bubble.kind === "assistant" && bubble.items.some((item) => item.kind === "text"),
      )!;

    expect(final.items.map((item) => item.kind)).toEqual(["text", "tool", "text", "tool", "text"]);
  });

  it("appends unreferenced visualizations after the final text", () => {
    const revenue = visualization("quarterly-revenue", "Quarterly revenue", "call_revenue");
    const architecture = visualization("request-flow", "Request flow", "call_flow");
    const bubbles: Bubble[] = [
      user,
      assistant("response_tools", [revenue, architecture]),
      assistant("response_final", [
        { kind: "text", itemId: "answer_1", final: true, text: "Here are both views." },
      ]),
    ];

    const placed = placeVisualizationReferences(bubbles);
    const final = placed[2] as Extract<Bubble, { kind: "assistant" }>;

    expect(final.items).toEqual([expect.objectContaining({ kind: "text" }), revenue, architecture]);
  });

  it("does not resolve a marker from an earlier user turn", () => {
    const revenue = visualization("quarterly-revenue", "Quarterly revenue", "call_revenue");
    const bubbles: Bubble[] = [
      user,
      assistant("response_tools", [revenue]),
      {
        kind: "user",
        itemId: "user_2",
        content: [{ type: "input_text", text: "Show that again" }],
      },
      assistant("response_final", [
        {
          kind: "text",
          itemId: "answer_2",
          final: true,
          text: "[[visualization:quarterly-revenue]]",
        },
      ]),
    ];

    const placed = placeVisualizationReferences(bubbles);
    const firstTurn = placed[1] as Extract<Bubble, { kind: "assistant" }>;
    const secondTurn = placed[3] as Extract<Bubble, { kind: "assistant" }>;

    expect(firstTurn.items).toEqual([revenue]);
    expect(secondTurn.items).toEqual([
      expect.objectContaining({ kind: "text", text: "[[visualization:quarterly-revenue]]" }),
    ]);
  });

  it("preserves the bubble array when no visualizations exist", () => {
    const bubbles: Bubble[] = [
      user,
      assistant("response_final", [
        { kind: "text", itemId: "answer_1", final: true, text: "Plain response" },
      ]),
    ];

    expect(placeVisualizationReferences(bubbles)).toBe(bubbles);
  });
});
