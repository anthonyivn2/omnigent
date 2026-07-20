"""Tests for canonical system-instruction composition."""

import json
from types import SimpleNamespace
from typing import cast

from omnigent.entities import ConversationItem, FunctionCallData
from omnigent.runtime.prompt import (
    append_framework_instructions,
    build_instructions,
    history_to_input_items,
    visualization_display_instruction,
)
from omnigent.spec import AgentSpec


def test_framework_instructions_append_after_custom_prompts() -> None:
    spec = cast(AgentSpec, SimpleNamespace(instructions="Agent prompt", skills=[]))

    result = build_instructions(
        spec,
        "Request prompt",
        [],
        framework_instructions=("  Framework prompt  ",),
    )

    assert result == "Agent prompt\n\nRequest prompt\n\nFramework prompt"


def test_empty_framework_instructions_do_not_change_default() -> None:
    spec = cast(AgentSpec, SimpleNamespace(instructions=None, skills=[]))

    assert build_instructions(spec, None, [], framework_instructions=("", "   ")) == (
        "You are a helpful assistant."
    )


def test_framework_only_instructions_use_shared_composer() -> None:
    assert append_framework_instructions(None, ("Rename session",)) == "Rename session"


def test_display_profile_becomes_ephemeral_framework_instruction() -> None:
    instruction = visualization_display_instruction(
        {
            "surface": "ios",
            "viewport_width": 384,
            "viewport_height": 848,
            "canvas_width": 352,
            "canvas_height": 512,
            "layout": "compact",
            "orientation": "portrait",
            "pointer": "coarse",
            "color_scheme": "dark",
        }
    )

    assert instruction is not None
    assert "surface=ios" in instruction
    assert "viewport=384x848" in instruction
    assert "inline_canvas=352x512" in instruction
    assert "context.layout.width" in instruction
    assert "device_model" not in instruction
    assert visualization_display_instruction({"surface": "watch"}) is None


def test_visualization_history_keeps_reference_not_source() -> None:
    source = {
        "key": "quarterly-revenue",
        "title": "Revenue",
        "summary": "Revenue rose each quarter.",
        "html": "<svg>large source</svg>",
        "css": ".bar { color: red }",
    }
    item = ConversationItem(
        id="item_1",
        type="function_call",
        status="completed",
        response_id="response_1",
        created_at=1,
        data=FunctionCallData(
            agent="agent",
            name="sys_visualize",
            arguments=json.dumps(source),
            call_id="call_1",
        ),
    )

    arguments = json.loads(history_to_input_items([item])[0]["arguments"])

    assert arguments["visualization_ref"]["call_id"] == "call_1"
    assert arguments["visualization_ref"]["key"] == "quarterly-revenue"
    assert arguments["visualization_ref"]["title"] == "Revenue"
    assert arguments["visualization_ref"]["summary"] == source["summary"]
    assert arguments["visualization_ref"]["payload_hash"].startswith("sha256:")
    assert "html" not in arguments
