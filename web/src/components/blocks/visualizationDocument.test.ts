import { describe, expect, it } from "vitest";
import {
  buildVisualizationDocument,
  parseVisualizationDefinition,
  sanitizeVisualizationCss,
  sanitizeVisualizationHtml,
} from "./visualizationDocument";

describe("visualization document", () => {
  it("parses the persisted tool arguments", () => {
    expect(
      parseVisualizationDefinition({
        key: "quarterly-revenue",
        title: "Revenue",
        summary: "Revenue rose.",
        html: "<svg></svg>",
      }),
    ).toMatchObject({
      key: "quarterly-revenue",
      title: "Revenue",
      data: {},
      css: "",
      javascript: "",
      height: 420,
    });
    expect(() =>
      parseVisualizationDefinition({
        key: "quarterly-revenue",
        title: "Revenue",
        summary: "Revenue rose.",
        html: "<svg></svg>",
        extra: true,
      }),
    ).toThrow("unknown field(s): extra");
    expect(() =>
      parseVisualizationDefinition({
        key: "not valid",
        title: "Revenue",
        summary: "Revenue rose.",
        html: "<svg></svg>",
      }),
    ).toThrow("key is invalid");
  });

  it("removes executable and navigational markup", () => {
    const html = sanitizeVisualizationHtml(`
      <script>alert(1)</script>
      <a href="https://example.com">leave</a>
      <button data-action="filter" onclick="alert(1)">Filter</button>
      <input type="file">
      <svg><circle onload="alert(1)" /></svg>
    `);

    expect(html).not.toMatch(/script|href|onclick|type="file"|onload/i);
    expect(html).toContain('data-action="filter"');
    expect(html).toContain("<svg>");
  });

  it("blocks CSS resource loading and builds a nonce-bound frame", () => {
    const css = sanitizeVisualizationCss(
      '@import "https://example.com/x.css"; .x{background:url(https://example.com/x)}',
    );
    const document = buildVisualizationDocument(
      { html: "<p>Safe</p>", css },
      "dark",
      "nonce-1",
      "Title",
    );

    expect(css).not.toMatch(/@import|url\s*\(/i);
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("script-src 'nonce-nonce-1'");
    expect(document).toContain('data-theme="dark"');
    expect(document).toContain("--viz-cyan:");
    expect(document).toContain(".viz-card");
    expect(document).toContain('[data-tone="violet"]');
    expect(document).toContain('id="omnigent-visualization-root"');
    expect(document).toContain('root.style.transform="scale("+scale+")"');
    expect(document).toContain('nonce="nonce-1"');
  });
});
