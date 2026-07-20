import { Maximize2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeResolvedTheme } from "@/components/theme/themeMode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ToolState } from "@/lib/renderItems";
import { cn } from "@/lib/utils";
import { VisualizationSceneRenderer } from "./VisualizationScene";
import {
  buildVisualizationDocument,
  parseVisualizationDefinition,
  type VisualizationDefinition,
  type VisualizationSnapshot,
} from "./visualizationDocument";
import type {
  VisualizationAction,
  VisualizationLayout,
  VisualizationWorkerRequest,
  VisualizationWorkerResponse,
} from "./visualizationRuntimeProtocol";

export const VISUALIZATION_FRAME_SANDBOX = "allow-scripts";

interface VisualizationCardProps {
  arguments: Record<string, unknown>;
  output: string | null;
  state: ToolState;
}

export function VisualizationCard({ arguments: args, output, state }: VisualizationCardProps) {
  const parsed = useMemo(() => parseDefinition(args), [args]);
  if (parsed.definition === null) {
    return <VisualizationFallback title="Visualization" summary="" error={parsed.error} />;
  }
  return <ReadyVisualizationCard definition={parsed.definition} output={output} state={state} />;
}

function ReadyVisualizationCard({
  definition,
  output,
  state,
}: {
  definition: VisualizationDefinition;
  output: string | null;
  state: ToolState;
}) {
  const { resolvedTheme } = useTheme();
  const colorScheme = normalizeResolvedTheme(resolvedTheme);
  const containerRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const appliedRequestIdRef = useRef(0);
  const [width, setWidth] = useState(720);
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<VisualizationSnapshot>({
    html: definition.html,
    css: definition.css,
  });
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const height = clampHeight(definition.height);
  const layoutWidth = expanded ? Math.max(1, Math.min(window.innerWidth - 32, 1152)) : width;
  const layout = useMemo<VisualizationLayout>(
    () => ({
      width: layoutWidth,
      height,
      mode: layoutWidth <= 640 ? "compact" : layoutWidth <= 1024 ? "regular" : "wide",
      pointer: window.matchMedia?.("(pointer: coarse)").matches ? "coarse" : "fine",
      colorScheme,
    }),
    [colorScheme, height, layoutWidth],
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(1, Math.round(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSnapshot({ html: definition.html, css: definition.css });
    setRuntimeError(null);
    if (!definition.javascript) return;

    let worker: Worker;
    try {
      // ponytail: one worker per mounted card gives deterministic teardown; pool only if
      // many simultaneous visuals make repeated QuickJS startup measurable.
      worker = new Worker(new URL("./visualizationRuntime.worker.ts", import.meta.url), {
        type: "module",
        name: "omnigent-visualization",
      });
    } catch {
      setRuntimeError("The visualization runtime could not start.");
      return;
    }
    workerRef.current = worker;
    worker.onmessage = (message: MessageEvent<VisualizationWorkerResponse>) => {
      const response = message.data;
      if (response.requestId < appliedRequestIdRef.current) return;
      appliedRequestIdRef.current = response.requestId;
      if (response.type === "error") {
        setRuntimeError(response.message);
        return;
      }
      setRuntimeError(null);
      setSnapshot((current) => ({
        html: response.snapshot.html,
        css: response.snapshot.css ?? current.css,
        ...(response.snapshot.scene ? { scene: response.snapshot.scene } : {}),
      }));
    };
    worker.onerror = () => setRuntimeError("The visualization runtime could not start.");
    postWorker(worker, {
      type: "init",
      requestId: ++requestIdRef.current,
      javascript: definition.javascript,
      data: definition.data,
      fallbackHtml: definition.html,
      layout: layoutRef.current,
    });
    return () => {
      workerRef.current = null;
      worker.terminate();
    };
  }, [definition]);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !definition.javascript) return;
    postWorker(worker, {
      type: "render",
      requestId: ++requestIdRef.current,
      event: null,
      layout,
    });
  }, [definition.javascript, layout]);

  const onAction = (event: VisualizationAction) => {
    const worker = workerRef.current;
    if (!worker) return;
    postWorker(worker, {
      type: "render",
      requestId: ++requestIdRef.current,
      event,
      layout,
    });
  };
  const error = runtimeError ?? toolOutputError(output, state);

  return (
    <section
      ref={containerRef}
      className="not-prose w-full overflow-hidden rounded-xl bg-card text-card-foreground"
      aria-label={definition.title}
    >
      <header className="flex items-center gap-2 px-3 py-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{definition.title}</h3>
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {error ? "Fallback" : state === "input-available" ? "Validating" : "Ready"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Expand visualization"
          onClick={() => setExpanded(true)}
        >
          <Maximize2Icon />
        </Button>
      </header>
      {error && (
        <div role="alert" className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <VisualizationFrame
        title={definition.title}
        snapshot={snapshot}
        theme={colorScheme}
        width={layoutWidth}
        height={height}
        onAction={onAction}
      />
      <p className="px-3 py-2 text-sm text-muted-foreground">{definition.summary}</p>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="w-[calc(100%-1rem)] max-w-6xl gap-3 p-3 sm:max-w-6xl">
          <DialogHeader className="pr-8">
            <DialogTitle>{definition.title}</DialogTitle>
            <DialogDescription>{definition.summary}</DialogDescription>
          </DialogHeader>
          <VisualizationFrame
            title={definition.title}
            snapshot={snapshot}
            theme={colorScheme}
            width={layoutWidth}
            height={Math.min(800, Math.max(height, viewportHeight() - 180))}
            onAction={onAction}
            className="max-h-[75dvh]"
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function VisualizationFrame({
  title,
  snapshot,
  theme,
  width,
  height,
  onAction,
  className,
}: {
  title: string;
  snapshot: VisualizationSnapshot;
  theme: "light" | "dark";
  width: number;
  height: number;
  onAction: (event: VisualizationAction) => void;
  className?: string;
}) {
  if (snapshot.scene) {
    return (
      <VisualizationSceneRenderer
        title={title}
        scene={snapshot.scene}
        theme={theme}
        width={width}
        height={height}
        onAction={onAction}
        className={className}
      />
    );
  }
  return (
    <SandboxedVisualizationFrame
      title={title}
      snapshot={snapshot}
      theme={theme}
      height={height}
      onAction={onAction}
      className={className}
    />
  );
}

function SandboxedVisualizationFrame({
  title,
  snapshot,
  theme,
  height,
  onAction,
  className,
}: Omit<Parameters<typeof VisualizationFrame>[0], "width">) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const nonce = useMemo(frameNonce, []);
  const srcDoc = useMemo(
    () => buildVisualizationDocument(snapshot, theme, nonce, title),
    [nonce, snapshot, theme, title],
  );

  useEffect(() => {
    const receive = (message: MessageEvent<unknown>) => {
      if (message.source !== iframeRef.current?.contentWindow || !isActionMessage(message.data)) {
        return;
      }
      if (message.data.nonce !== nonce) return;
      onAction({
        action: message.data.action,
        value: message.data.value,
        checked: message.data.checked,
      });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [nonce, onAction]);

  return (
    <iframe
      ref={iframeRef}
      title={title}
      sandbox={VISUALIZATION_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
      className={cn("block w-full border-0 bg-background", className)}
      style={{ height }}
    />
  );
}

function VisualizationFallback({
  title,
  summary,
  error,
}: {
  title: string;
  summary: string;
  error: string;
}) {
  return (
    <section className="not-prose w-full rounded-xl border bg-card p-3 text-card-foreground">
      <h3 className="text-sm font-medium">{title}</h3>
      <p role="alert" className="mt-2 text-xs text-destructive">
        {error}
      </p>
      {summary && <p className="mt-2 text-sm text-muted-foreground">{summary}</p>}
    </section>
  );
}

function parseDefinition(args: Record<string, unknown>): {
  definition: VisualizationDefinition | null;
  error: string;
} {
  try {
    return { definition: parseVisualizationDefinition(args), error: "" };
  } catch (error) {
    return {
      definition: null,
      error: error instanceof Error ? error.message : "Invalid visualization definition.",
    };
  }
}

function postWorker(worker: Worker, message: VisualizationWorkerRequest): void {
  worker.postMessage(message);
}

function toolOutputError(output: string | null, state: ToolState): string | null {
  if (state === "output-error") return "Visualization validation failed.";
  if (!output) return null;
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    if (output.startsWith("Error:")) return output;
  }
  return null;
}

function frameNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clampHeight(preferred: number): number {
  return Math.min(preferred, Math.max(240, Math.floor(viewportHeight() * 0.6)));
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

function isActionMessage(value: unknown): value is {
  type: "omnigent.visualization.action";
  nonce: string;
  action: string;
  value: string | null;
  checked: boolean | null;
} {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "omnigent.visualization.action" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.action === "string" &&
    candidate.action.length <= 100 &&
    (candidate.value === null ||
      (typeof candidate.value === "string" && candidate.value.length <= 4_000)) &&
    (candidate.checked === null || typeof candidate.checked === "boolean")
  );
}
