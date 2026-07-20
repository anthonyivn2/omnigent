import DOMPurify from "dompurify";
import type { ResolvedThemeMode } from "@/components/theme/themeMode";
import type { VisualizationScene, VisualizationSceneColor } from "./visualizationSceneProtocol";

export interface VisualizationDefinition {
  key: string;
  title: string;
  summary: string;
  html: string;
  css: string;
  javascript: string;
  data: Record<string, unknown>;
  height: number;
}

export interface VisualizationSnapshot {
  html: string;
  css: string;
  scene?: VisualizationScene;
}

export type VisualizationThemeColors = Record<VisualizationSceneColor, string>;

const LIMITS = {
  key: 64,
  title: 200,
  summary: 4_000,
  html: 200_000,
  css: 100_000,
  javascript: 100_000,
} as const;
const ALLOWED_FIELDS = new Set([
  "key",
  "title",
  "summary",
  "html",
  "css",
  "javascript",
  "data",
  "height",
]);
const PLACEMENT_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function parseVisualizationDefinition(
  value: Record<string, unknown>,
): VisualizationDefinition {
  const unknown = Object.keys(value).filter((field) => !ALLOWED_FIELDS.has(field));
  if (unknown.length > 0) throw new Error(`unknown field(s): ${unknown.join(", ")}`);
  const key = value.key === undefined ? "" : requiredString(value, "key", LIMITS.key);
  if (key && !PLACEMENT_KEY.test(key)) throw new Error("key is invalid");
  const title = requiredString(value, "title", LIMITS.title);
  const summary = requiredString(value, "summary", LIMITS.summary);
  const html = requiredString(value, "html", LIMITS.html);
  const css = optionalString(value, "css", LIMITS.css);
  const javascript = optionalString(value, "javascript", LIMITS.javascript);
  const data = value.data === undefined ? {} : value.data;
  if (!isRecord(data)) throw new Error("data must be an object");
  let serializedData: string;
  try {
    serializedData = JSON.stringify(data);
  } catch {
    throw new Error("data must be JSON-serializable");
  }
  if (serializedData.length > 250_000) throw new Error("data is too large");
  const height = value.height === undefined ? 420 : value.height;
  if (!Number.isInteger(height) || (height as number) < 240 || (height as number) > 800) {
    throw new Error("height must be between 240 and 800");
  }
  return { key, title, summary, html, css, javascript, data, height: height as number };
}

export function sanitizeVisualizationHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: false },
    FORBID_TAGS: [
      "a",
      "audio",
      "base",
      "embed",
      "form",
      "frame",
      "iframe",
      "link",
      "meta",
      "object",
      "script",
      "source",
      "style",
      "track",
      "video",
    ],
    FORBID_ATTR: ["action", "formaction", "href", "poster", "src", "srcset", "xlink:href"],
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  document
    .querySelectorAll<HTMLInputElement>('input[type="file"]')
    .forEach((node) => node.remove());
  document.querySelectorAll<HTMLElement>("[style]").forEach((node) => {
    node.setAttribute("style", sanitizeVisualizationCss(node.getAttribute("style") ?? ""));
  });
  return document.body.innerHTML;
}

export function sanitizeVisualizationCss(css: string): string {
  return css
    .replace(/@import\s+[^;]+;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/(?:behavior|-moz-binding)\s*:[^;]+;?/gi, "")
    .replace(/<\/?style/gi, "");
}

