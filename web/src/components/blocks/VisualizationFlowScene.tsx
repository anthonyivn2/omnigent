import { Fragment, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { VisualizationThemeColors } from "./visualizationDocument";
import {
  FLOW_NODE_HEIGHT,
  FLOW_NODE_WIDTH,
  layoutVisualizationFlow,
} from "./visualizationFlowLayout";
import type { VisualizationAction } from "./visualizationRuntimeProtocol";
import type { VisualizationFlowNode, VisualizationFlowScene } from "./visualizationSceneProtocol";

import "@xyflow/react/dist/style.css";

interface VisualizationFlowSceneProps {
  title: string;
  scene: VisualizationFlowScene;
  colors: VisualizationThemeColors;
  theme: "light" | "dark";
  width: number;
  height: number;
  onAction: (event: VisualizationAction) => void;
  className?: string;
}

interface FlowNodeData extends Record<string, unknown> {
  node: VisualizationFlowNode;
  colors: VisualizationThemeColors;
  onAction: (event: VisualizationAction) => void;
}

type TrustedFlowNode = Node<FlowNodeData, "visualization">;
type FlowSide = "left" | "right" | "top" | "bottom";

const FLOW_HANDLES: Array<{ side: FlowSide; position: Position }> = [
  { side: "left", position: Position.Left },
  { side: "right", position: Position.Right },
  { side: "top", position: Position.Top },
  { side: "bottom", position: Position.Bottom },
];

function FlowNodeCard({ data }: NodeProps<TrustedFlowNode>) {
  const { node, colors, onAction } = data;
  const tone = colors[node.tone ?? "accent"];
  const activate = () => {
    if (!node.action) return;
    onAction({ action: node.action, value: node.value ?? node.id, checked: null });
  };
  const content = (
    <>
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: tone }} />
      <div className="flex items-center gap-2">
        {node.badge && (
          <span
            className="max-w-24 truncate rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{ background: `${tone}22`, color: tone }}
          >
            {node.badge}
          </span>
        )}
        {node.selected && (
          <span
            className="ml-auto text-[11px] font-semibold uppercase tracking-[0.06em]"
            style={{ color: tone }}
          >
            Selected
          </span>
        )}
      </div>
      <div className={node.badge || node.selected ? "mt-2" : "mt-1"}>
        <div className="text-[15px] font-semibold leading-snug" style={{ color: colors.text }}>
          {node.title}
        </div>
        {node.subtitle && (
          <div
            className="mt-1 line-clamp-3 text-[13px] leading-relaxed"
            style={{ color: colors.muted }}
          >
            {node.subtitle}
          </div>
        )}
      </div>
    </>
  );
  const shared = {
    className:
      "nodrag relative block h-[112px] w-full overflow-hidden rounded-2xl border p-4 text-left shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md",
    style: {
      background: colors.surface,
      borderColor: node.selected ? tone : colors.grid,
      boxShadow: node.selected ? `0 0 0 2px ${tone}44` : undefined,
    },
  };

  return (
    <div style={{ width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT }}>
      {FLOW_HANDLES.map(({ side, position }) => (
        <Fragment key={side}>
          <Handle
            id={`target-${side}`}
            type="target"
            position={position}
            className="!size-2 !border-0 !opacity-0"
            style={{ background: tone }}
          />
          <Handle
            id={`source-${side}`}
            type="source"
            position={position}
            className="!size-2 !border-0 !opacity-0"
            style={{ background: tone }}
          />
        </Fragment>
      ))}
      {node.action ? (
        <button
          type="button"
          aria-label={node.ariaLabel ?? node.title}
          aria-pressed={node.selected || undefined}
          onClick={activate}
          {...shared}
        >
          {content}
        </button>
      ) : (
        <div {...shared}>{content}</div>
      )}
    </div>
  );
}

const nodeTypes: NodeTypes = { visualization: FlowNodeCard };
const fitViewOptions = { padding: 0.2, maxZoom: 1.15 } as const;
const DETAILS_PANEL_SPACE = 152;

