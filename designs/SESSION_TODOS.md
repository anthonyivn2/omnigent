# Design: Todos — write the work down first, decide on an agent after

- Status: Draft
- Author: interview-driven (see §12 for the decision log)

## 1. Summary

Add a **todo**: a place to write down everything you need to achieve *before*
committing an agent to it. You open a full-page markdown doc, write as much or as
little as you want (a one-line feature idea, or the whole spec for a new
affordance), and it autosaves. Nothing runs. Later — seconds or days — you hit
**Run**, pick where it should execute, and an agent works out the steps itself and
executes them in the background, exactly like a session.

A todo is stored as a **conversation row with `kind="todo"`** that owns no runner
and never runs turns itself. **Run** spawns a *child* conversation which does the
work, so the todo survives as a living tracker linking to every run it spawned.

## 2. Goals / Non-goals

### Goals
- Capture a todo with **zero** configuration — no host, no workspace, no agent, no
  harness. Writing must not require deciding where it runs.
- A full-page markdown editor with autosave, reusing the existing TipTap stack.
- **Run** defers all execution config to launch time, pre-filled with last-used
  defaults.
- The agent decomposes the todo into steps itself, surfaces the plan for approval,
  then executes.
- The todo persists after launch: `draft → planning → awaiting approval → running →
  done`, with links to each child run.
- Re-run and follow-up runs from the same todo.
- Todos live in the existing sidebar as visually distinct rows; no new page.

