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

Esegui `alexus` nella cartella del progetto per aprire l'interfaccia interattiva. La risposta viene mostrata in streaming, le operazioni sui file e i comandi appaiono in un pannello dedicato e le azioni a rischio chiedono conferma con `y` (una volta), `a` (per la sessione) o `n` (rifiuta).

Alexus rileva automaticamente ecosistema, framework, package manager e script disponibili. Dopo una modifica, se il modello non ha già verificato il risultato, esegue una selezione sicura di formatter check, lint, typecheck, test e build. Per modifiche alla sola documentazione evita verifiche inutili; per modifiche limitate ai test evita la build completa. Output dei processi, token e costo cumulativo sono visibili in tempo reale e registrati negli eventi JSONL.

Il motore di contesto indicizza il repository rispettando `.gitignore`, esclude file sensibili, ordina i file in base alla richiesta e include soltanto quelli più pertinenti entro un budget token. Le conversazioni interattive continuano nella stessa sessione e vengono compattate automaticamente quando si avvicinano al limite del modello.

Per attività articolate Alexus può creare e aggiornare un piano strutturato tramite un tool validato. Il piano viene mostrato nella TUI, salvato in SQLite e recuperato con il resume; una risposta finale con step ancora aperti viene marcata come parzialmente verificata. Anche le approvazioni concesse per la sessione persistono tra turni e riavvii, limitatamente allo stesso comando e agli stessi argomenti.

```text
alexus
alexus chat
alexus run "trova il bug, correggilo ed esegui i test"
alexus run --model openai/gpt-5 --max-cost 1.50 "correggi gli errori TypeScript"
alexus run --json "analizza il progetto"
alexus run --compact "continua riducendo il contesto precedente"
alexus context "correggi il login"
alexus resume [session-id]
alexus sessions
alexus sessions show <session-id> [--json]
alexus sessions delete <session-id>
alexus plan [session-id] [--json]
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

Nell'interfaccia interattiva sono disponibili:

```text
/help
/status
/context [richiesta]
/compact
/new
/model
/permissions readonly|workspace|full-access
/diff
/undo
/sessions
/plan <richiesta>
/plan show
/plan clear
/goal <obiettivo>
/clear
/exit
```

`Ctrl+O` mostra o nasconde gli argomenti degli strumenti. `Ctrl+C` annulla il task in corso; se Alexus è inattivo, chiude l'interfaccia. `Shift+Enter` inserisce una nuova riga nel prompt.

`--json` riserva stdout a eventi JSONL versionati; diagnostica e prompt di approvazione vanno su stderr.

## Sicurezza

La modalità predefinita è `workspace`. Letture e modifiche sono confinate alla root reale del progetto, inclusi controlli su symlink e junction. `.env`, chiavi e credenziali non vengono lette automaticamente. I processi sono avviati senza shell, con comando e argomenti separati, timeout, cancellazione e output limitato. Operazioni moderate richiedono una sessione interattiva; operazioni distruttive o di sistema vengono rifiutate.

`alexus undo` usa hash pre/post modifica: se un file è cambiato dopo l'intervento dell'agente, l'undo si interrompe invece di sovrascrivere il lavoro dell'utente.

Le sessioni sono organizzate come thread persistenti composti da turni e item. Messaggi, tool call e risultati vengono salvati integralmente; dopo un'interruzione, `alexus resume` chiude le operazioni rimaste in esecuzione come interrotte e continua senza rieseguire lo stesso identificatore di tool call.

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