export default function VisualizationFlowSceneRenderer({
  title,
  scene,
  colors,
  theme,
  width,
  height,
  onAction,
  className,
}: VisualizationFlowSceneProps) {
  const selected = scene.nodes.find((node) => node.selected && node.details);
  const detailsSpace = selected && height >= 400 ? DETAILS_PANEL_SPACE : 0;
  const flowHeight = height - detailsSpace;
  const flowRef = useRef<ReactFlowInstance<TrustedFlowNode, Edge> | null>(null);
  const { nodes, edges } = useMemo(() => {
    const layout = layoutVisualizationFlow(scene, width, flowHeight);
    const positions = new Map(layout.nodes.map((node) => [node.id, node.position]));
    const flowNodes: TrustedFlowNode[] = scene.nodes.map((node) => ({
      id: node.id,
      type: "visualization",
      position: positions.get(node.id)!,
      data: { node, colors, onAction },
      draggable: false,
      selectable: false,
      focusable: false,
    }));
    const flowEdges: Edge[] = scene.edges.map((edge) => {
      const color = colors[edge.tone ?? "accent"];
      const handles = edgeHandles(positions.get(edge.source)!, positions.get(edge.target)!);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: `source-${handles.source}`,
        targetHandle: `target-${handles.target}`,
        type: "smoothstep",
        label: edge.label,
        style: {
          stroke: color,
          strokeWidth: 2,
          strokeDasharray: edge.dashed ? "7 6" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color },
        labelStyle: { fill: colors.muted, fontSize: 12, fontWeight: 600 },
        labelBgStyle: { fill: colors.background, fillOpacity: 0.94 },
        labelBgPadding: [6, 4],
        labelBgBorderRadius: 6,
        selectable: false,
        focusable: false,
      };
    });
    return { nodes: flowNodes, edges: flowEdges };
  }, [colors, flowHeight, onAction, scene, width]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void flowRef.current?.fitView(fitViewOptions);
    });
    return () => cancelAnimationFrame(frame);
  }, [flowHeight, scene.edges, scene.nodes, width]);

  return (
    <div
      role="group"
      aria-label={scene.ariaLabel ?? title}
      className={cn("relative overflow-hidden", className)}
      style={{
        width,
        height,
        background: colors.background,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ width, height: flowHeight }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={fitViewOptions}
          onInit={(instance) => {
            flowRef.current = instance;
          }}
          minZoom={0.05}
          maxZoom={2}
          panOnDrag={scene.panZoom}
          panOnScroll={scene.panZoom}
          zoomOnScroll={scene.panZoom}
          zoomOnPinch={scene.panZoom}
          zoomOnDoubleClick={false}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
          colorMode={theme}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color={colors.grid}
            bgColor={colors.background}
            gap={22}
            size={1.2}
          />
          {scene.panZoom && (
            <Controls
              showInteractive={false}
              position="top-right"
              className="opacity-20 transition-opacity hover:opacity-100 focus-within:opacity-100"
            />
          )}
        </ReactFlow>
      </div>
      {selected && (
        <aside
          className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-2xl border p-4 shadow-lg"
          style={{
            maxWidth: "min(360px, calc(100% - 2rem))",
            background: `${colors.surface}f2`,
            borderColor: colors[selected.tone ?? "accent"],
            color: colors.text,
          }}
          aria-live="polite"
        >
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: colors[selected.tone ?? "accent"] }}
          >
            {selected.badge ?? "Selected stage"}
          </div>
          <div className="mt-1 text-[15px] font-semibold">{selected.title}</div>
          <p
            className="mt-1 line-clamp-3 text-[13px] leading-relaxed"
            style={{ color: colors.muted }}
          >
            {selected.details}
          </p>
        </aside>
      )}
    </div>
  );
}

function edgeHandles(
  source: { x: number; y: number },
  target: { x: number; y: number },
): { source: FlowSide; target: FlowSide } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { source: "right", target: "left" } : { source: "left", target: "right" };
  }
  return dy >= 0 ? { source: "bottom", target: "top" } : { source: "top", target: "bottom" };
}
