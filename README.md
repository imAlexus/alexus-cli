# Alexus CLI

Alexus is an open-source CLI coding agent for working on local repositories with tool-capable OpenRouter models. Every access goes through validated tools, paths remain confined to the workspace, and every change is recorded in SQLite with checkpoints for conservative undo.

## Requirements

- Node.js 22+
- pnpm 11+
- Git
- An OpenRouter key, configured with `alexus provider` or `OPENROUTER_API_KEY`

## Installation

### Windows — quick install

From PowerShell:

```powershell
irm https://raw.githubusercontent.com/imAlexus/alexus-cli/main/install.ps1 | iex
```

The installer requires Node.js 22+, downloads the latest release, verifies its SHA-256 checksum, installs Alexus globally, and configures the user `PATH` when required.

### Linux and macOS — quick install

From a shell:

```sh
curl -fsSL https://raw.githubusercontent.com/imAlexus/alexus-cli/main/install.sh | sh
```

The installer requires Node.js 22+, downloads the latest release, verifies its checksum with `sha256sum` or `shasum`, and installs Alexus globally through npm. If the global directory is not writable, it automatically uses `~/.local` and updates the shell profile. Open a new terminal afterward. To install a specific version, download the script and pass the version number as its first argument.

### Local development

```powershell
pnpm install
pnpm build
pnpm link --global
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
alexus init
alexus provider
alexus update
alexus model set anthropic/claude-sonnet-4
alexus doctor
```

On cmd.exe use `set OPENROUTER_API_KEY=sk-or-v1-...`; on Linux and macOS use `export`.

## Usage

Run `alexus` in a project directory to open the interactive interface. Responses stream in real time, file operations and commands appear as tool activity, and risky actions request confirmation with `y` (once), `a` (for the session), or `n` (deny).

Prompts and responses from earlier turns remain visible during the conversation. The complete history is stored in the SQLite session; `/clear` intentionally clears the view and `/new` starts a new conversation.

`alexus provider` lists available providers, lets you choose OpenRouter, and requests the API key through masked input. Credentials are stored separately in `~/.alexus/credentials.json` with user-only access. A key configured explicitly in Alexus takes precedence; `OPENROUTER_API_KEY` remains available as a fallback.

`alexus update` checks the latest GitHub release, downloads the tarball and SHA-256 checksum, and updates the global installation. Use `alexus update --check` to check without installing.

Alexus detects the ecosystem, frameworks, package manager, and available scripts. After a change, when the model has not already verified the result, it safely selects relevant formatting, lint, type-checking, test, and build commands. Documentation-only changes skip unnecessary checks, while test-only changes skip the full build.

The context engine indexes the repository while respecting `.gitignore`, excludes sensitive files, ranks files against the request, and includes only the most relevant content within a token budget. Interactive turns continue in the same session and are compacted automatically near the model limit.

For complex work, Alexus can create and update a validated structured plan. Plans are shown in the TUI, persisted in SQLite, and restored on resume. Session approvals also persist across turns and restarts for the exact same command and arguments.

Every session can produce a verifiable report containing changed files, insertions, deletions, verification commands, tokens, cost, plan, and remembered approvals. Reports are available as human-readable output or JSON and are also emitted through the event protocol.

Related multi-file edits are prepared entirely in memory and applied as one transaction. If any replacement is missing or ambiguous, Alexus writes none of the files. If a write fails, already updated files are restored.

```text
alexus
alexus chat
alexus run "find the bug, fix it, and run the tests"
alexus run --model openai/gpt-5 --max-cost 1.50 "fix the TypeScript errors"
alexus run --json "analyze the project"
alexus run --compact "continue with compacted context"
alexus context "fix the login"
alexus resume [session-id]
alexus sessions
alexus sessions show <session-id> [--json]
alexus sessions export <session-id> [-o session.json]
alexus sessions delete <session-id>
alexus plan [session-id] [--json]
alexus review [session-id] [--json]
alexus status
alexus diff
alexus undo [session-id]
alexus config
alexus update [--check]
alexus provider
alexus provider list
alexus provider set openrouter
alexus model list --tools
alexus model search claude
alexus model get
alexus model set <model-id>
alexus doctor
```

The interactive interface supports:

```text
/help
/status
/context [request]
/compact
/new
/model
/permissions readonly|workspace|full-access
/diff
/undo
/sessions
/plan <request>
/plan show
/plan clear
/review
/provider
/goal <goal>
/clear
/exit
```

Typing `/` opens the complete command list. Use `↑` and `↓` to navigate across paginated results and `Tab` to complete. `/provider` can replace the API key or keep the existing key by pressing Enter, then continues to model selection. `/model` searches every tool-capable OpenRouter model eight at a time. Press `Ctrl+N` to enter a custom ID, or use `/model provider/model` directly. `Ctrl+O` toggles tool details. `Ctrl+C` cancels the active task or exits while idle. `Shift+Enter` inserts a new line.

`--json` reserves stdout for versioned JSONL events; diagnostics and approval prompts use stderr.

## Security

The default mode is `workspace`. Reads and writes are confined to the real project root, including checks for symlinks and junctions. `.env` files, keys, and credentials are not read automatically. Processes run without a shell, with command and arguments separated, bounded output, cancellation, and timeouts. Moderate operations require an interactive approval; destructive or system operations are blocked.

`alexus undo` uses pre-change and post-change hashes. If a file changed after the agent edited it, undo stops instead of overwriting the user's work.

Sessions are persistent threads made of turns and items. Messages, tool calls, and results are stored in full. After an interruption, `alexus resume` marks unfinished operations as interrupted and continues without replaying the same tool-call identifier.

`alexus sessions export` produces portable JSON containing the report, plan, turns, and items. The local workspace path is removed and recognizable API keys, tokens, passwords, and other secrets are replaced with `[REDACTED]`; `-o` refuses to overwrite an existing file.

## Configuration

The project configuration is `.alexus/config.json`; the global configuration is `~/.alexus/config.json`. Precedence is CLI flags, environment, project, global, and defaults. API keys are never stored in configuration files; provider setup uses the separate `~/.alexus/credentials.json` store.

## Development

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Telemetry is disabled. The initial provider client communicates only with `https://openrouter.ai/api/v1`.

See [CHANGELOG.md](CHANGELOG.md) for release changes and [SECURITY.md](SECURITY.md) for private vulnerability reporting.
