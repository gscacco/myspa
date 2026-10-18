# Audit UX e piano di verifica

**Data:** 18 ottobre 2026
**Ambito:** app `timetable/`, sorgenti, test e interfaccia servita localmente.
**Stato:** analisi; nessuna modifica all’applicazione.

## 1. Panoramica dell’applicazione

Chronos Engine è un’applicazione locale per costruire, importare, consultare e ricalcolare orari scolastici. I dati comprendono docenti, classi, materie, lezioni, aule facoltative e vincoli. Il calcolo produce una proposta; l’utente la rivede e la applica. EDN scambia l’intero progetto; OFD e CSV importano dati dalle schede pertinenti.

Gli utenti principali sono coordinatori dell’orario e personale scolastico che gestisce anagrafiche e vincoli. La loro familiarità con terminologia tecnica, strumenti digitali e regole dell’istituto va verificata con utenti reali.

### Struttura, avvio e test esistenti

- La UI è HTML/CSS/JavaScript modulare in `timetable/`; il modello, l’importazione, la validazione, il calcolo e le viste sono separati in moduli. `tools/build-timetable.js` produce una pagina HTML autonoma.
- Per lo sviluppo, `npm run dev` serve `/timetable/`; `npm run build:timetable` crea `dist/timetable.html`. Il README documenta anche l’apertura offline del file generato.
- I test sono per lo più Node test con DOM simulato da JSDOM: coprono dati, importazioni, vincoli, viste, calcolo, annullamento e build. `test:e2e:timetable` verifica l’artefatto autonomo con JSDOM; non equivale a un test end-to-end in un browser reale.
- `jsdom` ed `esbuild` sono dipendenze di sviluppo. Playwright è risolvibile nell’ambiente di lavoro, ma `@playwright/test` e `axe-core` non risultano disponibili. Non è stato installato nulla e non sono stati eseguiti i test di repository.
- Per la prova browser è stato usato Chromium con la pagina locale già disponibile su `127.0.0.1:8080/timetable/`. La guida esistente è [timetable/USABILITY.md](../timetable/USABILITY.md); il contratto e i limiti del modello sono descritti in [timetable/README.md](../timetable/README.md).

## 2. Attività principali

1. Importare un progetto EDN o importare anagrafiche/requisiti OFD e CSV, controllare l’anteprima e confermare o annullare.
2. Preparare da zero docenti, classi, materie e lezioni; impostare calendario e vincoli.
3. Avviare il calcolo, seguirne l’avanzamento, valutare la proposta e applicarla o annullarla.
4. Consultare l’orario per classe, docente o aula; aprire dettagli, seguire collegamenti e risolvere avvisi.
5. Modificare vincoli, annullare l’ultima modifica ed esportare il progetto per conservarlo o trasferirlo.

## 3. Evidenze e problemi UX

### Verificato nel browser

La pagina iniziale a 1440 px mostra una gerarchia coerente: navigazione persistente, intestazione della scuola e scheda di lavoro. La pagina Calcolo spiega i requisiti mancanti e offre collegamenti alle schede da completare. Ho importato `timetable/fixtures/conflict-demo.edn`, confermato il caricamento e visitato tutte le nove voci principali di navigazione, oltre a Impostazioni, EDN e Struttura e vincoli. In Impostazioni, con il pannello EDN aperto, ho osservato due pulsanti **Esporta EDN** contemporaneamente visibili. La pagina ha risposto HTTP 200; durante il percorso non ho osservato errori JavaScript né errori di pagina. È una prova esplorativa breve, non una misura di affidabilità generale.

Alla larghezza 390 px la pagina non ha overflow orizzontale complessivo. La barra di navigazione è invece più larga del viewport (`scrollWidth` 1127 px, area visibile 366 px) e si scorre orizzontalmente. Nello screenshot si vedono solo le prime tre voci. Il footer laterale non è visibile.

### Problemi prioritari