export function buildVisualizationDocument(
  snapshot: VisualizationSnapshot,
  theme: ResolvedThemeMode,
  nonce: string,
  title: string,
): string {
  const html = sanitizeVisualizationHtml(snapshot.html);
  const css = sanitizeVisualizationCss(snapshot.css);
  const bridge = `
const nonce=${JSON.stringify(nonce)};
const root=document.getElementById("omnigent-visualization-root");
function fit(){
  if(!root)return;
  root.style.transform="none";
  const style=getComputedStyle(document.body);
  const width=innerWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0);
  const height=innerHeight-(parseFloat(style.paddingTop)||0)-(parseFloat(style.paddingBottom)||0);
  const scale=Math.min(1,width/Math.max(1,root.scrollWidth),height/Math.max(1,root.scrollHeight));
  root.style.transform="scale("+scale+")";
}
requestAnimationFrame(fit);
addEventListener("resize",()=>requestAnimationFrame(fit));
function emit(target){
  const action=target.dataset.action;
  if(!action)return;
  const value=target.dataset.value ?? ("value" in target ? target.value : null);
  const checked="checked" in target ? Boolean(target.checked) : null;
  parent.postMessage({type:"omnigent.visualization.action",nonce,action,value,checked},"*");
}
document.addEventListener("click",event=>{
  const target=event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if(target)emit(target);
});
document.addEventListener("input",event=>{
  const target=event.target instanceof Element ? event.target.closest("[data-action]") : null;
  if(target)emit(target);
});`;
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; media-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<title>${escapeHtml(title)}</title>
<style>${trustedThemeCss(theme)}\n${css}</style>
</head>
<body><div id="omnigent-visualization-root">${html}</div><script nonce="${nonce}">${bridge}</script></body>
</html>`;
}

export function visualizationThemeColors(theme: ResolvedThemeMode): VisualizationThemeColors {
  const dark = theme === "dark";
  return {
    background: dark ? "#151821" : "#fbfaf8",
    surface: dark ? "#20242e" : "#f2f0eb",
    text: dark ? "#f5f6f8" : "#1c2430",
    muted: dark ? "#c0c6d0" : "#4f5b68",
    grid: dark ? "#414755" : "#cfd4dc",
    accent: dark ? "#a993ff" : "#6d5ce8",
    blue: dark ? "#84adff" : "#2864dc",
    cyan: dark ? "#67d7e8" : "#087e9b",
    violet: dark ? "#b69cff" : "#7147d8",
    pink: dark ? "#f3a1c5" : "#c83278",
    orange: dark ? "#f4b86a" : "#b96609",
    lime: dark ? "#afd46f" : "#557c16",
    teal: dark ? "#6bd2be" : "#087968",
    positive: dark ? "#73dfb5" : "#087a55",
    warning: dark ? "#ffc766" : "#9b6500",
    negative: dark ? "#ff9aaa" : "#b4233c",
  };
}

function trustedThemeCss(theme: ResolvedThemeMode): string {
  const colors = visualizationThemeColors(theme);
  return `:root{
color-scheme:${theme};
--viz-bg:${colors.background};
--viz-surface:${colors.surface};
--viz-text:${colors.text};
--viz-muted:${colors.muted};
--viz-grid:${colors.grid};
--viz-accent:${colors.accent};
--viz-blue:${colors.blue};
--viz-cyan:${colors.cyan};
--viz-violet:${colors.violet};
--viz-pink:${colors.pink};
--viz-orange:${colors.orange};
--viz-lime:${colors.lime};
--viz-teal:${colors.teal};
--viz-positive:${colors.positive};
--viz-warning:${colors.warning};
--viz-negative:${colors.negative};
font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--viz-bg);color:var(--viz-text)}
*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden}body{padding:clamp(12px,2vw,24px)}
#omnigent-visualization-root{display:flow-root;transform-origin:top center}
svg{display:block;width:100%;height:auto;max-width:100%}
button,input,select{min-height:44px;font:inherit}button,[data-action]{touch-action:manipulation}
:focus-visible{outline:3px solid var(--viz-accent);outline-offset:2px}
[data-tone="blue"]{--viz-tone:var(--viz-blue)}[data-tone="cyan"]{--viz-tone:var(--viz-cyan)}
[data-tone="violet"]{--viz-tone:var(--viz-violet)}[data-tone="pink"]{--viz-tone:var(--viz-pink)}
[data-tone="orange"]{--viz-tone:var(--viz-orange)}[data-tone="lime"]{--viz-tone:var(--viz-lime)}
[data-tone="teal"]{--viz-tone:var(--viz-teal)}[data-tone="positive"]{--viz-tone:var(--viz-positive)}
[data-tone="warning"]{--viz-tone:var(--viz-warning)}[data-tone="negative"]{--viz-tone:var(--viz-negative)}
.viz-shell{width:min(100%,1120px);margin-inline:auto;display:grid;gap:18px}
.viz-header{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.viz-eyebrow,.viz-kicker{color:var(--viz-muted);font-size:12px;font-weight:700;letter-spacing:.08em;line-height:1.4;text-transform:uppercase}
.viz-title{margin:3px 0 0;font-size:clamp(24px,4vw,36px);font-weight:700;line-height:1.15;letter-spacing:-.015em}
.viz-subtitle,.viz-detail{margin:6px 0 0;color:var(--viz-muted);max-width:68ch;line-height:1.6}
.viz-toolbar,.viz-tabs,.viz-legend{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px}
.viz-card{--viz-tone:var(--viz-accent);position:relative;overflow:hidden;border:1px solid var(--viz-grid);border-radius:16px;background:var(--viz-surface);padding:16px;box-shadow:0 1px 2px color-mix(in srgb,var(--viz-text) 8%,transparent);transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
.viz-card::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:var(--viz-tone);opacity:.8}
button.viz-card{width:100%;color:inherit;text-align:left;cursor:pointer}
.viz-card[data-selected="true"]{border-color:var(--viz-tone);box-shadow:0 0 0 2px color-mix(in srgb,var(--viz-tone) 22%,transparent),0 12px 30px color-mix(in srgb,var(--viz-text) 10%,transparent)}
.viz-chip,.viz-tab,.viz-button{--viz-tone:var(--viz-accent);border:1px solid color-mix(in srgb,var(--viz-tone) 35%,var(--viz-grid));border-radius:999px;background:color-mix(in srgb,var(--viz-tone) 10%,var(--viz-bg));color:var(--viz-text);padding:7px 11px;font-size:13px;font-weight:650;transition:background .16s ease,border-color .16s ease}
.viz-tab,.viz-button{cursor:pointer}.viz-tab[aria-pressed="true"],.viz-button[data-selected="true"]{background:var(--viz-tone);color:var(--viz-bg);border-color:var(--viz-tone)}
.viz-value{margin-top:4px;font-size:clamp(24px,4vw,38px);font-weight:760;line-height:1;letter-spacing:-.035em}
.viz-stat{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:12px}
.viz-swatch{display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--viz-tone,var(--viz-accent))}
@media(hover:hover){button.viz-card:hover{transform:translateY(-2px);border-color:var(--viz-tone);box-shadow:0 10px 26px color-mix(in srgb,var(--viz-text) 10%,transparent)}.viz-tab:hover,.viz-button:hover{border-color:var(--viz-tone)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;
}

function requiredString(
  value: Record<string, unknown>,
  field: keyof typeof LIMITS,
  limit: number,
): string {
  const candidate = value[field];
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (candidate.length > limit) throw new Error(`${field} is too long`);
  return candidate;
}

function optionalString(
  value: Record<string, unknown>,
  field: keyof typeof LIMITS,
  limit: number,
): string {
  const candidate = value[field];
  if (candidate === undefined) return "";
  if (typeof candidate !== "string") throw new Error(`${field} must be a string`);
  if (candidate.length > limit) throw new Error(`${field} is too long`);
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}
