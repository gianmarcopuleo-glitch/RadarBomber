# RadarBomber — ricostruzione

Dashboard statica in un solo file (`index.html`), senza build o dipendenze.

## Funzioni
- Filtri separati per probabilità stimata di marcatore e coinvolgimento gol/assist.
- Aggiunta e rimozione di giocatori, ricerca, filtri per campionato/ruolo e ordinamento.
- Inserimento manuale quote per bookmaker (Bet365 incluso) e confronto della quota più alta salvata.
- Registro proposte con esito, hit rate ed esportazione CSV.
- Salvataggio nel localStorage del browser.

## Limiti attuali
- I profili iniziali sono esempi dimostrativi, non dati reali aggiornati.
- Le quote sono manuali: non c'è un feed live né un'integrazione bookmaker.
- I dati restano sul browser/dispositivo utilizzato e non si sincronizzano tra dispositivi.

## Pubblicazione
Il file è pronto per essere pubblicato come sito statico. La pubblicazione automatica sul progetto Vercel esistente è al momento bloccata dall'autorizzazione dell'integrazione Vercel (HTTP 403); il deployment attuale non è stato modificato.