| Priorità | Evidenza e impatto | Attività coinvolta |
|---|---|---|
| **Alta** | **Importazione EDN non raggiungibile su viewport stretti.** Il pulsante che apre l’import/export EDN è nel footer della sidebar; a larghezza ≤820 px il CSS nasconde quel footer. Non compare un accesso alternativo all’importazione EDN nelle impostazioni. L’utente mobile non può importare un progetto intero. Evidenza: [index.html](../timetable/index.html#L19), [style.css](../timetable/css/style.css#L447). | Importare e trasferire un progetto da telefono/tablet. |
| **Alta** | **Conservazione del lavoro dipende dall’esportazione manuale.** L’interfaccia indica che i dati restano nella scheda; il README specifica che le modifiche sono in memoria fino all’export EDN. Nel codice dell’app non risultano `localStorage`, `sessionStorage` o IndexedDB. Una chiusura o ricarica può quindi perdere una sessione non esportata. L’indicazione esiste, ma è separata dal flusso di modifica e l’accesso all’export è meno visibile. Evidenza: [index.html](../timetable/index.html#L37), [README](../timetable/README.md). | Inserimento dati, modifica e calcolo di orari lunghi. |
| **Alta** | **Pannello dettagli non persistente.** Parte nascosto, appare dopo la selezione e offre un pulsante “Chiudi”. Questo interrompe il modello elenco/dettaglio: i dettagli non hanno una posizione costante e possono sparire. Evidenza: [index.html](../timetable/index.html#L260), [app.js](../timetable/js/app.js#L364). | Consultare e collegare docenti, classi, materie, lezioni e aule. |
| **Alta** | **Spiegazione del calcolo ambigua rispetto alle regole realmente applicate.** La maschera afferma che le proposte rispettano “i vincoli obbligatori”, poi dice che “il calcolo ignora le collisioni tra lezioni”. Il motore applica alcune regole come hard constraints; il testo sulla percentuale dovrebbe chiarire che esclude le collisioni dal punteggio, non dalla ricerca. Inoltre, diversi campi importati (per esempio distribuzione, ore minime/massime e collegamenti) sono conservati ma non interpretati dal motore. Evidenza: [index.html](../timetable/index.html#L105), [index.html](../timetable/index.html#L122), [timetable/README.md](../timetable/README.md). | Capire se un orario è valido e cosa misurano punteggio e percentuale. |
| **Alta** | **Manca un ritorno diretto al punto d’origine.** I collegamenti nei dettagli cambiano scheda e selezione; non c’è un comando “Torna a…” che ripristini esplicitamente l’elemento e il contesto da cui si è partiti. L’utente deve ricostruirlo dalla navigazione. Evidenza: [app.js](../timetable/js/app.js#L336). | Seguire un docente, una classe o un’aula collegati e riprendere il lavoro di prima. |
| **Media, segnalata dall’utente** | **Cursore non coerente con l’azione.** In alcune liste, in particolare Vincoli, il cursore suggerisce l’inserimento/modifica del testo anche quando la riga serve ad aprire i dettagli. Il CSS dà `pointer` alle righe `.selectable-detail-row`, mentre gli input restano campi editabili: va verificato il punto esatto in cui compare il cursore a I-beam e uniformata l’area cliccabile. Evidenza: segnalazione utente; [style.css](../timetable/css/style.css#L271), [style.css](../timetable/css/style.css#L276). | Capire a colpo d’occhio se un elemento apre dettagli o permette di modificare un valore. |
| **Media** | **Filtri di ricerca sovrapposti nelle tabelle.** Le schede offrono una ricerca generale e anche campi filtro per ciascuna colonna; in Vincoli sono una ricerca generale più quattro filtri di colonna. I filtri hanno ambiti diversi, quindi non sono duplicati perfetti, ma la UI non spiega quando usare l’uno o gli altri. Evidenza: [index.html](../timetable/index.html#L48), [school-workbench.js](../timetable/js/school-workbench.js#L119), [index.html](../timetable/index.html#L55). | Trovare un elemento senza dover interpretare più livelli di ricerca. |
| **Media** | **Azione di export duplicata nello stesso stato.** Quando Impostazioni mostra il riepilogo del progetto e il pannello EDN, sono visibili due pulsanti **Esporta EDN** che avviano la stessa esportazione. Verificato in Chromium con il fixture sintetico. Evidenza: [index.html](../timetable/index.html#L75), [index.html](../timetable/index.html#L92), [app.js](../timetable/js/app.js#L848). | Esportare il progetto senza chiedersi quale pulsante usare. |
| **Media** | **“Struttura e vincoli” riunisce troppe funzioni e duplica anagrafiche.** Oltre a riepilogo e ricerca, mostra elenchi di classi, docenti e aule già presenti nelle rispettive maschere, vincoli importati, parametri OFD conservati e un editor di vincoli. Il collegamento parte dalla vista Orario, che dovrebbe privilegiare la consultazione. Evidenza: [index.html](../timetable/index.html#L192), [index.html](../timetable/index.html#L202), [index.html](../timetable/index.html#L219). | Consultare l’orario o trovare e modificare una regola. |
| **Media** | **Navigazione mobile poco scopribile.** Nove voci sono contenute in una barra a scorrimento senza un’indicazione visibile che proseguano oltre le prime voci. Il layout non taglia la pagina, ma può nascondere le destinazioni secondarie. Evidenza: [style.css](../timetable/css/style.css#L447). | Trovare lezioni, aule, vincoli e impostazioni su telefono. |
| **Media, da validare** | **Annuncio dei cambi pagina con tecnologie assistive.** La navigazione usa pulsanti con `aria-pressed`; al cambio vista il contenuto viene nascosto/mostrato. Non ho svolto prove con screen reader per verificare che la nuova intestazione e il contesto risultino chiari. Servono test con tastiera e screen reader. Evidenza: [index.html](../timetable/index.html#L19). | Navigare tra schede senza mouse. |
| **Bassa, da validare** | **Testi secondari piccoli nelle viste dense.** Il CSS usa dimensioni 10–12 px per etichette e informazioni accessorie. La schermata iniziale è leggibile nello screenshot desktop, ma la leggibilità con zoom, bassa vista e dati reali non è stata misurata. Evidenza: [style.css](../timetable/css/style.css#L357). | Leggere tabelle, stato e dettagli con orari numerosi. |

### Aspetti positivi verificati o supportati dal codice

- La schermata Calcolo indica i prerequisiti mancanti e rende il comando inattivo finché i dati richiesti non sono presenti.
- Quando una riga è selezionata, il pannello dettagli si apre automaticamente e mostra collegamenti agli elementi correlati. Oggi però resta nascosto prima della selezione e può essere chiuso: manca una colonna dettagli stabile con uno stato iniziale vuoto.
- L’import EDN è predisposto per anteprima e conferma esplicita; i test JSDOM coprono annullamento e conservazione dei dati in caso di import non valido.
- La proposta di ricalcolo resta separata dall’applicazione; esistono controlli per fermare il calcolo e annullare modifiche.
- Sono presenti `lang="it"`, landmark semantici, label, testi di stato `aria-live` e stili `:focus-visible`. Sono buone basi, non una certificazione di accessibilità.
- L’interfaccia mantiene stile e nomenclatura visiva coerenti. Il marchio mostrato è “Chronos Engine”; va verificato con il proprietario del prodotto se corrisponde al nome atteso dagli utenti.

## 4. Metriche e criteri di accettazione

**Baseline:** non misurata per i task con utenti. Il solo rilievo quantitativo browser è la larghezza della navigazione a 390 px riportata sopra. Zero errori JS è l’esito di una singola sessione esplorativa, non una baseline statistica. I target sotto sono proposte, non risultati.

| Metrica | Misura | Baseline | Target proposto e motivazione | Automazione |
|---|---|---|---|---|
| Completamento task | Percentuale di utenti che completa ogni task senza aiuto e senza perdita di dati | Da rilevare | ≥90% per ciascun task critico; gli errori di perdita dati devono essere 0. | Richiede utenti reali; E2E verifica gli esiti tecnici. |
| Interazioni | Click, input e cambi schermata fino al completamento, contando separatamente gli errori | Da rilevare | Ridurre del 20% la mediana dei task risultati inutilmente complessi, senza ridurre comprensione o correttezza. | Conteggi E2E; utilità da validare con utenti. |
| Tempo task | Tempo dalla consegna alla conclusione corretta | Da rilevare | Dopo la baseline, ridurre del 20% la mediana nei task più lenti, mantenendo completamento e accuratezza. | Cronometrabile; interpretazione con utenti. |
| Presenza e utilità dei dettagli | Dopo ogni selezione, verificare che il pannello resti visibile e mostri i dati dell’elemento corretto; chiedere agli utenti di seguire un collegamento correlato | Non misurata; il codice attuale lo apre solo dopo la selezione e consente di chiuderlo | Dettagli visibili nel 100% delle viste elenco/dettaglio; ≥90% degli utenti trova il dato o il collegamento richiesto senza aiuto. | Presenza e aggiornamento automatizzabili; utilità richiede utenti. |
| Ritorno al contesto | Seguire un collegamento da un dettaglio e tornare alla lista/scheda d’origine; controllare selezione, filtri e posizione | Nessun ritorno diretto esposto nel flusso corrente | 100% dei ritorni ripristina il contesto di partenza senza doverlo ricercare. | Automatizzabile in E2E; facilità d’uso da confermare con utenti. |
| Comprensione delle spiegazioni | Dopo aver letto le maschere, chiedere quali regole sono hard, cosa significa il punteggio e se i campi importati vengono applicati | Non misurata | ≥90% di risposte corrette sulle informazioni che possono cambiare una decisione; correggere testi che inducono errori. | Testo/elementi verificabili; comprensione richiede utenti. |
| Cursore e azione | Passare il mouse su righe cliccabili e campi modificabili; confrontare cursore e risultato del click | Segnalazione in Vincoli da riprodurre; non misurata altrove | Tutte le aree di sola selezione indicano click; solo i controlli realmente editabili mostrano il cursore di testo o selezione. | Verifica CSS/browser automatizzabile, controllo di coerenza manuale. |
| Ridondanza dei controlli | Contare azioni identiche nello stesso stato e verificare se gli utenti distinguono ricerca generale e filtri per colonna | Due export EDN visibili insieme; ricerche generale/per-colonna presenti nelle tabelle | Un solo comando primario per la stessa azione; filtri dettagliati presentati come avanzati o mantenuti solo dove gli utenti li usano. | Conteggio automatizzabile; utilità dei filtri da validare con utenti. |
| Errori e recupero | Errori di importazione/modifica e percentuale di recupero senza ripetere tutto | Da rilevare | 100% dei percorsi di errore conserva i dati correnti e permette di riprovare o annullare. | E2E su fixture valide e invalide. |
| Accessibilità automatica | Violazioni axe per gravità sulle schermate e viewport principali | Non misurata | Zero violazioni critiche/serie; ogni violazione minore documentata o corretta. | Axe automatizzabile; tastiera e screen reader richiedono prova manuale. |
| Errori browser | Eccezioni JS non gestite, errori console e richieste fallite non previste durante i flussi | Una prova: 0 errori osservati | Zero nei flussi E2E ripetibili; gli errori attesi di input invalido non devono essere eccezioni non gestite. | Automatizzabile con Playwright. |
| Reattività del calcolo | Tempo al primo feedback e intervallo massimo senza aggiornamento durante una ricerca lunga | Da rilevare | Primo feedback entro 2 s e nessun silenzio superiore a 5 s; rende osservabile un processo lungo. | Automatizzabile con fixture di benchmark; soglie da verificare su PC di riferimento. |
| Layout e regressioni visive | Screenshot a 390, 768 e 1440 px; overflow non intenzionale e differenze non approvate | Screenshot esplorativi, nessuna baseline approvata | Zero overflow del documento; consentire solo scroll documentato in nav, tabelle e calendario. Differenze visive solo dopo revisione. | Screenshot Playwright e test layout. |

## 5. Strumenti e strategia di test

| Strumento | Valutazione |
|---|---|
| **Playwright Test** | Beneficio alto: veri browser, flussi completi, tastiera, viewport, download/export, console e screenshot. Il progetto ha test DOM simulati ma non un runner browser; `@playwright/test` non è dichiarato né disponibile. Aggiungerlo richiederebbe una dipendenza/configurazione, da valutare dopo approvazione. |
| **axe-core** | Beneficio alto per trovare problemi WCAG automatici su schermate e stati principali. Non è disponibile. Non misura usabilità e non sostituisce tastiera, zoom, screen reader o utenti con disabilità. |
| **Screenshot/regressione visiva** | Playwright può fissare schermate stabili dei fixture a viewport concordate. Le baseline vanno approvate da una persona; non fotografare dati scolastici sensibili. Nessuna baseline visiva ufficiale esiste oggi. |
| **Errori e operazioni fallite** | In ogni test raccogliere `pageerror`, messaggi console di errore e richieste fallite; assert su stato e dati dopo import/applica/annulla. Escludere solo fallimenti deliberati e documentati. |
| **Test Node/JSDOM esistenti** | Mantenerli per dominio, validazione e velocità. Non usarli come prova di layout reale, accessibilità, reattività del browser o compatibilità mobile. |

### Suite minima proposta

1. Avvio nuovo progetto, compilazione dei dati minimi, prerequisiti del calcolo e passaggio alle viste.
2. Import EDN valido: anteprima, conferma, navigazione; import invalido e annullamento: dati precedenti invariati. Verificare anche l’accesso da viewport mobile.
3. Import OFD/CSV contestuale: anteprima, validazione di riferimenti mancanti, annullamento e applicazione senza sovrascrivere dati non selezionati.
4. Selezionare ogni tipo di elemento e verificare che il pannello dettagli sia già presente, mostri un invito quando non c’è selezione, si aggiorni alla selezione e non abbia un comando di chiusura; ripetere in Orario e su mobile.
5. Passare il mouse sulle righe cliccabili e sui campi editabili di Vincoli e delle altre liste: verificare che la mano identifichi l’apertura dei dettagli e il cursore di testo compaia solo nei controlli modificabili.
6. Nelle tabelle confrontare ricerca generale e filtri di colonna; in Impostazioni verificare che l’export abbia un solo accesso visibile per stato e che continui a funzionare.
7. Da un dettaglio seguire collegamenti a un’altra entità e tornare indietro; verificare ripristino di scheda, elemento, filtri, posizione di scorrimento e focus.
8. Fixture `conflict-demo.edn`: individuazione del conflitto, calcolo di una proposta, applicazione e annullamento; verificare integrità dei vincoli rigidi.
9. Ricerca lunga: vedere avanzamento, fermare la ricerca e verificare che l’orario corrente non cambi; poi applicare solo una proposta completa.
10. Percorso tastiera per navigazione, tabelle, dettagli, dialoghi/confirm e griglia orario; axe su Docenti, Lezioni, Vincoli, Calcolo, Orario e Impostazioni.
11. Screenshot e controllo layout a 390, 768 e 1440 px con fixture sintetico; controllo errori JS e richieste durante ciascun flusso.

Per misurare prestazioni usare fixture sintetici riproducibili e anche il campione grande solo come prova separata. Registrare hardware/browser, seed, tempo alla prima soluzione valida, tempo totale, cancellazioni, qualità e percentuale di run riuscite. I test non devono dipendere da un punteggio casuale esatto.

## 6. Piano di miglioramento prioritario

| Ordine | Problema e proposta | Beneficio atteso | Impegno | Rischio regressione | Verifica |
|---|---|---|---|---|---|
| 1 | Rendere il pannello dettagli una colonna persistente nelle viste elenco e Orario. Mostrare un invito iniziale e rimuovere “Chiudi”; su schermi stretti mantenere i dettagli sempre raggiungibili sotto l’elenco. | Stabilizza il modello elenco/dettaglio e rende immediato il contesto selezionato. | Medio | Medio, interessa layout, selezione e navigazione mobile. | Selezionare e collegare tutte le entità; verificare aggiornamento, stato vuoto, tastiera e viewport stretti. |
| 2 | Aggiungere un ritorno contestuale dai collegamenti nei dettagli: ripristinare la scheda, l’elemento selezionato, i filtri e la posizione da cui è partito il salto. | Evita di perdere il filo mentre si esplorano elementi correlati. | Medio | Medio, riguarda stato di navigazione e focus. | E2E su catene docente→lezione→classe e test con lista filtrata. |
| 3 | Correggere le spiegazioni di Calcolo: distinguere i vincoli rigidi effettivamente supportati dalle regole conservate ma non applicate; precisare che il punteggio percentuale misura le preferenze e non i conflitti. | Evita decisioni basate su una lettura errata della validità o qualità. | Basso | Basso | Revisione con responsabile del modello e test di comprensione con utenti. |
| 4 | Semplificare “Struttura e vincoli”: in Orario lasciare un riepilogo breve e collegamenti alle schede dedicate; rimuovere gli elenchi duplicati di classi, docenti e aule; mantenere vincoli in Vincoli e dati OFD in una sezione avanzata delle Impostazioni/importazione. | Riduce duplicazioni e mantiene Orario orientato alla consultazione. | Medio/alto | Medio, occorre preservare percorsi e strumenti esistenti. | Task per trovare un docente, modificare un vincolo e capire i dati non applicati; confrontare tempo e completamento. |
| 5 | Semplificare i filtri: mantenere una ricerca generale evidente e raccogliere i filtri per colonna in “Filtri avanzati” o toglierli dalle tabelle dove non servono; lasciare una sola azione Esporta EDN visibile nello stesso stato. | Riduce la duplicazione percepita senza togliere capacità di ricerca utile. | Basso/medio | Basso, rischio di rendere meno accessibile un filtro specializzato. | Test di ricerca su docenti, lezioni e vincoli; verifica export con singolo comando. |
| 6 | Uniformare il cursore: mano sulle aree che aprono dettagli, cursore di testo solo su campi realmente modificabili; verificare Vincoli e tutte le liste. | Rende prevedibile l’effetto del click e riduce tentativi di modifica involontari. | Basso | Basso | Controllo computed-style in browser e prova manuale di click sulle righe e sui campi. |
| 7 | Rendere importazione EDN accessibile anche da mobile e tablet, collocandola in un’area sempre raggiungibile. | Permette di aprire progetti su ogni dispositivo supportato. | Basso | Basso | Playwright a 390/768 px; import valido, invalido e annullato. |
| 8 | Rendere esplicito lo stato non salvato e l’azione di esportazione nelle viste operative; valutare con l’utente un recupero locale o un avviso prima di perdere la sessione. | Riduce la perdita di dati e la ricerca del comando salva. | Medio | Medio, coinvolge ciclo di vita e compatibilità offline. | Prova reload/chiusura, export/reimport e sessione annullata; chiedere preferenza agli utenti prima di introdurre persistenza automatica. |
| 9 | Migliorare la scoperta della navigazione mobile e aggiungere test browser, axe, raccolta errori e screenshot. | Riduce sezioni non trovate e regressioni visuali, operative e accessibili. | Medio | Basso/medio, costo di manutenzione delle baseline. | Task “apri Vincoli/Lezioni”; suite browser e baseline screenshot approvate. |
| 10 | Verificare leggibilità del testo secondario, zoom e passaggio tra schede con tastiera/screen reader; osservare il task di calcolo con utenti reali. | Migliora lettura, orientamento e comprensione della ricerca. | Medio | Basso/medio | Sessioni con zoom 200%, tastiera e screen reader; misurare feedback, arresti e comprensione hard/soft. |

## 7. Limiti e domande per la validazione

- Non ho svolto sessioni con coordinatori scolastici né prove con tecnologie assistive; usabilità, leggibilità e comprensione dei punteggi restano da validare.
- La prova visuale ha coperto schermata vuota, stato di calcolo senza requisiti e fixture EDN sintetico; non ho eseguito una ricerca lunga né caricato il progetto OFD reale nel browser.
- Non ho eseguito la suite corrente; non riporto quindi risultati di test automatizzati del repository.
- Va chiarito se il nome “Chronos Engine” è intenzionale e quali dispositivi siano ufficialmente supportati.
- Va validato che la colonna dettagli debba restare visibile in tutte le schede che hanno un elemento selezionabile; la proposta mantiene una guida vuota quando non c’è selezione.
- Va chiesto agli utenti se il riepilogo completo della struttura serve durante la consultazione dell’orario o se basta un link alle schede anagrafiche, ai vincoli e ai dati importati.
- Gli utenti preferiscono salvataggio automatico locale, avviso di modifiche non esportate o export manuale? Quali dati scolastici possono essere memorizzati sul dispositivo?
- Quali browser, dimensioni schermo e tecnologie assistive devono rientrare nei criteri di supporto?
- Quale tempo di attesa è accettabile per il calcolo sul computer tipico della scuola? Gli utenti capiscono la differenza tra vincoli rigidi, preferenze e punteggio?

**Passo successivo proposto:** approvare il piano, raccogliere una baseline breve con 3–5 coordinatori sui task più importanti, poi decidere priorità e criteri finali prima di modificare codice o aggiungere dipendenze.
