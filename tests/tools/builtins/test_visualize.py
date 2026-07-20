"""Tests for the framework-owned inline visualization tool."""

from __future__ import annotations

import json

import pytest

from omnigent.runner.tool_dispatch import (
    build_native_relay_tool_schemas,
    execute_tool,
    should_dispatch_locally,
)
from omnigent.spec import AgentSpec
from omnigent.tools import ToolManager
from omnigent.tools.base import ToolContext
from omnigent.tools.builtins.visualize import SysVisualizeTool
from omnigent.tools.client_specified import ClientSideToolSpec

_CTX = ToolContext(task_id="task_test", agent_id="agent_test")


def test_visualize_schema_and_acknowledgement() -> None:
    tool = SysVisualizeTool()
    schema = tool.get_schema()["function"]
    parameters = schema["parameters"]

    assert "body text of at least 15 CSS px" in schema["description"]
    assert "supporting labels of at least 12 CSS px" in schema["description"]
    assert "[[visualization:<key>]]" in schema["description"]
    assert "immediately after the heading" in schema["description"]
    assert parameters["required"] == ["key", "title", "summary", "html"]
    assert parameters["properties"]["key"]["pattern"].startswith("^")
    assert parameters["additionalProperties"] is False
    css_description = parameters["properties"]["css"]["description"]
    assert "--viz-bg" in css_description
    assert "--viz-negative" in css_description
    assert "--viz-cyan" in css_description
    assert "Do not invent token names" in css_description
    javascript_description = parameters["properties"]["javascript"]["description"]
    assert "'react'|'canvas'" in javascript_description
    assert "renderer: 'flow'" in javascript_description
    assert "React Flow renderer" in javascript_description
    assert "responsive wrapping" in javascript_description
    assert "pan, zoom" in javascript_description
    assert "maxWidth" in javascript_description
    assert "top-level html remains the fallback" in javascript_description
    assert "do not duplicate" in javascript_description
    assert "layout.width and layout.height" in schema["description"]
    assert "viz-card" in parameters["properties"]["html"]["description"]
    assert "not scene.height" in parameters["properties"]["height"]["description"]
    assert "inline canvas height" in parameters["properties"]["height"]["description"]
    assert json.loads(
        tool.invoke(
            json.dumps(
                {
                    "key": "quarterly-revenue",
                    "title": "Quarterly revenue",
                    "summary": "Revenue rose each quarter.",
                    "html": "<figure><svg viewBox='0 0 100 50'></svg></figure>",
                    "height": 480,
                }
            ),
            _CTX,
        )
    ) == {
        "ok": True,
        "visualization_key": "quarterly-revenue",
        "title": "Quarterly revenue",
        "placement": "[[visualization:quarterly-revenue]]",
        "message": "Place the marker after its heading or short lead-in.",
    }


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (
            {"title": "Title", "summary": "Summary", "html": "<p>Fallback</p>"},
            "key is required",
        ),
        (
            {"key": "revenue", "summary": "Summary", "html": "<p>Fallback</p>"},
            "title is required",
        ),
        (
            {
                "key": "revenue",
                "title": "Title",
                "summary": "Summary",
                "html": "<p>x</p>",
                "height": 100,
            },
            "height must be between 240 and 800",
        ),
        (
            {
                "key": "revenue",
                "title": "Title",
                "summary": "Summary",
                "html": "<p>x</p>",
                "extra": True,
            },
            r"unknown field\(s\): extra",
        ),
        (
            {
                "key": "not valid",
                "title": "Title",
                "summary": "Summary",
                "html": "<p>x</p>",
            },
            "key must start with a letter or digit",
        ),
    ],
)
def test_visualize_rejects_invalid_payloads(payload: dict[str, object], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        SysVisualizeTool().invoke(json.dumps(payload), _CTX)


def test_visualize_is_available_to_every_harness() -> None:
    spec = AgentSpec(spec_version=1)
    manager_names = {schema["function"]["name"] for schema in ToolManager(spec).get_tool_schemas()}
    relay_names = {schema["name"] for schema in build_native_relay_tool_schemas(spec)}

    assert "sys_visualize" in manager_names
    assert "sys_visualize" in relay_names
    assert should_dispatch_locally("sys_visualize")


async def test_runner_executes_visualize_locally() -> None:
    output = await execute_tool(
        tool_name="sys_visualize",
        arguments=json.dumps(
            {
                "key": "revenue",
                "title": "Revenue",
                "summary": "Revenue rose.",
                "html": "<svg></svg>",
            }
        ),
    )

    assert json.loads(output)["ok"] is True


def test_client_tool_cannot_shadow_visualize() -> None:
    schema = {
        "type": "function",
        "function": {
            "name": "sys_visualize",
            "parameters": {"type": "object", "properties": {}},
        },
    }
    with pytest.raises(ValueError, match="cannot shadow"):
        ToolManager(
            AgentSpec(spec_version=1),
            client_tool_specs=[ClientSideToolSpec(name="sys_visualize", schema=schema)],
        )
