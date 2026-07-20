"""Validation tests for ephemeral visualization display capabilities."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from omnigent.server.schemas import SessionEventInput

_PROFILE = {
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


def test_message_accepts_display_profile() -> None:
    event = SessionEventInput(
        type="message",
        data={"role": "user", "content": []},
        display_profile=_PROFILE,
    )

    assert event.display_profile is not None
    assert event.display_profile.viewport_width == 384
    assert event.display_profile.canvas_width == 352
    assert "display_profile" not in event.data


@pytest.mark.parametrize(
    "profile",
    [
        {**_PROFILE, "viewport_width": True},
        {**_PROFILE, "canvas_height": 801},
        {**_PROFILE, "surface": "watch"},
        {**_PROFILE, "device_model": "secret"},
    ],
)
def test_display_profile_rejects_precise_or_unknown_metadata(
    profile: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        SessionEventInput(
            type="message",
            data={"role": "user", "content": []},
            display_profile=profile,
        )
