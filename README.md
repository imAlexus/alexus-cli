# Alexus CLI

Alexus è un agente CLI proprietario per lavorare su repository locali con modelli OpenRouter dotati di tool calling. Ogni accesso passa attraverso tool validati, i percorsi restano confinati al workspace e ogni modifica viene registrata in SQLite con checkpoint per un undo conservativo.

## Requisiti

- Node.js 22+
- pnpm 11+
- Git
- una chiave `OPENROUTER_API_KEY`

## Installazione

### Windows — installazione rapida

Da PowerShell:

```powershell
irm https://raw.githubusercontent.com/imAlexus/alexus-cli/main/install.ps1 | iex
```

L'installer richiede Node.js 22+, scarica l'ultima release, verifica il checksum SHA-256, installa Alexus globalmente e configura il `PATH` utente quando necessario.

### Sviluppo locale

```powershell
pnpm install
pnpm build
pnpm link --global
$env:OPENROUTER_API_KEY = "sk-or-v1-..."
alexus init
alexus model set anthropic/claude-sonnet-4
alexus doctor
```

Su cmd.exe usare `set OPENROUTER_API_KEY=sk-or-v1-...`; su Linux/macOS usare `export`.

## Uso

```text
alexus
alexus chat
alexus run "trova il bug, correggilo ed esegui i test"
alexus run --model openai/gpt-5 --max-cost 1.50 "correggi gli errori TypeScript"
alexus run --json "analizza il progetto"
alexus resume [session-id]
alexus sessions
alexus sessions delete <session-id>
alexus status
alexus diff
alexus undo [session-id]
alexus config
alexus model list --tools
alexus model search claude
alexus model get
alexus model set <model-id>
alexus doctor
```

`--json` riserva stdout a eventi JSONL versionati; diagnostica e prompt di approvazione vanno su stderr.

## Sicurezza

La modalità predefinita è `workspace`. Letture e modifiche sono confinate alla root reale del progetto, inclusi controlli su symlink e junction. `.env`, chiavi e credenziali non vengono lette automaticamente. I processi sono avviati senza shell, con comando e argomenti separati, timeout, cancellazione e output limitato. Operazioni moderate richiedono una sessione interattiva; operazioni distruttive o di sistema vengono rifiutate.

`alexus undo` usa hash pre/post modifica: se un file è cambiato dopo l'intervento dell'agente, l'undo si interrompe invece di sovrascrivere il lavoro dell'utente.

## Configurazione

Il file progetto è `.alexus/config.json`; quello globale è `~/.alexus/config.json`. Priorità: flag CLI, ambiente, progetto, globale, default. La chiave API non viene mai salvata nella configurazione.

## Sviluppo

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

La telemetria è disattivata e il client iniziale usa esclusivamente `https://openrouter.ai/api/v1`.
