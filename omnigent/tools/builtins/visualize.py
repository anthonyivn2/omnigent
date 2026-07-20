"""Framework-owned inline visualization tool."""

from __future__ import annotations

import json
import re
from typing import Any

from omnigent.tools.base import Tool, ToolContext

_KEY_MAX = 64
_KEY_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
_TITLE_MAX = 200
_SUMMARY_MAX = 4_000
_HTML_MAX = 200_000
_CSS_MAX = 100_000
_JAVASCRIPT_MAX = 100_000
_DATA_MAX = 250_000
_HEIGHT_MIN = 240
_HEIGHT_MAX = 800
_ALLOWED_FIELDS = frozenset(
    {"key", "title", "summary", "html", "css", "javascript", "data", "height"}
)
_THEME_TOKENS = (
    "--viz-bg, --viz-surface, --viz-text, --viz-muted, --viz-grid, --viz-accent, "
    "--viz-blue, --viz-cyan, --viz-violet, --viz-pink, --viz-orange, --viz-lime, "
    "--viz-teal, --viz-positive, --viz-warning, and --viz-negative"
)
_DESIGN_SYSTEM_DESCRIPTION = (
    "Prefer the built-in HTML classes viz-shell, viz-header, viz-eyebrow, viz-title, "
    "viz-subtitle, viz-toolbar, viz-tabs, viz-tab, viz-grid, viz-card, viz-kicker, "
    "viz-value, viz-stat, viz-detail, viz-chip, viz-button, viz-legend, and viz-swatch. "
    "Set data-tone to blue, cyan, violet, pink, orange, lime, teal, positive, warning, "
    "or negative for coordinated accents, and data-selected='true' for selection."
)
_SCENE_DESCRIPTION = (
    "For architectures and processes, prefer an auto-laid-out scene: {renderer: 'flow', "
    "width, height, ariaLabel?, panZoom?, direction?: 'horizontal'|'vertical', nodes, edges}. "
    "Node forms: {id,title,subtitle?,details?,badge?,tone?,selected?,action?,value?}; edge forms: "
    "{id,source,target,label?,tone?,dashed?}. The trusted React Flow renderer handles cards, "
    "connectors, responsive wrapping, pan, zoom, and fitting to the current canvas; provide "
    "semantic nodes and edges rather than layout coordinates. For coordinate drawings only, "
    "use scene: {renderer: 'react'|'canvas', width, height, ariaLabel?, panZoom?, elements}. "
    "'react' uses trusted React/SVG. Element forms: "
    "rect {type,id,x,y,width,height,radius?,label?,fill?,stroke?,strokeWidth?,action?,value?}; "
    "circle {type,id,x,y,radius,label?,fill?,stroke?,action?,value?}; text "
    "{type,id,x,y,text,color?,fontSize?,fontWeight?,maxWidth?,align?,action?,value?}; path "
    "{type,id,points:[{x,y},...],stroke?,strokeWidth?,dashed?,arrowEnd?,label?,action?,value?}. "
    "Colors are semantic names: background, surface, text, muted, grid, accent, positive, "
    "warning, or negative. Shape labels render inside their shape and wrap automatically; "
    "do not duplicate them with text elements. Use text.maxWidth or newline characters for "
    "standalone callouts, and keep path labels clear of nodes. The trusted renderer provides "
    "pan, zoom, keyboard access, Canvas drawing, and action dispatch. Never use coordinate "
    "React/Canvas scenes for text-heavy diagrams. Scene width and height are virtual "
    "coordinates independent of the top-level card height."
)
_DESCRIPTION = (
    "Render a polished responsive inline visualization in Omnigent. Default to composed "
    "semantic HTML/CSS with generous spacing, a clear type hierarchy, restrained color, and "
    "one focal interaction rather than a dense engineering canvas. "
    f"{_DESIGN_SYSTEM_DESCRIPTION} Always provide an accessible summary and semantic "
    "HTML/SVG fallback. Optional synchronous JavaScript defines "
    "render({ data, state, event, layout }) and runs without DOM, network, storage, "
    "filesystem, imports, or async APIs. layout.width and layout.height are the exact current "
    "visualization canvas dimensions; use them for responsive composition instead of assuming "
    "the full browser viewport. It may return trusted declarative React Flow, SVG, "
    "or Canvas scenes. Use Flow for node-link diagrams and Canvas only for dense marks or "
    "continuous drawing, never for text-heavy layouts. Use responsive SVG/CSS, "
    "touch-sized controls, body text of at least 15 CSS px, supporting labels of at least "
    "12 CSS px, honest axes, "
    "and no color-only meaning. The only theme tokens are "
    f"{_THEME_TOKENS}; do not invent token names or add hard-coded fallback colors. "
    "Keep text and background contrast readable in both light and dark themes. Use a unique "
    "key for each visualization in the current user turn. After every successful call, place "
    "the returned [[visualization:<key>]] marker on its own line exactly once in the final "
    "response. Unless the user requests another location, put it immediately after the heading "
    "or short lead-in that introduces the visual and before detailed interpretation. Never "
    "repeat the HTML, CSS, JavaScript, or data in text."
)


