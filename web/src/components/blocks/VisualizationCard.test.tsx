import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { VisualizationCard, VISUALIZATION_FRAME_SANDBOX } from "./VisualizationCard";

afterEach(cleanup);

describe("VisualizationCard", () => {
  it("renders the sanitized fallback and accessible summary", () => {
    render(
      <VisualizationCard
        arguments={{
          key: "quarterly-revenue",
          title: "Quarterly revenue",
          summary: "Revenue rose each quarter.",
          html: "<figure><svg aria-label='Revenue chart'></svg><script>alert(1)</script></figure>",
          css: "svg{width:100%}",
          height: 360,
        }}
        output='{"ok":true}'
        state="output-available"
      />,
    );

    const heading = screen.getByText("Quarterly revenue");
    const summary = screen.getByText("Revenue rose each quarter.");
    expect(heading.closest("section")).not.toHaveClass("border");
    expect(heading.closest("header")).not.toHaveClass("border-b");
    expect(summary).not.toHaveClass("border-t");
    const frame = screen.getByTitle("Quarterly revenue");
    expect(frame).toHaveAttribute("sandbox", VISUALIZATION_FRAME_SANDBOX);
    expect(frame.getAttribute("srcdoc")).not.toContain("alert(1)");
  });

  it("keeps an invalid definition visible as a trusted error", () => {
    render(
      <VisualizationCard
        arguments={{ title: "Missing fallback" }}
        output={null}
        state="output-error"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("summary must be a non-empty string");
  });
});
