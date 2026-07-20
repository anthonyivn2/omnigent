import type { VisualizationFlowScene } from "./visualizationSceneProtocol";

export const FLOW_NODE_WIDTH = 200;
export const FLOW_NODE_HEIGHT = 112;
const MAIN_GAP = 80;
const CROSS_GAP = 36;
const WRAP_GAP = 48;

export interface VisualizationFlowPosition {
  id: string;
  position: { x: number; y: number };
}

export interface VisualizationFlowLayout {
  mode: VisualizationFlowScene["direction"] | "wrapped";
  nodes: VisualizationFlowPosition[];
  scale: number;
}

interface LayoutCandidate {
  mode: VisualizationFlowLayout["mode"];
  positions: Map<string, { x: number; y: number }>;
}

/** Choose the most readable layout for the current rendered canvas. */
export function layoutVisualizationFlow(
  scene: VisualizationFlowScene,
  width = scene.width,
  height = scene.height,
): VisualizationFlowLayout {
  const levels = graphLevels(scene);
  const candidates = [
    directionalLayout(levels, "horizontal"),
    directionalLayout(levels, "vertical"),
  ];
  for (let columns = 2; columns < levels.length; columns += 1) {
    candidates.push(wrappedLayout(levels, columns));
  }

  const scored = candidates.map((candidate) => ({
    ...candidate,
    scale: fitScale(candidate.positions, width, height),
  }));
  const best = scored.reduce((current, candidate) => {
    if (candidate.scale > current.scale + 0.01) return candidate;
    if (Math.abs(candidate.scale - current.scale) <= 0.01 && candidate.mode === scene.direction) {
      return candidate;
    }
    return current;
  });

  return {
    mode: best.mode,
    scale: best.scale,
    nodes: scene.nodes.map((node) => ({ id: node.id, position: best.positions.get(node.id)! })),
  };
}

function graphLevels(scene: VisualizationFlowScene): string[][] {
  const outgoing = new Map(scene.nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Map(scene.nodes.map((node) => [node.id, 0]));
  for (const edge of scene.edges) {
    outgoing.get(edge.source)!.push(edge.target);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }

  const levels = new Map<string, number>();
  const queue = scene.nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  for (const id of queue) levels.set(id, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index]!;
    for (const target of outgoing.get(id)!) {
      levels.set(target, Math.max(levels.get(target) ?? 0, levels.get(id)! + 1));
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) queue.push(target);
    }
  }
  for (const node of scene.nodes) {
    if (!levels.has(node.id)) levels.set(node.id, 0);
  }

  const grouped = new Map<number, string[]>();
  for (const node of scene.nodes) {
    const level = levels.get(node.id)!;
    grouped.set(level, [...(grouped.get(level) ?? []), node.id]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left - right).map(([, ids]) => ids);
}

function directionalLayout(
  levels: string[][],
  mode: VisualizationFlowScene["direction"],
): LayoutCandidate {
  const horizontal = mode === "horizontal";
  const crossSize = horizontal ? FLOW_NODE_HEIGHT : FLOW_NODE_WIDTH;
  const maxCross = Math.max(...levels.map((ids) => stackSize(ids.length, crossSize)));
  const positions = new Map<string, { x: number; y: number }>();

  levels.forEach((ids, level) => {
    const start = (maxCross - stackSize(ids.length, crossSize)) / 2;
    ids.forEach((id, index) => {
      const main = level * ((horizontal ? FLOW_NODE_WIDTH : FLOW_NODE_HEIGHT) + MAIN_GAP);
      const cross = start + index * (crossSize + CROSS_GAP);
      positions.set(id, horizontal ? { x: main, y: cross } : { x: cross, y: main });
    });
  });
  return { mode, positions };
}

function wrappedLayout(levels: string[][], columns: number): LayoutCandidate {
  const positions = new Map<string, { x: number; y: number }>();
  let y = 0;

  for (let start = 0, band = 0; start < levels.length; start += columns, band += 1) {
    const bandLevels = levels.slice(start, start + columns);
    const bandHeight = Math.max(
      ...bandLevels.map((ids) => stackSize(ids.length, FLOW_NODE_HEIGHT)),
    );
    bandLevels.forEach((ids, slot) => {
      const column = band % 2 === 0 ? slot : columns - 1 - slot;
      const nodeY = y + (bandHeight - stackSize(ids.length, FLOW_NODE_HEIGHT)) / 2;
      ids.forEach((id, index) => {
        positions.set(id, {
          x: column * (FLOW_NODE_WIDTH + WRAP_GAP),
          y: nodeY + index * (FLOW_NODE_HEIGHT + CROSS_GAP),
        });
      });
    });
    y += bandHeight + WRAP_GAP;
  }

  return { mode: "wrapped", positions };
}

function stackSize(count: number, size: number): number {
  return count * size + Math.max(0, count - 1) * CROSS_GAP;
}

function fitScale(
  positions: Map<string, { x: number; y: number }>,
  width: number,
  height: number,
): number {
  let maxX = FLOW_NODE_WIDTH;
  let maxY = FLOW_NODE_HEIGHT;
  for (const position of positions.values()) {
    maxX = Math.max(maxX, position.x + FLOW_NODE_WIDTH);
    maxY = Math.max(maxY, position.y + FLOW_NODE_HEIGHT);
  }
  return Math.min(1.15, width / maxX, height / maxY);
}
