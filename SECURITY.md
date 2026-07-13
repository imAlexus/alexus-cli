# Sicurezza

## Versioni supportate

La serie stabile `1.x` riceve correzioni di sicurezza. Le versioni `0.x` sono considerate anteprime e devono essere aggiornate.

## Segnalare una vulnerabilità

Non aprire una issue pubblica con dettagli sfruttabili. Usa **Security → Report a vulnerability** nel repository GitHub per inviare una segnalazione privata tramite GitHub Security Advisories.

Indica versione, sistema operativo, impatto, procedura di riproduzione e una possibile mitigazione. Non includere chiavi API, credenziali o dati personali reali.

## Confini di sicurezza

Alexus limita i percorsi al workspace reale, non usa una shell per eseguire processi, classifica i comandi e conserva checkpoint con hash per l'undo. Questi controlli riducono il rischio ma non sostituiscono l'ispezione delle modifiche e l'uso di repository sotto controllo versione.
