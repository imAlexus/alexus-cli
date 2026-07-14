# Changelog

## 1.2.8 — 2026-07-14

- Il vecchio header testuale è sostituito da un logo ASCII `ALEXUS` con gradiente blu-rosa.
- Il modello attivo è mostrato sotto il composer, allineato a destra rispetto alle scorciatoie.

## 1.2.7 — 2026-07-14

- Il composer della chat ha ora un contorno arrotondato reattivo, cyan quando attivo e grigio durante l'esecuzione.

## 1.2.6 — 2026-07-14

- Nuovo tema developer con header `alexus://workspace`, proprietà colorate, stato operativo e identità visive per prompt e risposte.
- Composer in stile shell con scorciatoie sempre visibili, mantenendo nascosti i riepiloghi tecnici automatici.

## 1.2.5 — 2026-07-14

- Chat TUI ridisegnata con messaggi utente su fascia neutra, risposte minimali e composer piatto nello stile Codex CLI.
- Rimossi dalla vista i riepiloghi automatici di verifica, token, contesto e completamento sessione.

## 1.2.4 — 2026-07-14

- Nuova intestazione TUI a card con gerarchia visiva più chiara per versione, modello, workspace, permessi e sessione.

## 1.2.3 — 2026-07-14

- Prompt, risposte ed errori dei turni precedenti restano visibili nella TUI durante la conversazione.
- La cronologia visiva è limitata per dimensione per mantenere fluido il rendering del terminale.

## 1.2.2 — 2026-07-14

- L'indicizzazione ignora cartelle di sistema non accessibili e gli errori `EPERM` di scansione.
- `/provider` può mantenere la chiave API già configurata senza richiederla nuovamente.
- `/model` scorre tutti i risultati e offre un input custom esplicito con `Ctrl+N` o `/model provider/modello`.

## 1.2.1 — 2026-07-14

- Il comando `alexus update` usa un bootstrap leggero che non carica SQLite prima dell'aggiornamento, evitando file nativi bloccati su Windows.

## 1.2.0 — 2026-07-14

- Aggiornamento autonomo e verificato tramite `alexus update`.
- Dialogo `/provider` nella TUI per sostituire la chiave OpenRouter con input mascherato.
- Ricerca e selezione dei modelli compatibili tramite `/model`, con supporto per ID digitati liberamente.

## 1.1.0 — 2026-07-14

- Configurazione guidata dei provider tramite `alexus provider` con chiave mascherata.
- Archivio credenziali separato e protetto, con priorità alle variabili d'ambiente.
- Suggerimenti interattivi dei comandi `/`, navigazione con frecce e completamento con Tab.

## 1.0.0 — 2026-07-13

- Release stabile con installer verificato per Windows, Linux e macOS.
- Interfaccia TUI interattiva, sessioni ripristinabili e protocollo JSONL.
- Contesto del repository classificato e compattazione delle conversazioni.
- Piani durevoli, approvazioni di sessione e verifiche automatiche.
- Modifiche multi-file transazionali con undo conservativo.
- Report verificabili ed export di sessione sanificati.
- Suite end-to-end e CI su Windows, Ubuntu e macOS.

## 0.9.0

- Export JSON portabile delle sessioni con rimozione dei segreti.
- Test end-to-end del ciclo modifica, verifica, eventi e report.

## 0.8.0

- Modifiche correlate su più file applicate come transazione.

## 0.7.0

- Report di sessione con diff, verifiche, utilizzo e approvazioni.

## 0.6.0

- Piani strutturati persistenti e approvazioni durevoli.

## 0.5.0

- Motore di contesto del repository e compattazione.

## 0.4.0

- Rilevamento del progetto e verifiche automatiche.

## 0.3.0

- TUI multi-turno con streaming e controlli interattivi.