### Non-goals (v1)
- No CLI (`omnigent todo …`) — web + REST only.
- No agent-callable tool for filing todos (agents can't create todos for you yet).
- No structured subtask rows — the body is free-form markdown; decomposition is the
  agent's job.
- No fan-out to one child session per step. One run = one child session; the agent
  manages its own internal step list.
- No scheduling / recurrence.

## 3. Terminology and the existing name collision

User-facing and code term: **todo**.

`web/src/shell/TodoPanel.tsx` already means *Claude Code's in-session todo list*
(the harness's own step tracker, fed by `session.todos` SSE events). That is an
internal, single-purpose panel; this design **renames it** to free the noun:

| Before | After |
| --- | --- |
| `web/src/shell/TodoPanel.tsx` | `web/src/shell/AgentStepsPanel.tsx` |
| `TodoPanel` / `TodoItem` / `TodoIcon` | `AgentStepsPanel` / `AgentStep` / `AgentStepIcon` |
| rail tab label "Todos" | "Steps" |

`useChatStore.todos`, the `session.todos` SSE event, and the server's
`_session_todos_cache` are **not** renamed — they mirror Claude Code's own wire
vocabulary, and churning them would break the forwarder contract for no gain.

## 4. Data model

### 4.1 `conversations.kind` gains a third value

`kind` is a `SmallInteger` with a closed check constraint
(`db_models.py:536`, `ck_conversations_kind`) and an int codec
(`enum_codecs.py:25`, `CONVERSATION_KIND`).

```python
CONVERSATION_KIND = {"default": 1, "sub_agent": 2, "todo": 3}
```

Migration work:
- Drop and recreate `ck_conversations_kind` as `kind IN (1, 2, 3)`.
- No index work needed: `ix_conversations_kind` is already
  `(workspace_id, kind, id)`, so listing todos is a covered seek.

### 4.2 New column: `conversations.todo_body`

Nullable `Text`, holding the markdown doc. It joins the opaque-text set that
`z4a2b3c4d5e6_compress_opaque_text_columns` compresses, so long specs don't bloat
rows.

Rejected alternatives:
- *Store the body as a `conversation_items` message.* Editing a doc is not
  appending to a transcript; autosave would rewrite history, and item compaction
  could evict the body outright.
- *Reuse the `session_state` JSON column.* That column belongs to the policy
  engine; overloading it couples unrelated lifecycles.

### 4.3 Columns a todo deliberately leaves NULL

| Column | Why |
| --- | --- |
| `host_id`, `workspace` | Chosen at Run. `ck_conversations_workspace_required_for_host` only fires when `host_id` is set, so both-NULL is already legal. |
| `agent_id`, `harness_override` | Chosen at Run. |
| `runner_id` | A todo never dispatches, so nothing ever claims a runner. |

`workspace` being **immutable after creation** (per
`designs/SESSION_WORKSPACE_SELECTION.md`) is precisely why Run creates a *child*
conversation instead of mutating the todo row — the child is created fresh with its
workspace already decided, and that invariant is never bent.

### 4.4 Title

`conversations.title` is `NOT NULL` with `server_default=""`. A todo's title comes
from, in order: an explicit user title, the body's first markdown heading, the
body's first non-empty line, else `""` (rendered as "Untitled todo").

### 4.5 Status

Derived, not stored — no new column:

| Status | Derivation |
| --- | --- |
| `draft` | no child conversations |
| `running` | ≥1 child with an in-flight turn |
| `awaiting_approval` | newest child idle **and** its `todo_plan_pending` label set (§6.2) |
| `done` | ≥1 child, none in flight, no pending plan |

Keeping status derived means a crashed runner can't strand a todo in a lying state.

## 5. API

New route module `omnigent/server/routes/todos.py`. It does **not** fork the
session-create path: the launch endpoint calls a helper extracted from
`sessions.py`'s create route so host validation, workspace realpath
canonicalization, harness availability checks, and git-worktree creation stay
single-sourced.

| Method | Path | Body / notes |
| --- | --- | --- |
| `POST` | `/v1/todos` | `{title?, body?}` → creates `kind="todo"`. No config required. |
| `GET` | `/v1/todos/{id}` | Todo + derived status + child run summaries. |
| `PATCH` | `/v1/todos/{id}` | `{title?, body?}` — the autosave target. |
| `POST` | `/v1/todos/{id}/launch` | `{host_id, workspace, agent_id, harness?, git?, reasoning_effort?, model?}` → creates the child conversation and dispatches turn 1. Returns the child's id. |
| `DELETE` | `/v1/todos/{id}` | Cascades to children via `parent_conversation_id ON DELETE CASCADE`. |

Listing reuses `GET /v1/sessions`, which gains `kind=todo` filtering. Todos appear
in the **default** listing (the sidebar must show them without a flag), while their
children stay nested under them the way sub-agent rows already do.

Permissions reuse `SqlSessionPermission` unchanged — a todo is a conversation, so
`LEVEL_EDIT` covers body edits and `LEVEL_EDIT` covers launch.

## 6. Execution

### 6.1 Launch

`POST /v1/todos/{id}/launch` creates a child conversation with
`parent_conversation_id = <todo id>`, `root_conversation_id = <todo id>`, and
`kind = "default"` — *not* `"sub_agent"`. It is a real user-initiated session that
happens to have a todo as its parent; typing it as `sub_agent` would drag in
sub-agent spec resolution (`sub_agent_name` → parent spec's `sub_agents` list),
which does not apply here.

Turn 1's user message is the todo body, prefixed with a short preamble (§6.2). The
body is **also** re-readable: the child can fetch the todo's current text, so edits
you make mid-run are visible on the next turn without rewriting history.

### 6.2 The plan gate — flagged decision

There is **no agent-callable elicitation primitive** in this codebase.
Elicitations originate from MCP servers (`tools/mcp.py:416`) and permission-policy
denials; an agent cannot raise an arbitrary "approve my plan?" prompt. Two ways to
close that gap:

**(A) Turn-boundary gate — recommended for v1.** The launch preamble instructs the
agent to produce a step plan and end its turn without making changes. The turn
ending puts the session idle; the server sets a `todo_plan_pending` label on the
child, so the todo renders `awaiting_approval` with **Approve** / **Edit** /
**Reject**. Approve clears the label and sends "proceed" as turn 2.

- Works on **every** harness, native wrappers included, with no new plumbing.
- Reuses idle-session detection, the WS updates stream, and message dispatch.
- Weakness: it is an *instruction*, not an enforced barrier. A disobedient agent
  could start editing during turn 1.

**(B) Enforced gate — follow-up.** A `sys_request_approval` tool (or a policy that
denies-with-ask on the first mutating call) makes the barrier real and produces a
genuine elicitation, which the Inbox already renders. Costs a new tool plus a
permissions story, and only binds harnesses that receive bridged `sys_*` tools.

v1 ships (A) and leaves (B) as the hardening step. Where the plan gate surfaces is
identical either way, so (B) is a swap behind the same UI.

### 6.3 Inbox

`awaiting_approval` todos become a third Inbox source alongside approvals and
unseen comments (`collectInboxItems` in `web/src/lib/inbox.ts`). Under (A) they are
not elicitations, so they need their own `InboxSource` rather than riding the
existing `pending_elicitations_count` path.

## 7. Web UI

### 7.1 Writing — `/todos/{id}`

A full-page route holding the existing TipTap editor (`MarkdownRichTextViewer` +
`MarkdownEditorToolbar`) wired to `useEditorAutoSave` against
`PATCH /v1/todos/{id}`. Headings, checklists, code blocks, and images all come for
free, as does commenting on the doc.

Header: title field, derived status pill, and a **Run** button. Below the editor, a
child-runs list — each row linking to its session with turn count and state.

### 7.2 Entry point

"New todo" in the sidebar's new-item affordance and in the command palette
(`CommandPalette.tsx`). Creates an empty todo and navigates to its page. The
new-chat composer is left alone — no "Save as todo" button, so there is exactly
one way a todo comes into being.

### 7.3 Run sheet

Opens the host / workspace / agent / harness / git-worktree pickers already built
for `NewChatDialog.tsx`, pre-filled with last-used values. Those pickers are
extracted from the dialog into a shared component rather than copied — this is the
one piece of frontend refactoring the feature requires, and skipping it would fork
3.7k lines of validated picker logic.

### 7.4 Sidebar

Todos render as rows in the existing sidebar, distinguished by a hollow-square icon
and no runner badge. A launched todo's child runs nest beneath it, reusing the
sub-agent nesting already covered by `Sidebar.subagentHighlight.test.tsx`.

## 8. Rollout

| Slice | Contents |
| --- | --- |
| 1 | `kind="todo"` codec + check-constraint migration; `todo_body` column; store methods |
| 2 | `routes/todos.py` CRUD; extract the session-create helper from `sessions.py` |
| 3 | `/todos/{id}` page + autosave; sidebar rows; `TodoPanel` → `AgentStepsPanel` rename |
| 4 | Launch endpoint + extracted Run sheet pickers |
| 5 | Plan gate (A): preamble, `todo_plan_pending` label, Approve/Edit/Reject, Inbox source |

Slices 1–3 are independently shippable — a todo you can write, keep, and search is
already useful before Run exists.

## 9. Risks

- **`kind` check-constraint migration** touches the hottest table. It is a
  constraint swap with no data rewrite, but needs the same care as
  `s1a2b3c4d5e6_conversations_title_not_null`.
- **Picker extraction from `NewChatDialog.tsx`** is the largest refactor and the
  likeliest source of regressions; it is covered by existing `NewChatDialog.*.test.tsx`
  suites, which must keep passing untouched.
- **Todos in the default session listing** changes what every existing sidebar and
  session-list consumer sees. Any caller that assumes every row can be opened as a
  chat needs auditing.
- **Plan-gate softness** under (A), as described in §6.2.

## 10. Testing

- Store: todo create with all-NULL config; check constraint accepts 3, rejects 4.
- Routes: launch parents the child correctly; launch on an already-running todo adds
  a second child; permissions gate body edits and launch.
- Status derivation across draft / running / awaiting / done, including a child
  whose runner vanished mid-turn.
- Web: autosave debounce, title derivation from the first heading, Run sheet
  pre-fill, sidebar nesting, rename leaves the Claude-Code steps panel working.

## 11. Open questions

1. Should Run be allowed on a todo with an empty body? (Proposed: no — disable the
   button.)
2. Does re-running reuse the previous run's workspace/worktree, or always re-ask?
   (Proposed: pre-fill from the last run, still confirmable.)
3. Does the derived `done` status distinguish success from failure? (Proposed: not in
   v1; the child session's own state carries that.)

## 12. Decision log

| Question | Decision |
| --- | --- |
| Storage | Draft session, `kind="todo"` — not a new entity, not a workspace file |
| Run semantics | Todo is a parent container; Run spawns a child conversation |
| Execution | Plan → approve → execute (not straight-to-work, not fan-out) |
| Write surface | Full-page markdown doc only (no composer entry point) |
| Config timing | Deferred entirely to Run |
| Body handoff | Injected as turn 1 **and** re-readable so mid-run edits land |
| After launch | Todo persists as a living tracker with links to its runs |
| Plan approval | Surfaces in chat + Inbox; mechanism per §6.2 |
| Placement | Sidebar only |
| Naming | Keep "todo"; rename the in-session panel to `AgentStepsPanel` |
| Scope | Web + REST API; no CLI, no agent-callable tool |
