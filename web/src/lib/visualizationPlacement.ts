import type { Bubble, RenderItem } from "./renderItems";

export const VISUALIZATION_TOOL_NAMES = new Set(["sys_visualize", "mcp__omnigent__sys_visualize"]);

const PLACEMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PLACEMENT_MARKER = /^[\t ]*\[\[visualization:([A-Za-z0-9][A-Za-z0-9_-]{0,63})\]\][\t ]*$/gm;

type AssistantBubble = Extract<Bubble, { kind: "assistant" }>;
type VisualizationItem = Extract<RenderItem, { kind: "tool" }>;

/** Place visualization tool cards at markers within each user turn. */
export function placeVisualizationReferences(bubbles: Bubble[]): Bubble[] {
  let result = bubbles;
  let turnStart = 0;

  for (let index = 0; index <= bubbles.length; index += 1) {
    if (index < bubbles.length && bubbles[index]!.kind !== "user") continue;
    result = placeTurnVisualizations(result, turnStart, index);
    turnStart = index + 1;
  }

  return result;
}

function placeTurnVisualizations(bubbles: Bubble[], start: number, end: number): Bubble[] {
  const visualizations: VisualizationItem[] = [];
  const byKey = new Map<string, VisualizationItem[]>();

  for (let index = start; index < end; index += 1) {
    const bubble = bubbles[index];
    if (bubble?.kind !== "assistant") continue;
    for (const item of bubble.items) {
      if (!isVisualization(item)) continue;
      visualizations.push(item);
      const key = visualizationKey(item);
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), item]);
    }
  }
  if (visualizations.length === 0) return bubbles;

  const placed = new Set<VisualizationItem>();
  const result = [...bubbles];
  let lastAssistantIndex = -1;

  const takeVisualization = (key: string): VisualizationItem | null | undefined => {
    const queue = byKey.get(key);
    if (!queue) return undefined;
    const visualization = queue.shift() ?? null;
    if (visualization) placed.add(visualization);
    return visualization;
  };

  for (let index = start; index < end; index += 1) {
    const bubble = result[index];
    if (bubble?.kind !== "assistant") continue;
    lastAssistantIndex = index;
    const items: RenderItem[] = [];
    let changed = false;

    for (const item of bubble.items) {
      if (isVisualization(item)) {
        changed = true;
        continue;
      }
      if (item.kind !== "text") {
        items.push(item);
        continue;
      }
      const segments = splitVisualizationMarkers(item, takeVisualization);
      changed ||= segments.length !== 1 || segments[0] !== item;
      items.push(...segments);
    }

    if (changed) result[index] = { ...bubble, items } satisfies AssistantBubble;
  }

  const unplaced = visualizations.filter((item) => !placed.has(item));
  if (unplaced.length > 0 && lastAssistantIndex >= 0) {
    const target = result[lastAssistantIndex] as AssistantBubble;
    result[lastAssistantIndex] = { ...target, items: [...target.items, ...unplaced] };
  }
  return result;
}

function splitVisualizationMarkers(
  item: Extract<RenderItem, { kind: "text" }>,
  takeVisualization: (key: string) => VisualizationItem | null | undefined,
): RenderItem[] {
  const items: RenderItem[] = [];
  let cursor = 0;
  let segment = 0;
  let changed = false;
  PLACEMENT_MARKER.lastIndex = 0;

  for (const match of item.text.matchAll(PLACEMENT_MARKER)) {
    const key = match[1]!;
    const visualization = takeVisualization(key);
    if (visualization === undefined) continue;
    appendTextSegment(items, item, item.text.slice(cursor, match.index), segment++);
    if (visualization) items.push(visualization);
    cursor = match.index! + match[0].length;
    changed = true;
  }
  if (!changed) return [item];

  appendTextSegment(items, item, item.text.slice(cursor), segment);
  return items;
}

function appendTextSegment(
  items: RenderItem[],
  source: Extract<RenderItem, { kind: "text" }>,
  value: string,
  segment: number,
): void {
  const text = value.trim();
  if (!text) return;
  items.push({
    ...source,
    itemId: source.itemId ? `${source.itemId}:visualization:${segment}` : null,
    text,
  });
}

function isVisualization(item: RenderItem): item is VisualizationItem {
  return item.kind === "tool" && VISUALIZATION_TOOL_NAMES.has(item.execution.name);
}

function visualizationKey(item: VisualizationItem): string | null {
  const key = item.execution.arguments.key;
  return typeof key === "string" && PLACEMENT_KEY.test(key) ? key : null;
}
