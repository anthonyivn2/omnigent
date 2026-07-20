"""Prompt construction — build Responses API inputs from spec + history."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from typing import Any

from omnigent.entities import (
    ConversationItem,
    FunctionCallData,
    FunctionCallOutputData,
    MessageData,
    NativeToolData,
)
from omnigent.spec import AgentSpec

_VISUALIZATION_TOOL_NAMES = frozenset({"sys_visualize", "mcp__omnigent__sys_visualize"})
_DISPLAY_VALUES = {
    "surface": frozenset({"web", "desktop", "ios", "android"}),
    "layout": frozenset({"compact", "regular", "wide"}),
    "orientation": frozenset({"portrait", "landscape"}),
    "pointer": frozenset({"coarse", "fine"}),
    "color_scheme": frozenset({"light", "dark"}),
}


def visualization_display_instruction(profile: object) -> str | None:
    """Build the ephemeral layout hint appended to this turn's prompt."""
    if not isinstance(profile, dict):
        return None
    for field, allowed in _DISPLAY_VALUES.items():
        if profile.get(field) not in allowed:
            return None
    width = profile.get("viewport_width")
    height = profile.get("viewport_height")
    if (
        isinstance(width, bool)
        or not isinstance(width, int)
        or not 240 <= width <= 4096
        or isinstance(height, bool)
        or not isinstance(height, int)
        or not 240 <= height <= 4096
    ):
        return None
    canvas_width = profile.get("canvas_width")
    canvas_height = profile.get("canvas_height")
    if canvas_width is None:
        canvas_width = min(width, 768)
    if canvas_height is None:
        canvas_height = min(800, max(240, int(height * 0.6)))
    if (
        isinstance(canvas_width, bool)
        or not isinstance(canvas_width, int)
        or not 240 <= canvas_width <= 4096
        or isinstance(canvas_height, bool)
        or not isinstance(canvas_height, int)
        or not 240 <= canvas_height <= 800
    ):
        return None
    return (
        "Current display profile for visualization generation: "
        f"surface={profile['surface']}, viewport={width}x{height} CSS px, "
        f"inline_canvas={canvas_width}x{canvas_height} CSS px, "
        f"layout={profile['layout']}, orientation={profile['orientation']}, "
        f"pointer={profile['pointer']}, color_scheme={profile['color_scheme']}. "
        "When using sys_visualize, compose for the inline canvas rather than the full "
        "viewport and keep the saved HTML/SVG/CSS fluid for replay on other devices. "
        "Runtime render(context) calls receive the exact current canvas as "
        "context.layout.width and context.layout.height."
    )


def _visualization_history_ref(arguments: str, call_id: str) -> str:
    """Replace durable visual source with a compact model-facing reference."""
    try:
        payload = json.loads(arguments)
    except (json.JSONDecodeError, TypeError):
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    ref = {
        "visualization_ref": {
            "call_id": call_id,
            "key": payload.get("key", ""),
            "title": payload.get("title", "Visualization"),
            "summary": payload.get("summary", ""),
            "payload_hash": f"sha256:{hashlib.sha256(arguments.encode()).hexdigest()}",
        }
    }
    return json.dumps(ref, ensure_ascii=False, separators=(",", ":"))


def append_framework_instructions(
    instructions: str | None,
    framework_instructions: Sequence[str],
) -> str | None:
    """Append framework-owned instructions to an existing system prompt.

    Keeps framework policy out of harness adapters while preserving a single
    ordering rule: user-authored agent/request instructions first, framework
    metadata instructions last. If framework instructions grow beyond a small
    ordered string list, introduce a structured ``FrameworkInstructions`` value
    here rather than adding lifecycle policy to ``AgentSpec`` or harness adapters.

    :param instructions: Existing composed system prompt, or ``None``.
    :param framework_instructions: Additive framework instructions.
    :returns: The combined prompt, or ``None`` when every input is empty.
    """
    parts = [instructions] if instructions else []
    parts.extend(
        instruction.strip() for instruction in framework_instructions if instruction.strip()
    )
    return "\n\n".join(parts) if parts else None