class SysVisualizeTool(Tool):
    """Validate and acknowledge a transcript-native visualization definition."""

    @classmethod
    def name(cls) -> str:
        return "sys_visualize"

    @classmethod
    def description(cls) -> str:
        return _DESCRIPTION

    def get_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name(),
                "description": self.description(),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "key": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": _KEY_MAX,
                            "pattern": _KEY_PATTERN,
                            "description": (
                                "Unique placement key for this user turn, such as "
                                "quarterly-revenue. The tool returns the exact marker to place "
                                "on its own line in the final response."
                            ),
                        },
                        "title": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": _TITLE_MAX,
                            "description": "Short title shown above the visualization.",
                        },
                        "summary": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": _SUMMARY_MAX,
                            "description": (
                                "Accessible plain-text takeaway that remains meaningful "
                                "without the graphic."
                            ),
                        },
                        "html": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": _HTML_MAX,
                            "description": (
                                "Semantic fallback HTML fragment. "
                                f"{_DESIGN_SYSTEM_DESCRIPTION} Use inline SVG; do not include "
                                "scripts, forms, frames, links, or remote media."
                            ),
                        },
                        "css": {
                            "type": "string",
                            "maxLength": _CSS_MAX,
                            "description": (
                                f"Optional responsive CSS using only {_THEME_TOKENS}. Do not "
                                "invent token names or add hard-coded fallback colors; keep "
                                "contrast readable in light and dark themes. External imports "
                                "and resource URLs are blocked."
                            ),
                        },
                        "javascript": {
                            "type": "string",
                            "maxLength": _JAVASCRIPT_MAX,
                            "description": (
                                "Optional synchronous render({ data, state, event, layout }) "
                                "function returning { html?, css?, state?, scene? }. When html "
                                "is omitted, the required top-level html remains the fallback. "
                                f"{_SCENE_DESCRIPTION}"
                            ),
                        },
                        "data": {
                            "type": "object",
                            "description": (
                                "Optional JSON-serializable inline data. Aggregate large "
                                "datasets first; serialized data is limited to 250000 characters."
                            ),
                            "additionalProperties": True,
                        },
                        "height": {
                            "type": "integer",
                            "minimum": _HEIGHT_MIN,
                            "maximum": _HEIGHT_MAX,
                            "default": 420,
                            "description": (
                                "Preferred card height from 240 to 800 CSS px, not scene.height. "
                                "Keep it within the inline canvas height from the current display "
                                "profile. Never copy the scene's virtual coordinate height here. "
                                "The renderer clamps it to the current surface; width is "
                                "responsive."
                            ),
                        },
                    },
                    "required": ["key", "title", "summary", "html"],
                    "additionalProperties": False,
                },
            },
        }

    def invoke(self, arguments: str, ctx: ToolContext) -> str:
        del ctx
        payload = _parse_arguments(arguments)
        return json.dumps(
            {
                "ok": True,
                "visualization_key": payload["key"],
                "title": payload["title"],
                "placement": f"[[visualization:{payload['key']}]]",
                "message": "Place the marker after its heading or short lead-in.",
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )


def _parse_arguments(arguments: str) -> dict[str, Any]:
    try:
        payload = json.loads(arguments)
    except json.JSONDecodeError as exc:
        raise ValueError(f"arguments must be valid JSON: {exc.msg}") from exc
    if not isinstance(payload, dict):
        raise ValueError("arguments must be a JSON object")

    unknown = sorted(set(payload) - _ALLOWED_FIELDS)
    if unknown:
        raise ValueError(f"unknown field(s): {', '.join(unknown)}")

    _required_string(payload, "key", _KEY_MAX)
    if re.fullmatch(_KEY_PATTERN, payload["key"]) is None:
        raise ValueError(
            "key must start with a letter or digit and contain only A-Z, a-z, 0-9, _ or -"
        )
    _required_string(payload, "title", _TITLE_MAX)
    _required_string(payload, "summary", _SUMMARY_MAX)
    _required_string(payload, "html", _HTML_MAX)
    _optional_string(payload, "css", _CSS_MAX)
    _optional_string(payload, "javascript", _JAVASCRIPT_MAX)

    if "data" in payload:
        data = payload["data"]
        if not isinstance(data, dict):
            raise ValueError("data must be an object")
        try:
            serialized = json.dumps(
                data,
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            raise ValueError("data must be JSON-serializable") from exc
        if len(serialized) > _DATA_MAX:
            raise ValueError(f"data must be at most {_DATA_MAX} serialized characters")

    if "height" in payload:
        height = payload["height"]
        if isinstance(height, bool) or not isinstance(height, int):
            raise ValueError("height must be an integer")
        if not _HEIGHT_MIN <= height <= _HEIGHT_MAX:
            raise ValueError(f"height must be between {_HEIGHT_MIN} and {_HEIGHT_MAX}")

    return payload


def _required_string(payload: dict[str, Any], field: str, limit: int) -> None:
    if field not in payload:
        raise ValueError(f"{field} is required")
    value = payload[field]
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty string")
    if len(value) > limit:
        raise ValueError(f"{field} must be at most {limit} characters")


def _optional_string(payload: dict[str, Any], field: str, limit: int) -> None:
    if field not in payload:
        return
    value = payload[field]
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    if len(value) > limit:
        raise ValueError(f"{field} must be at most {limit} characters")
