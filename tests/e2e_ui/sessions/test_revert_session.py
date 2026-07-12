"""Browser e2e: revert a session to edit a user message."""

from __future__ import annotations

from playwright.sync_api import Page, expect

_ASSISTANT = '[data-testid="message-bubble"][data-role="assistant"]'
_USER = '[data-testid="message-bubble"][data-role="user"]'


def test_revert_from_middle_truncates_current_session(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    base_url, session_id = seeded_session
    kept = "revert-kept-marker"
    dropped = "revert-dropped-marker"

    page.goto(f"{base_url}/c/{session_id}")
    composer = page.get_by_placeholder("Ask the agent anything…")

    composer.fill(f"Reply OK and remember {kept}")
    page.get_by_role("button", name="Send", exact=True).click()
    assistant = page.locator(_ASSISTANT)
    expect(assistant).to_have_count(1, timeout=60_000)

    composer.fill(f"Reply OK and remember {dropped}")
    page.get_by_role("button", name="Send", exact=True).click()
    expect(assistant).to_have_count(2, timeout=60_000)

    dropped_message = page.locator(_USER).filter(has_text=dropped)
    dropped_message.hover()
    dropped_message.get_by_test_id("revert-from-message").click()

    dialog = page.get_by_role("dialog")
    expect(dialog.get_by_text("Revert to before this message?")).to_be_visible()
    restore = dialog.get_by_label("Also undo tracked file changes", exact=False)
    expect(restore).not_to_be_checked()
    dialog.get_by_role("button", name="Revert and edit", exact=True).click()

    expect(dialog).not_to_be_visible(timeout=30_000)
    expect(page).to_have_url(f"{base_url}/c/{session_id}")
    expect(page.locator(_USER).filter(has_text=kept)).to_have_count(1)
    expect(page.locator(_USER).filter(has_text=dropped)).to_have_count(0)
    expect(page.locator(_ASSISTANT)).to_have_count(1)
    expect(composer).to_have_value(f"Reply OK and remember {dropped}")
