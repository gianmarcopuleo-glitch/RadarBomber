# RadarBomber

Dashboard statica in un solo file (`index.html`), senza build o dipendenze.

## Funzioni disponibili
- Due classifiche distinte: probabilità di segnare e probabilità di gol o assist.
- Ricerca e filtri per club/nazionali, competizione, ruolo e soglia di probabilità.
- Campo competizione libero, con elenco guida che comprende campionati e coppe nazionali, Champions League, Europa League, Conference League, Nations League, qualificazioni Europei/Mondiali, Europei, Mondiali e Copa Libertadores.
- Inserimento manuale delle quote di Bet365, Snai, Eurobet, Goldbet, Betfair e altri bookmaker.
- Confronto di tutte le quote salvate e indicazione della migliore quota per giocatore e mercato.
- Registro delle proposte con esito presa/sbagliata/in attesa/annullata, hit rate ed esportazione CSV.
- Importazione massiva dei giocatori da CSV, ripristino backup JSON ed esportazione di backup o lista CSV.
- Salvataggio locale nel browser.

## Avvio
Aprire `index.html` in un browser oppure pubblicare il file come sito statico.

Per inserire una rosa in blocco, aprire **Gestisci dati → Importa / esporta archivio** e caricare un CSV con intestazioni:
`name, team, teamType, league, role, goal, ga, form, mins, match`.

- `teamType`: `club` oppure `national`
- `goal` e `ga`: probabilità percentuali da 0 a 100
- `form`: valore da 0 a 10
- `mins`: minuti previsti
- `role`: `Attaccante`, `Centrocampista` oppure `Difensore`

## Limiti da conoscere
I profili contrassegnati **DEMO** sono esempi illustrativi e non rappresentano dati aggiornati per le partite di oggi. Le probabilità non sono calcolate da statistiche live: in questa versione sono inserite manualmente. Anche le quote vanno inserite manualmente; non è collegato un feed live di Bet365 o di altri bookmaker. Il campo competizione consente di organizzare qualunque torneo, ma non scarica automaticamente rose, calendari o statistiche. I dati salvati nel browser non si sincronizzano tra dispositivi.

## Pubblicazione
La modifica è stata salvata sul branch `main` di GitHub. Il collegamento automatico a Vercel ha restituito HTTP 403 per l'autorizzazione dell'integrazione; non ho modificato il deployment già online.