def build_instructions(
    spec: AgentSpec,
    per_request_instructions: str | None,
    tool_schemas: list[dict[str, Any]],
    *,
    framework_instructions: Sequence[str] = (),
) -> str:
    """
    Build the system instructions string from the agent's
    instructions, per-request instructions, and skill metadata.
    Passed as the ``instructions`` parameter to
    ``client.responses.create()``.

    :param spec: The parsed AgentSpec containing the agent's
        base instructions and skill definitions.
    :param per_request_instructions: Optional additional
        instructions for this specific request, appended
        after the agent's base instructions.
    :param tool_schemas: OpenAI-format tool schemas (used
        only for future skill-awareness hinting; currently
        not included in the instructions body).
    :param framework_instructions: Framework-owned additive instructions
        for this turn, appended after user-authored agent/request instructions.
    :returns: The assembled instructions string.
    """
    parts: list[str] = []

    if spec.instructions:
        parts.append(spec.instructions)

    if per_request_instructions:
        parts.append(per_request_instructions)

    # Only mention skills in the system prompt when load_skill is
    # available as a tool. Executors that handle skills natively
    # (e.g. Claude SDK with its built-in Skill tool) don't need
    # this hint — the SDK informs the model about skills itself.
    has_load_skill = any(
        schema.get("function", {}).get("name") == "load_skill" for schema in tool_schemas
    )
    if spec.skills and has_load_skill:
        skill_lines = ["Available skills (use the load_skill tool to load one):"]
        for skill in spec.skills:
            skill_lines.append(f"- {skill.name}: {skill.description}")
        parts.append("\n".join(skill_lines))

    base_instructions = "\n\n".join(parts) if parts else "You are a helpful assistant."
    return (
        append_framework_instructions(base_instructions, framework_instructions)
        or base_instructions
    )


def _strip_output_annotations(
    content: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Remove ``annotations`` from ``output_text`` blocks.

    Annotations (e.g. ``file_citation``) are output metadata — they
    tell the client about files the agent produced. They are not
    input content for the LLM on subsequent turns. The text
    description itself survives and provides context.

    :param content: Content block list from a ``MessageData``.
    :returns: A new list with annotations stripped from output blocks.
    """
    result: list[dict[str, Any]] = []
    for block in content:
        if (
            isinstance(block, dict)
            and block.get("type") == "output_text"
            and "annotations" in block
        ):
            stripped = {k: v for k, v in block.items() if k != "annotations"}
            result.append(stripped)
        else:
            result.append(block)
    return result


def history_to_input_items(
    items: list[ConversationItem],
) -> list[dict[str, Any]]:
    """
    Convert persisted ConversationItems into Responses API input items.

    Each item type maps directly to a Responses API input item format:
    ``message`` → role/content pair, ``function_call`` → function call
    item, ``function_call_output`` → function call output item. This
    is simpler than Chat Completions format because function calls are
    kept as separate items rather than embedded in assistant messages.

    :param items: Persisted conversation items in chronological order.
    :returns: A list of Responses API input item dicts suitable for
        ``client.responses.create(input=...)``.
    """
    result: list[dict[str, Any]] = []

    for item in items:
        if item.type == "message":
            assert isinstance(item.data, MessageData)
            # Pass content blocks through, stripping annotations
            # from output_text blocks. Annotations are output
            # metadata (file citations) — not input content for
            # the LLM. The text description survives and gives
            # the LLM context about files it previously produced.
            content = _strip_output_annotations(item.data.content)
            result.append(
                {
                    "role": item.data.role,
                    "content": content,
                }
            )

        elif item.type == "function_call":
            assert isinstance(item.data, FunctionCallData)
            arguments = item.data.arguments
            if item.data.name in _VISUALIZATION_TOOL_NAMES:
                arguments = _visualization_history_ref(arguments, item.data.call_id)
            result.append(
                {
                    "type": "function_call",
                    "call_id": item.data.call_id,
                    "name": item.data.name,
                    "arguments": arguments,
                }
            )

        elif item.type == "function_call_output":
            assert isinstance(item.data, FunctionCallOutputData)
            result.append(
                {
                    "type": "function_call_output",
                    "call_id": item.data.call_id,
                    "output": item.data.output,
                }
            )

        elif item.type == "native_tool":
            assert isinstance(item.data, NativeToolData)
            # Pass the raw provider dict through as-is. The
            # Responses API accepts its own output items
            # (e.g. web_search_call) as input items.
            result.append(item.data.item)

        elif item.type == "reasoning":
            # reasoning items are not included in the LLM prompt
            # (they are output-only)
            pass

        elif item.type == "compaction":
            # compaction items are metadata, not conversation content
            # the LLM should see — they are converted to a synthetic
            # summary message pair by compaction_to_history_items()
            # before being prepended to history.
            pass

    return result
