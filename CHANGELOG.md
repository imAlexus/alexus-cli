# Changelog

## 1.3.0 — 2026-07-15

- Slash suggestions now include all commands and move through paginated windows instead of wrapping after the first visible group.
- The TUI, command-line help, provider and update flows, errors, tool descriptions, model prompts, README, and security policy are now fully in English.

## 1.2.9 — 2026-07-14

- The logo now uses a thin ASCII wordmark without a frame and with a softer gradient.
- Reduced vertical space before the composer and reduced the visual intensity of the active model label.

## 1.2.8 — 2026-07-14

- Replaced the old text header with a blue-to-pink `ALEXUS` ASCII wordmark.
- Moved the active model below the composer, aligned to the right of the shortcuts.

## 1.2.7 — 2026-07-14

- Added a reactive rounded outline to the chat composer: cyan while active and gray during execution.

## 1.2.6 — 2026-07-14

- Added a developer theme with an `alexus://workspace` header, colored properties, operational status, and distinct prompt and response identities.
- Added a shell-style composer with persistent shortcut hints while keeping automatic technical summaries hidden.

## 1.2.5 — 2026-07-14

- Redesigned the TUI with neutral user-message bands, minimal responses, and a flat Codex-style composer.
- Removed automatic verification, token, context, and session-completion summaries from the TUI.

## 1.2.4 — 2026-07-14

- Added a card-style TUI header with clearer hierarchy for version, model, workspace, permissions, and session.

## 1.2.3 — 2026-07-14

- Previous prompts, responses, and errors remain visible in the TUI during a conversation.
- Bounded the visual history by size to keep terminal rendering responsive.

## 1.2.2 — 2026-07-14

- Repository indexing skips inaccessible system folders and tolerates `EPERM` scan errors.
- `/provider` can keep an existing API key without requesting it again.
- `/model` navigates every result and provides explicit custom-ID input through `Ctrl+N` or `/model provider/model`.

## 1.2.1 — 2026-07-14

- `alexus update` uses a lightweight bootstrap that does not load SQLite before updating, avoiding locked native files on Windows.

## 1.2.0 — 2026-07-14

- Added verified self-update through `alexus update`.
- Added a TUI `/provider` dialog for replacing the OpenRouter key with masked input.
- Added compatible model search and selection through `/model`, including freely typed IDs.

## 1.1.0 — 2026-07-14

- Added guided provider configuration through `alexus provider` with masked key input.
- Added a separate protected credential store with environment-variable fallback.
- Added interactive slash suggestions, arrow navigation, and Tab completion.

## 1.0.0 — 2026-07-13

- Stable release with verified installers for Windows, Linux, and macOS.
- Interactive TUI, resumable sessions, and a JSONL protocol.
- Ranked repository context and automatic conversation compaction.
- Durable plans, session approvals, and automatic verification.
- Transactional multi-file changes with conservative undo.
- Verifiable reports and sanitized session exports.
- End-to-end coverage and CI on Windows, Ubuntu, and macOS.

## 0.9.0

- Portable session JSON export with secret removal.
- End-to-end test of the edit, verification, event, and report cycle.

## 0.8.0

- Related multi-file changes applied as one transaction.

## 0.7.0

- Session reports with diffs, checks, usage, and approvals.

## 0.6.0

- Persistent structured plans and durable approvals.

## 0.5.0

- Repository context engine and compaction.

## 0.4.0

- Project detection and automatic verification.

## 0.3.0

- Multi-turn streaming TUI with interactive controls.
