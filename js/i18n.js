// MDR V54.0.51 – bilingual UI layer (DE/EN)
// Internal database/parser keys intentionally remain unchanged.
(() => {
  'use strict';

  const STORAGE_KEY = 'mdr-ui-language-v1';
  const SUPPORTED = new Set(['de', 'en']);
  let lang = (() => {
    try {
      const stored = String(localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
      return SUPPORTED.has(stored) ? stored : 'de';
    } catch { return 'de'; }
  })();

  const EN = {
    // App / navigation
    'MDR Pferdedatenbank':'MDR Horse Database',
    '🐴 MDR Pferdedatenbank':'🐴 MDR Horse Database',
    '🐴 Datenbank':'🐴 Database',
    '➕ Neues Pferd':'➕ New horse',
    '📊 Dashboard':'📊 Dashboard',
    '🐴 Zuchtplaner':'🐴 Breeding planner',
    '💞 Verpaarungslog':'💞 Pairing log',
    '💞 Verpaarungs-Log':'💞 Pairing log',
    '🏆 Turnier & Leistung':'🏆 Competition & performance',
    '🧹 Aussortierhilfe':'🧹 Selection helper',
    '📖 Guide':'📖 Guide',
    '📖 MDR-Guide':'📖 MDR guide',
    '⚙️ Einstellungen':'⚙️ Settings',
    '🌾 Futterabo':'🌾 Feed plan',
    'Anmelden':'Sign in',
    'Abmelden':'Sign out',
    'Zurück':'Back',
    'Nach oben':'Back to top',

    // Titles
    'Pferde – MDR Pferdedatenbank – Lokal':'Horses – MDR Horse Database – Local',
    'Pferd – MDR Pferdedatenbank – Lokal':'Horse – MDR Horse Database – Local',
    'Pferd ansehen – MDR Pferdedatenbank – Lokal':'View horse – MDR Horse Database – Local',
    'Dashboard – MDR Pferdedatenbank':'Dashboard – MDR Horse Database',
    'Einstellungen – MDR Pferdedatenbank':'Settings – MDR Horse Database',
    'Futterabo – MDR Pferdedatenbank':'Feed plan – MDR Horse Database',
    'Anmelden – MDR Pferdedatenbank':'Sign in – MDR Horse Database',
    'Guide – MDR Pferdedatenbank':'Guide – MDR Horse Database',
    'Zuchtplaner – MDR Lokal':'Breeding planner – MDR Local',
    'Turnier & Leistung – MDR Lokal':'Competition & performance – MDR Local',
    'Aussortierhilfe – MDR Lokal':'Selection helper – MDR Local',
    'Lokal – Verpaarungs-Log – MDR Pferdedatenbank':'Local – Pairing log – MDR Horse Database',

    // General controls
    'Alle':'All', 'Aus':'Off', 'An':'On', 'Ja':'Yes', 'Nein':'No', 'unbekannt':'unknown',
    'optional':'optional', '(optional)':'(optional)', 'Egal':'Any', 'Lade…':'Loading…',
    'Bitte wählen…':'Please select…', 'Bitte auswählen…':'Please select…',
    'Auswählen':'Select', 'Speichern':'Save', 'Eintragen':'Add', 'Anwenden':'Apply',
    'Abbrechen':'Cancel', 'Löschen':'Delete', 'Entfernen':'Remove', 'Hinzufügen':'Add',
    'Zurücksetzen':'Reset', 'Berechnen':'Calculate', 'Auslesen':'Parse',
    'Automatisch auslesen':'Parse automatically', 'Neu einlesen':'Re-read',
    'Pferd neu einlesen':'Re-read horse', 'Überspringen':'Skip', 'Rückgängig':'Undo',
    '↶ Rückgängig':'↶ Undo', 'Sortieren':'Sort', 'aufsteigend':'ascending', 'absteigend':'descending',
    'größer als':'greater than', 'kleiner als':'less than', 'mindestens':'at least', 'unter':'below',
    'besser ·':'better ·', 'gleich ·':'equal ·', 'schlechter':'worse',
    'Alle auswählen':'Select all', 'Alle abwählen':'Deselect all', 'Alle markieren':'Select all',
    'Alle Filter löschen':'Clear all filters', 'Filter zurücksetzen':'Reset filters',
    'Filter wirken sofort.':'Filters apply immediately.',
    'Vorlage laden…':'Load preset…', '💾 Als Vorlage speichern':'💾 Save as preset',
    'Name für diese Filter-Vorlage:':'Name for this filter preset:',

    // Common fields
    'Name':'Name', 'Name *':'Name *', 'ID':'ID', 'MDR-ID:':'MDR ID:', 'Alter':'Age',
    'Besitzer':'Owner', 'Besitzername':'Owner name', 'Züchter':'Breeder', 'Rasse':'Breed',
    'Geschlecht':'Sex', 'Stute':'Mare', 'Hengst':'Stallion', 'Wallach':'Gelding',
    'Hengstfohlen':'Colt', 'Stutfohlen':'Filly', 'Fohlen':'Foal', 'Stuten':'Mares', 'Hengste':'Stallions',
    'Fellfarbe':'Coat colour', 'Farbe':'Colour', 'Geburtsdatum':'Date of birth',
    'Bild':'Image', 'Bild-URL':'Image URL', 'Notizen':'Notes', 'Sonstiges':'Other',
    'Spielversion':'Game version', 'Stammdaten':'Basic data', 'Verwaltung':'Management',
    'Papiere & Zucht':'Papers & breeding', 'Stammbaum':'Pedigree',
    'Rasseanteile':'Breed composition', 'Reinrassigkeit (%)':'Purebred (%)',
    'Zuchtziel':'Breeding goal', 'Zuchtstation':'Breeding station', 'In Zuchtstation':'In breeding station',
    'In Zuchtstation?':'In breeding station?', 'Zuchtzulassung':'Breeding licence',
    'Mit Zuchtzulassung':'With breeding licence', 'Keine Zuchtzulassung':'No breeding licence',
    'Mit ZZL':'With licence', 'Ohne ZZL':'Without licence',
    'Decktaxe':'Stud fee', 'Leer = kostenlos':'Blank = free', 'Leer bedeutet kostenlos.':'Blank means free.',
    'kostenlos':'free', 'leer = kostenlos':'blank = free', 'HLP/SLP':'Performance test', 'ICO (%)':'COI (%)',

    // Feed plan / Futterabo
    'Futterabo':'Feed plan', 'Futterabo aktivieren':'Enable feed plan', '🌾 Futterabo öffnen':'🌾 Open feed plan',
    'Bestellrhythmus':'Order interval', 'Wöchentlich (7 Tage)':'Weekly (7 days)', 'Monatlich (30 Tage)':'Monthly (30 days)',
    'Mein MDR-Name':'My MDR username', 'Wird pro Supabase-Login gespeichert. Du kannst einen vorhandenen Besitzer auswählen oder einen neuen Namen frei eintragen.':'Saved separately for each Supabase login. You can select an existing owner or freely enter a new name.',
    'z. B. Anevay':'e.g. Anevay',
    'Futterbedarf & Rhythmus-Erinnerung':'Feed requirements & schedule reminder',
    '✓ Bestellung als erledigt markieren':'✓ Mark order as completed',
    'Empfohlene Bestellmenge':'Recommended order quantity', 'Futterart':'Feed type', 'Bestellmenge':'Order quantity',
    'Preis je Einheit':'Price per unit', 'Kosten':'Cost', 'Gesamtkosten':'Total cost',
    'Zuordnung der Pferde':'Horse assignments', 'Verwendete Futterregeln':'Feed rules used',
    'Aktive Züchter':'Active breeders', 'Berücksichtigte Pferde':'Included horses', 'Nächste Erinnerung':'Next reminder',
    'Fohlen Standard':'Foal Standard', 'Aufzucht Futter':'Youngstock', 'Zuchtstuten Standard':'Broodmare Standard',
    'Deckhengste Standard':'Stallion Standard', 'Kombifutter Turnier':'Combo Competition', 'Sportpferde Gold':'Performance Gold',
    'Heu':'Hay', 'Stroh':'Straw', 'Ballen':'bales', 'Einheiten':'units', 'Heute fällig':'Due now',
    'Futterbestellung fällig':'Feed order due', 'Futterabo ist ausgeschaltet.':'Feed plan is disabled.',
    'Optionale Rhythmus-Erinnerung für deinen eigenen MDR-Bestand. Das Futterabo ist an den aktuellen Login gebunden und unabhängig von der Auswahl „Aktive Züchter“. Die MDR-Seite wird nicht automatisch bedient.':'Optional schedule reminder for your own MDR horses. The feed plan is tied to the current login and independent of the “Active breeders” selection. The MDR site is not controlled automatically.',
    'Berücksichtigt ausschließlich Pferde, deren Besitzer deinem unten hinterlegten MDR-Namen entspricht.':'Includes only horses whose owner matches the MDR username configured below.',
    'Die Berechnung verwendet ausschließlich Pferde des MDR-Namens, der für deinen aktuellen Login in den Einstellungen hinterlegt ist. Die Auswahl „Aktive Züchter“ hat darauf keinen Einfluss. Es wird nichts automatisch auf Morning Dust Ranch bestellt.':'The calculation uses only horses belonging to the MDR username configured for your current login. The “Active breeders” selection has no effect on the feed plan. Nothing is ordered automatically on Morning Dust Ranch.',
    'Kraftfutter: 1 Einheit je Pferd und Tag. Heu und Stroh: 1 Ballen = 30 Pferdetage; Ballenmengen werden immer aufgerundet.':'Concentrated feed: 1 unit per horse per day. Hay and straw: 1 bale = 30 horse-days; bale quantities are always rounded up.',
    'Hier kannst du prüfen, welche Pferde welcher Futterregel zugeordnet wurden.':'Here you can check which horses were assigned to which feed rule.',
    'Aktiviere es unter Einstellungen, um Bedarf und Rhythmus-Erinnerung zu verwenden.':'Enable it under Settings to use requirements and schedule reminders.',

    'Benutzername oder E-Mail':'Username or email',

    // Filters / database
    '🔎 Filter ·':'🔎 Filters ·', 'Suche':'Search', 'Suche…':'Search…',
    'Name · Besitzer · Rasse':'Name · Owner · Breed', 'Datenqualität':'Data quality',
    '🟢 Vollständig':'🟢 Complete', '🟡 Teilweise vollständig':'🟡 Partly complete', '🔴 Unvollständig':'🔴 Incomplete',
    'Vollständig:':'Complete:', 'Teilweise vollständig:':'Partly complete:', 'Unvollständig:':'Incomplete:',
    '🧠 Lerndatei':'🧠 Learning file', 'Lerndatei':'Learning file', 'Ausblenden':'Hide',
    'Nur Lerndatei':'Learning file only', 'Schlagwörter':'Tags', 'Schlagwörter auswählen:':'Select tags:',
    '1× einschließen · 2× ausschließen · 3× neutral':'1× include · 2× exclude · 3× neutral',
    'Zucht':'Breeding', 'Geschlecht · ZZL · Nachkommen':'Sex · licence · offspring',
    'Nachkommen':'Offspring', 'Bestes Fohlen':'Best foal', '★ Bestes Fohlen: Aus':'★ Best foal: Off',
    'Klick: Aus → nur anzeigen → ausschließen':'Click: off → show only → exclude',
    'Genetik & Gesundheit':'Genetics & health', 'Genetik · EKH':'Genetics · hereditary diseases',
    'Genetik':'Genetics', 'EKH':'Hereditary diseases', 'Leistungswerte':'Performance values',
    'Hauptbegabung':'Main talent', 'Unterkategorie':'Subcategory', '⭐ Cup-Stern':'⭐ Cup star',
    'Nur Pferde mit bestätigtem Cup-Stern':'Only horses with a confirmed Cup star',
    'Ø-Vergleich anzeigen':'Show average comparison', 'Rasse (Basis)':'Breed (baseline)',
    'ZZL (Basis)':'Licence (baseline)', 'Besitzer (Basis)':'Owner (baseline)', 'Geschlecht (Basis)':'Sex (baseline)',
    'Aktive Filter':'Active filters', '0 aktiv · – Pferde':'0 active · – horses',
    'Pferd suchen':'Search horse', 'Freitextsuche':'Free-text search',

    // Data / quality / statuses
    'Pferd':'Horse', 'Pferde':'Horses', 'Anzahl Pferde':'Number of horses',
    'Keine Änderung':'No change', 'Nicht erfasst':'Not recorded', 'Bereits vorhanden':'Already present',
    'Möglicherweise bereits vorhanden':'Possibly already present', 'relevante Datenlücken bestehen.':'relevant data gaps remain.',
    'Unvollständige Daten':'Incomplete data', 'Für vollständige Daten:':'For complete data:',
    'Beim Speichern fehlt Folgendes:':'The following is missing when saving:',
    'Änderungen prüfen':'Review changes', 'Was aktualisieren?':'What should be updated?',
    'Vorhandenes aktualisieren':'Update existing', 'Ja, aktualisieren':'Yes, update',
    'Nein, neu anlegen':'No, create new', 'Trotzdem speichern':'Save anyway',
    'Vorhandenes Pferd öffnen':'Open existing horse',

    // Breeding values
    'GP':'GP', 'Ext':'Conformation', 'Ext%':'Conformation %', 'Int':'Temperament',
    'Ø GP':'Ø GP', 'Ø Ext':'Ø Conformation', 'Ø Ext%':'Ø Conformation %', 'Ø Int':'Ø Temperament',
    'GP (Gesamtpotenzial)':'GP (overall potential)', 'Ext (Körperbau)':'Conformation',
    'Ext% (genetisch)':'Conformation % (genetic)', 'Int (Interieur)':'Temperament',
    'GP mindestens':'GP at least', 'Ext höchstens':'Conformation at most',
    'Ext% mindestens':'Conformation % at least', 'Int höchstens':'Temperament at most',
    'Genetik = GP + Ext%':'Genetics = GP + Conformation %', 'Exterieur = Ext':'Conformation = Ext',
    'Interieur = Int':'Temperament = Int', 'Turnier = Turnierwerte':'Competition = competition values',
    'Zielwerte je Schwerpunkt:':'Target values by focus:', 'Zielwerte leeren':'Clear target values',
    'Eigene Zielwerte (optional)':'Custom target values (optional)', 'Schwerpunkt':'Focus',
    'Schwerpunkt & Partnerfilter':'Focus & partner filters', '2. Kriterium':'2nd criterion',
    'Gewichtung 1. Kriterium (%)':'Weight of 1st criterion (%)',
    'Bester Best Case':'Best best case', 'Bester Worst Case':'Best worst case',
    'Bester Ausgleich der Schwächen':'Best weakness compensation',
    'Kombinierter Ausgleich (2 Kriterien)':'Combined compensation (2 criteria)',
    'Beste Datenbank-Schätzung':'Best database estimate',
    'Kleinste Differenz (verlässlich)':'Smallest difference (reliable)',
    'Größte Differenz (Risiko/Chance)':'Largest difference (risk/opportunity)',
    'Datenbank-Schätzung':'Database estimate', 'Abweichung zur Datenbank-Schätzung':'Deviation from database estimate',
    'DB-Bereich getroffen?':'DB range hit?', 'DB-Prognose Grundwert':'DB baseline forecast',

    // Genetics
    'Erbkrankheiten':'Hereditary diseases', 'Erbkrankheit vorhanden':'Hereditary disease present',
    'frei von Erbkrankheiten':'free of hereditary diseases', 'Gentest vollständig':'Genetic test complete',
    'Exterieur':'Conformation', 'Interieur':'Temperament', 'Flaxen-Träger (fl)?':'Flaxen carrier (fl)?',
    '🐆 Sichtbares Appaloosa-Muster':'🐆 Visible Appaloosa pattern', 'Appaloosa-Muster':'Appaloosa pattern',
    '🐆 Appaloosa-Muster bevorzugen':'🐆 Prefer Appaloosa pattern', 'anderes / unklar':'other / unclear',
    'Sichtbarer Phänotyp, kein Gentest.':'Visible phenotype, not a genetic test.',
    'Grundfarbe':'Base colour', 'Grundfarbe bevorzugen':'Prefer base colour', 'Keine Präferenz':'No preference',
    '🎨 Zusatzwünsche':'🎨 Additional preferences', '🎨 Weitere Farbwünsche (optional)':'🎨 Further colour preferences (optional)',
    '🎨 Farbgenetik':'🎨 Colour genetics', '🎨 Farbgenetik:':'🎨 Colour genetics:',

    // Disciplines/groups
    'Disziplin':'Discipline', 'Disziplinen':'Disciplines', 'Alle Disziplinen':'All disciplines',
    'Alle Disziplinen öffnen und neu einlesen':'Open all disciplines and re-read',
    'Gruppe':'Group', 'Alle Gruppen':'All groups', 'Bestimmte Disziplin':'Specific discipline',
    'Englisch':'English', 'Rennen':'Racing', 'Fahren':'Driving', 'Barock':'Baroque',
    'Mehrgang':'Gaits', 'Rodeo':'Rodeo', 'Western':'Western',

    // Tournament
    'Turnier':'Competition', 'Turniere':'Competitions', 'Turnierwerte':'Competition values',
    'Turnierwert':'Competition value', 'Turnierdaten aus der Pferdeseite':'Competition data from the horse page',
    '🏆 Turnierplanung':'🏆 Competition planner', 'Turnierplanung':'Competition planning',
    'Turniereignung':'Competition suitability', 'Bestand vergleichen':'Compare stock',
    '⚙️ Turniergrenzen':'⚙️ Competition thresholds', 'Nebendisziplin ab Punkten':'Secondary discipline from points',
    'Punkte':'Points', 'Punkte mindestens':'Points at least', 'Starts':'Starts', 'Siege':'Wins',
    'Erfolge':'Results', 'Cups & Erfolge':'Cups & results', '⭐ Cups & Erfolge':'⭐ Cups & results',
    'Cup-Stern':'Cup star', 'Cup-Stern:':'Cup star:', 'Cupstern':'Cup star', 'Ohne Cup-Stern':'Without Cup star',
    'Cup-LK':'Cup level', '📅 Cup-Kalender':'📅 Cup calendar', 'Cup-Kalender wird geladen…':'Loading Cup calendar…',
    '🐴 Cup-Pferdeliste':'🐴 Cup horse list', 'Pferd / Besitzer':'Horse / owner', '7–14 Siege':'7–14 wins',
    'MDR-Cup Qualifikation':'MDR Cup qualification', '⭐ MDR-Cup-Status':'⭐ MDR Cup status',
    '🏆 Turnierprofil':'🏆 Competition profile', '🏆 Turnierzucht':'🏆 Competition breeding',
    'Turnierzucht berücksichtigen':'Include competition breeding', 'Turnierstarts gesamt':'Total competition starts',
    'Turniere gelaufen':'Competitions completed', 'Einordnung':'Assessment',

    // Breeding planner / pairings
    'Partner finden':'Find partner', '💡 Partner finden':'💡 Find partner',
    'Verpaarungsvergleich':'Pairing comparison', '⚖️ Verpaarungsvergleich':'⚖️ Pairing comparison',
    'Gemerkte Verpaarungen':'Saved pairings', '⭐ Gemerkte Verpaarungen':'⭐ Saved pairings',
    'Noch nichts gemerkt.':'Nothing saved yet.', 'Ausgangspunkt':'Starting horse', 'Ausgangspferd':'Starting horse',
    'Stute → beste Hengste':'Mare → best stallions', 'Hengst → beste Stuten':'Stallion → best mares',
    '♀ Stute':'♀ Mare', '♂ Hengst':'♂ Stallion', 'Stute auswählen':'Select mare', 'Hengst auswählen':'Select stallion',
    'Hengst-Rasse':'Stallion breed', 'Hengst-Besitzer':'Stallion owner',
    'Fremder Hengst (Freitext)':'External stallion (free text)',
    'Pferdeseite des fremden Hengstes':'Horse page of the external stallion',
    'Decktaxe / Decksprungkosten':'Stud fee / breeding fee',
    'Gewünschte Begabung (optional)':'Desired talent (optional)',
    'Gegenpartner 1':'Partner 1', 'Gegenpartner 2':'Partner 2', 'Gegenpartner 3':'Partner 3',
    'Rasse Gegenpartner':'Partner breed', 'Rasse Ausgangspferd':'Starting horse breed',
    'Hauptdisziplin des Ausgangspferdes':'Main discipline of starting horse',
    '1 Hengst + bis zu 3 Stuten':'1 stallion + up to 3 mares', '1 Stute + bis zu 3 Hengste':'1 mare + up to 3 stallions',
    'Zusatzwünsche wie':'Additional preferences such as',

    // Pairing log
    'Neue Verpaarung eintragen':'Add new pairing', 'Aktuelle Verpaarungen':'Current pairings',
    'Vergangene Verpaarungen':'Past pairings', 'Neueste Geburt zuerst':'Newest birth first',
    'Deckhengst':'Stallion', 'Deckhengst *':'Stallion *', 'Stute *':'Mare *',
    'Abfohldatum':'Foaling date', 'Nächstes Abfohldatum:':'Next foaling date:',
    'Fohlen behalten?':'Keep foal?', '? Offen':'? Open', '✓ Ja':'✓ Yes', '✗ Nein':'✗ No',
    'Fohlen geboren':'Foal born', 'Fohlen eintragen':'Add foal', 'Vorhandenes Fohlen':'Existing foal',
    'Vorhandenes Fohlen verknüpfen':'Link existing foal',
    'Fohlen bereits in Datenbank?':'Foal already in database?',
    '🐴 Fohlen ist bereits in der Datenbank':'🐴 Foal is already in the database',
    'oder Fohlendaten neu eintragen':'or enter new foal data',
    'Prognose ↔ tatsächlich':'Forecast ↔ actual', 'Zuchtempfehlung':'Breeding recommendation',
    '🚦 Zuchtempfehlung für geborene Fohlen':'🚦 Breeding recommendation for born foals',
    'Grün – behalten':'Green – keep', 'Orange – prüfen':'Orange – review', 'Rot – aussortieren empfohlen':'Red – culling recommended',
    '📦 Ältere Verpaarungen anzeigen':'📦 Show older pairings',

    // Selection helper
    'Bestand analysieren':'Analyse stock', 'Genetik, Exterieur, Interieur und Turnier':'Genetics, conformation, temperament and competition',

    // Dashboard
    'Gespeicherte Kacheln':'Saved tiles', 'Dashboard-Kacheln':'Dashboard tiles', 'Kachel hinzufügen':'Add tile',
    'Bestands-Durchschnitt':'Stock average', 'Pferd vs. eigener Rassedurchschnitt':'Horse vs. own breed average',
    '📈 Zuchtschau-Entwicklung':'📈 Breeding show trend', '📈 Zuchtschau-Entwicklung:':'📈 Breeding show trend:',
    '📊 Zuchtbestand & Turnierausrichtung':'📊 Breeding stock & competition focus',
    '👥 Aktive Züchter':'👥 Active breeders', 'Aktive Züchter':'Active breeders', 'Aktive Züchter speichern':'Save active breeders',

    // Breeding show
    'Zuchtschau':'Breeding show', 'Zuchtschau:':'Breeding show:', 'Zuchtschau gelaufen':'Breeding show completed',
    'ZS gesamt':'Show total', 'ZS gesamt minus':'Show total minus', 'ZS-Gesamtwert':'Show total score',
    'ZS-Grundwert':'Show baseline', 'Grundwert:':'Baseline:', 'ZS-Wert / Prognose':'Show score / forecast',
    'Nur Prognose (ohne echten ZS-Wert)':'Forecast only (without actual show score)',
    'ZS-Auswertung (nur echte ZS-Punkte)':'Show analysis (actual show points only)',
    'Turnierbonus bei ZS':'Competition bonus in show score', 'Cupbonus bei ZS':'Cup bonus in show score',
    'echte positive ZS-Punkte':'actual positive show points', 'ZS-Punkte zeitnah eintragen':'Enter show points promptly',
    'Eintragungsdatum':'Entry date',

    // Settings / backups
    'Anzeige':'Display', 'Gemeinsame Online-Version:':'Shared online version:',
    '🛡️ Datensicherung & Import':'🛡️ Backup & import', '💾 Backup herunterladen':'💾 Download backup',
    '🛡️ Sicherung jetzt schreiben':'🛡️ Write backup now', '📂 JSON-Backup importieren':'📂 Import JSON backup',
    '🧠 Bereinigte Lerndatei exportieren':'🧠 Export cleaned learning file',
    '📁 Backup-Ordner wählen / ändern':'📁 Choose / change backup folder',
    '🔓 Ordnerzugriff freigeben':'🔓 Grant folder access', 'Ordner vergessen':'Forget folder',
    'Bereinigte Lerndatei:':'Cleaned learning file:', '🔎 Filtervorlagen verwalten':'🔎 Manage filter presets',
    'Zur Datenbank / Vorlage laden':'Open database / load preset', '🏷️ Schlagwörter konfigurieren':'🏷️ Configure tags',
    'Neues Schlagwort':'New tag', 'Schlagwort hinzufügen':'Add tag', 'Schlagwort zuweisen':'Assign tag',
    '🏷️ Schlagwort zuweisen':'🏷️ Assign tag', '🏷️ Schlagwort entfernen':'🏷️ Remove tag',
    '🧠 Lerndatei zuweisen':'🧠 Assign learning file', '🧠 Lerndatei lösen':'🧠 Remove from learning file',
    '✏️ Mehrfach bearbeiten':'✏️ Bulk edit', 'Mehrfachbearbeitung:':'Bulk editing:',
    'Weitere Aktionen:':'More actions:', 'Besitzer leeren':'Clear owner', 'Anderen Besitzer eingeben…':'Enter another owner…',
    'Import-Vorschau:':'Import preview:', '📥 Import-Vorschau':'📥 Import preview', 'Import speichern':'Save import',
    'Alle ersetzen':'Replace all', 'Datenmenge:':'Data volume:',

    // View / actions
    '🐴 Pferd ansehen':'🐴 View horse', '✏️ Bearbeiten':'✏️ Edit', '🔗 MDR-Pferdeseite':'🔗 MDR horse page',
    'MDR-Link nicht verfügbar – ID fehlt':'MDR link unavailable – ID missing', 'Pferd löschen':'Delete horse',
    'Löschen bestätigen':'Confirm deletion', 'Blättern nach':'Browse by', 'Zuletzt bearbeitet':'Last edited',
    'Vorheriges Pferd':'Previous horse', 'Nächstes Pferd':'Next horse',
    'Speichern & nächstes Pferd':'Save & next horse',
    'Speichern & nächstes Pferd (alphabetisch)':'Save & next horse (alphabetically)',
    'Speichern & vorheriges Pferd (alphabetisch)':'Save & previous horse (alphabetically)',
    'Pferdeseite im Spiel kopieren und hier einfügen…':'Copy the horse page in the game and paste it here…',
    'Text von der Pferdeseite einfügen':'Paste text from the horse page',
    'Hier den kopierten Seitentext einfügen…':'Paste the copied page text here…',

    // Login
    'Zugriff auf den gemeinsamen Datenbestand.':'Access the shared database.',
    'Benutzername':'Username', 'Passwort':'Password',
    'Es gibt keine öffentliche Registrierung. Zugänge werden ausschließlich für freigeschaltete MDR-Nutzer angelegt.':'There is no public registration. Accounts are created only for approved MDR users.',

    // Guide / help headings
    'Wie ist die Datenbank aufgebaut?':'How is the database structured?',
    'Wie nutze ich den Zuchtplaner?':'How do I use the breeding planner?',
    'Wie funktioniert das Verpaarungs-Log?':'How does the pairing log work?',
    'Wie funktioniert die Aussortierhilfe?':'How does the selection helper work?',
    'Wie nutze ich die Aussortierhilfe?':'How do I use the selection helper?',
    'Wie nutze ich das Dashboard sinnvoll?':'How do I use the dashboard effectively?',
    'Was bedeuten Datenqualität und Lerndatei?':'What do data quality and learning file mean?',
    'Wann sollte ich ein Pferd neu einlesen?':'When should I re-read a horse?',
    'Wie funktioniert die ZS-Prognose für Fohlen?':'How does the breeding-show forecast for foals work?',
    'Schnell nachschlagen statt Funktionen suchen':'Quick reference instead of searching for features',
    'Tipp zum Einlesen:':'Import tip:', 'Wichtig:':'Important:', 'Warum?':'Why?', 'Prüfung:':'Check:',

    // Misc
    'Sortierung':'Sorting', 'Sortierrichtung':'Sort direction', 'Blätterreihenfolge':'Browse order',
    'Kennzahl':'Metric', 'Bezeichnung':'Label', 'Titel (optional)':'Title (optional)', 'Zeitpunkt':'Time',
    'Filtervorlage':'Filter preset', 'Gespeicherte Filter-Vorlage laden':'Load saved filter preset',
    'Modellwahl:':'Model choice:', 'ℹ️ Modell & Diagnose':'ℹ️ Model & diagnostics', 'Prognose:':'Forecast:',
    'Referenzwerte':'Reference values', '📊 Referenzwerte':'📊 Reference values',
    'Pferdedatenbank:':'Horse database:', 'Zuchtplaner:':'Breeding planner:', 'Dashboard:':'Dashboard:',
    'Verpaarungs-Log:':'Pairing log:', 'Turnier & Leistung:':'Competition & performance:',
    'Bitte ein Pferd auswählen.':'Please select a horse.', 'Keine Pferde gefunden.':'No horses found.',
    'Keine Pferde im aktuellen Filter.':'No horses in the current filter.',
    'Keine aktive Rasse im aktuellen Filter.':'No active breed in the current filter.',
    'Noch keine Daten.':'No data yet.', 'Noch nichts gemerkt.':'Nothing saved yet.',
  };

  const ATTR_EN = {
    'Name':'Name','Anzahl':'Count','Suche…':'Search…','Nach oben':'Back to top','kostenlos':'free',
    'Pferdename':'Horse name','Zuchtplaner':'Breeding planner','Besitzername':'Owner name',
    'Aktive Filter':'Active filters','Nächstes Pferd':'Next horse','Turnierplanung':'Competition planning',
    'Sortierrichtung':'Sort direction','Vorheriges Pferd':'Previous horse','leer = kostenlos':'blank = free',
    'Blätterreihenfolge':'Browse order','Name oder Besitzer':'Name or owner','z. B. Paint-Stuten':'e.g. Paint mares',
    'optional, z. B. 150':'optional, e.g. 150','Pferdenamen auswählen':'Select horse names',
    'Wichtigste Pferdewerte':'Most important horse values','optional, z. B. Dressur':'optional, e.g. Dressage',
    'z. B. Zuchtgemeinschaft':'e.g. breeding association','Vorhandenes Fohlen auswählen':'Select existing foal',
    'Hengst, Stute, Fohlen, Notiz…':'Stallion, mare, foal, note…',
    'z.B. 50% Araber, 50% Vollblut':'e.g. 50% Arabian, 50% Thoroughbred',
    'Gesamtpunktzahl der Zuchtschau':'Total breeding-show score',
    'Alle sichtbaren Pferde auswählen':'Select all visible horses',
    'Gespeicherte Filter-Vorlage laden':'Load saved filter preset',
    'Geschlecht für Zuchtschau-Entwicklung':'Sex for breeding-show trend',
    'Hier den kopierten Seitentext einfügen…':'Paste the copied page text here…',
    'Speichern & nächstes Pferd (alphabetisch)':'Save & next horse (alphabetically)',
    'wird automatisch aus der Begabung gesetzt':'set automatically from talent',
    'Speichern & vorheriges Pferd (alphabetisch)':'Save & previous horse (alphabetically)',
    'Bestes Fohlen in mindestens einem Vergleichswert':'Best foal in at least one comparison value',
    'Pferdeseite im Spiel kopieren und hier einfügen…':'Copy the horse page in the game and paste it here…',
    'Verwendet die im MDR-Profil angegebene Anzahl der Nachkommen.':'Uses the number of offspring shown in the MDR profile.',
    'Unverbindliche Ampel-Empfehlung nach Geburt und Verknüpfung des tatsächlichen Fohlens.':'Non-binding traffic-light recommendation after birth and linking the actual foal.',
    'Verwendet dieselbe Datenqualitätsprüfung wie die grünen, gelben und roten Badges an den Pferden.':'Uses the same data-quality check as the green, yellow and red badges on the horses.',
    'Unverbindliche Zuchtempfehlung aus dem Vergleich des tatsächlichen Fohlens mit dem Mittelwert seiner beiden Eltern.':'Non-binding breeding recommendation based on comparing the actual foal with the mean of both parents.',
    'Prüft, ob die vorhandenen tatsächlichen Werte im gespeicherten typischen 80%-Bereich der Datenbank-Schätzung liegen.':'Checks whether the available actual values lie within the stored typical 80% range of the database estimate.'
  };

  // Exact translations for recurring dynamic UI strings.
  Object.assign(EN, {
    'Kopiert':'Copied', 'Kopieren fehlgeschlagen':'Copy failed', 'Speichert…':'Saving…', 'Erledigt':'Done',
    '↶ Wird rückgängig gemacht…':'↶ Undoing…', 'Fehler beim Laden':'Error while loading',
    'Filtervorlage fehlt':'Filter preset missing', 'Kachel':'Tile', 'Dashboard-Kachel':'Dashboard tile',
    'Alle Disziplinen':'All disciplines', 'Alle Rassen':'All breeds', 'Alle Gruppen':'All groups',
    'Turnierprofil wird berechnet…':'Calculating competition profile…',
    'Kein Cup-Termin berechenbar.':'No Cup date can be calculated.',
    'Keine Pferde entsprechen den gewählten Filtern.':'No horses match the selected filters.',
    'Für dieses Pferd fehlen noch vollständige Turnier-Potenzialwerte.':'Complete competition-potential values are still missing for this horse.',
    'Bitte zuerst mindestens ein Pferd über das Häkchen auswählen.':'Please select at least one horse using the checkbox first.',
    'Bitte den neuen Besitzernamen eingeben.':'Please enter the new owner name.',
    'Bitte mindestens ein Schlagwort auswählen. Zum vollständigen Leeren der Schlagwörter bitte die Pferde einzeln prüfen.':'Please select at least one tag. To clear all tags completely, review the horses individually.',
    'Dieses Pferd wirklich löschen? Die letzte Löschaktion kann anschließend rückgängig gemacht werden.':'Really delete this horse? The most recent deletion can be undone afterwards.',
    'Dieses Pferd wirklich unwiderruflich löschen?':'Really delete this horse permanently?',
    'Diese Verpaarung wirklich unwiderruflich löschen?':'Really delete this pairing permanently?',
    'Bitte das Datum im Format TT.MM.JJJJ eingeben (z.B. 19.08.2026).':'Please enter the date in DD.MM.YYYY format (e.g. 19.08.2026).',
    '„Fohlen behalten?“ kann erst am Abfohldatum oder danach festgelegt werden.':'“Keep foal?” can only be set on or after the foaling date.',
    'Sicherung wurde geschrieben und geprüft.':'Backup was written and verified.',
    'Sicherung konnte nicht vollständig geschrieben werden. Bitte die Sicherheitsanzeige oben prüfen.':'Backup could not be written completely. Please check the safety notice above.',
    'Es wurde noch kein aktueller Datenbankfilter gespeichert. Bitte zuerst die Pferdedatenbank öffnen und dort filtern.':'No current database filter has been saved yet. Please open the horse database and apply filters first.',
    'Bitte zuerst eine Filtervorlage auswählen.':'Please select a filter preset first.',
    'Ein Schlagwort darf keinen leeren Namen haben.':'A tag cannot have an empty name.',
    'Schlagwörter wurden gespeichert.':'Tags were saved.',
    'Dieses Schlagwort gibt es bereits.':'This tag already exists.',
    'Bild konnte lokal nicht übernommen werden:':'Image could not be stored locally:',
    'Vergleich konnte nicht gespeichert werden:':'Comparison could not be saved:',
    'Löschen fehlgeschlagen:':'Deletion failed:', 'Speichern fehlgeschlagen:':'Save failed:',
    'Import fehlgeschlagen:':'Import failed:', 'Rückgängig fehlgeschlagen:':'Undo failed:',
    'Vorlage konnte nicht gespeichert werden:':'Preset could not be saved:',
    'Lerndatei konnte nicht erstellt werden:':'Learning file could not be created:',
    'Backup konnte nicht erstellt werden:':'Backup could not be created:',
    'Backup-Ordner konnte nicht eingerichtet werden:':'Backup folder could not be configured:',
    'Verbindung nicht möglich':'Connection not possible',
    'Die gemeinsame MDR-Datenbank konnte nicht gestartet werden.':'The shared MDR database could not be started.',
    'Bitte Internetverbindung prüfen und die Seite neu laden.':'Please check your internet connection and reload the page.',
    'Unbekannter Fehler':'Unknown error',
    'Bitte über die Webadresse öffnen':'Please open via the web address',
    'In diesem Modus wird die Pferdedatenbank nicht geöffnet.':'The horse database is not opened in this mode.',
    'Öffne stattdessen die veröffentlichte GitHub-Pages-Adresse deiner Datenbank.':'Instead, open the published GitHub Pages address of your database.',
  });

  // V54.0.50 translation-audit additions for split/static copy.
  Object.assign(EN, {
    "Die":"The",
    "Unter":"Below",
    "Rückgängig:":"Undo:",
    "Relative Stärke":"Relative strength",
    "ein Teil fehlt.":"some data is missing.",
    "Die Filter sind in":"The filters are in",
    "Nach Hauptbegabung":"By main talent",
    "werden Einträge ab":"entries are included from",
    "Interieur höchstens":"Temperament at most",
    "✓ Ausgewählte Pferde":"✓ Selected horses",
    "Der Dashboard-Bereich":"The dashboard section",
    "Ja – nur als Lerndatei":"Yes – learning file only",
    "Ja, Datensatz ergänzen":"Yes, complete the record",
    "Zurück zur Bearbeitung":"Back to editing",
    "Toleranz berücksichtigen":"Apply tolerance",
    "Verkauft / Status geändert":"Sold / status changed",
    "als erstem Schwerpunkt und":"as the first focus and",
    "⚠️ MDR-ID bereits vorhanden":"⚠️ MDR ID already exists",
    "liefert Gesamtstarts sowie die":"provides total starts as well as the",
    "🏅 Turniererfolge & MDR-Cup-Status":"🏅 Competition results & MDR Cup status",
    ". GP/Ext% höher, Ext/Int niedriger.":". GP/Conformation % higher, Conformation/Temperament lower.",
    "Auswahl wird pro Login gespeichert.":"The selection is saved per login.",
    "Das Lernmodell nutzt ausschließlich":"The learning model uses only",
    "liefert 1./2./3. Plätze, der Reiter":"provides 1st/2nd/3rd places, while the tab",
    "Fohlen anlegen und Eltern verknüpfen":"Create foal and link parents",
    ", kann aber jederzeit verändert werden.":", but can be changed at any time.",
    "bleiben als System-Schlagwörter geschützt.":"remain protected as system tags.",
    "„Bestes Fohlen“ in der Pferdeübersicht anzeigen":"Show “Best foal” in the horse overview",
    "💾 Letzten Datenbankfilter als Vorlage speichern":"💾 Save last database filter as preset",
    "Standardmäßig arbeitet der Verpaarungsratgeber mit":"By default, the pairing advisor works with",
    "Wie trage ich ein Pferd möglichst vollständig ein?":"How do I enter a horse as completely as possible?",
    "Wie nutze ich Turnier & Leistung und die Cup-Liste?":"How do I use Competition & performance and the Cup list?",
    "Wie funktionieren die Filter auf der Datenbankseite?":"How do the filters on the database page work?",
    "Freitext über Verpaarung, Fohlen, Besitzer und Rasse.":"Free-text search across pairing, foal, owner and breed.",
    "sind theoretische Extremwerte. Für die Praxis ist die":"are theoretical extreme values. In practice, the",
    "Echte ZS-Werte sind Lernbasis für spätere ZS-Prognosen.":"Actual breeding-show values are the learning basis for later show forecasts.",
    "Genetik, EKH, Farbe und Vererbung werden vollständiger.":"Genetics, hereditary-disease data, colour and inheritance become more complete.",
    "Häufig benötigte Kombinationen lassen sich weiterhin als":"Frequently used combinations can still be saved as",
    "Ausgangspferd und mindestens einen Gegenpartner auswählen.":"Select the starting horse and at least one partner.",
    "nur Lernwerte; persönliche Verwaltungsdaten werden entfernt.":"learning values only; personal management data is removed.",
    "nur ✓ oder ✗; die Detailprognose bleibt separat aufklappbar.":"only ✓ or ✗; the detailed forecast remains separately expandable.",
    "Wird bei Hengsten aus der Pferdeseite automatisch ausgelesen.":"For stallions, this is parsed automatically from the horse page.",
    "Bei Ja wird das Schlagwort „Zuchtstation“ automatisch gesetzt.":"If Yes, the “Breeding station” tag is set automatically.",
    "Ein zweiter Datensatz mit derselben MDR-ID wird nicht angelegt.":"A second record with the same MDR ID is not created.",
    "Erkannte Detaildaten (aus dem eingefügten Text, nur zur Ansicht)":"Detected detail data (from the pasted text, display only)",
    "Variante B. Fehlende Vergleichsdaten erscheinen als „Noch offen“.":"Variant B. Missing comparison data is shown as “Still open”.",
    "GP, Ext, Ext%, Int, Hauptbegabung und Turnierprofil werden nutzbar.":"GP, Conformation, Conformation %, Temperament, main talent and competition profile become usable.",
    "Wie funktionieren sichere Importe, Mehrfachbearbeitung und Rückgängig?":"How do safe imports, bulk editing and undo work?",
    "Auch hier hängt die Rassenauswahl von den ausgewählten Züchtern ab. Die":"Here too, breed selection depends on the selected breeders. The",
    "meist hilfreicher; Ext und Ext% beruhen auf bekannten genetischen Daten.":"is usually more useful; Conformation and Conformation % are based on known genetic data.",
    "Bestandsübersicht der aktiven Züchter. Filter gelten für alle Auswertungen.":"Overview of the active breeders’ stock. Filters apply to all analyses.",
    "als zweitem Kriterium im kombinierten Ausgleich. Die Gewichtung startet bei":"as the second criterion in combined balancing. Weighting starts at",
    "Begabung und Turnierpotenziale werden automatisch übernommen. Der MDR-Reiter":"Talent and competition potentials are imported automatically. The MDR tab",
    "Optionaler Ausgangshengst, wenn er nicht in der gemeinsamen Datenbank steht.":"Optional starting stallion if he is not in the shared database.",
    "Vergangene Verpaarungen werden automatisch einsortiert; neueste Geburt zuerst.":"Past pairings are sorted automatically; newest birth first.",
    "die für die allgemeine Auswertung erwarteten Kerninformationen sind vorhanden.":"the core information expected for general analysis is available.",
    "Eigene Schlagwörter können ergänzt, umbenannt, eingefärbt oder gelöscht werden.":"Custom tags can be added, renamed, coloured or deleted.",
    "Ein Ausgangspferd mit bis zu drei Gegenpartnern direkt nebeneinander vergleichen.":"Compare one starting horse with up to three partners side by side.",
    "Arbeitsbestand: Supabase. Der Backup-Ordner ist eine zusätzliche lokale Sicherung.":"Working data: Supabase. The backup folder is an additional local backup.",
    "Wähle nur das Ausgangspferd; die Gegenpartner werden darunter automatisch gerankt.":"Select only the starting horse; partners are ranked automatically below it.",
    "Explizite Dokumentation. Sichtbares Flaxen (flfl) wird weiterhin automatisch erkannt.":"Explicit documentation. Visible flaxen (flfl) continues to be detected automatically.",
    "Leer lassen, solange kein echter ZS-Wert vorliegt. 0 gilt als „kein ZS-Wert bekannt“.":"Leave blank until an actual breeding-show value exists. 0 means “no show value known”.",
    "GP unter dem Elternmittel oder eine deutliche Verschlechterung bei Ext, Ext% oder Int.":"GP below the parental mean or a clear deterioration in Conformation, Conformation % or Temperament.",
    "werden alle Disziplinen eines Pferdes aus Potenzial und relevantem Interieur bewertet.":"all of a horse’s disciplines are evaluated from potential and relevant temperament.",
    "bleibt die Entscheidung offen; das Fohlen kann trotzdem eingetragen und ausgewertet werden.":"the decision remains open; the foal can still be entered and evaluated.",
    "Zeigt Vergleichsfarben, Bestwert-Sterne und den Filter „Bestes Fohlen“ in der Pferdedatenbank.":"Shows comparison colours, best-value stars and the “Best foal” filter in the horse database.",
    "zentrale Übersicht für Stammdaten, Genetik, Leistungswerte, Zucht, Stammbaum und Turnierdaten.":"central overview for basic data, genetics, performance values, breeding, pedigree and competition data.",
    "automatisch ab 50 Gesamtstarts und 15 Siegen in der Disziplin. Vorhandene Cup-LK wird übernommen.":"automatically from 50 total starts and 15 wins in the discipline. An existing Cup level is retained.",
    "Fehlende Werte bleiben bewusst fehlend. Sie werden in Prognosemodellen nicht als Null interpretiert.":"Missing values deliberately remain missing. Forecast models do not interpret them as zero.",
    "Filtervorlagen speichern, umbenennen oder löschen. Laden bleibt auch in der Pferdedatenbank möglich.":"Save, rename or delete filter presets. Presets can also be loaded from the horse database.",
    "Gentest öffnen, alle Disziplinen und Rasseanteile einblenden, dann die komplette MDR-Seite kopieren.":"Open the genetic test, show all disciplines and breed composition, then copy the complete MDR page.",
    "Mindestens auf Elternniveau, aber unter der grünen GP-Grenze oder mit leichter Ext/Ext%/Int-Schwäche.":"At least at parental level, but below the green GP threshold or with a slight weakness in Conformation, Conformation % or Temperament.",
    "Das kann daran liegen, dass diese Angaben im kopierten Text nicht enthalten waren. Trotzdem speichern?":"This may be because these details were not included in the copied text. Save anyway?",
    "Nicht ausgewählte Felder bleiben garantiert unverändert. Vor dem Anwenden wird eine Vorschau berechnet.":"Fields that are not selected are guaranteed to remain unchanged. A preview is calculated before applying changes.",
    "Seite einfügen, „Automatisch auslesen“ wählen und nur offene Angaben unter „Noch prüfen“ kontrollieren.":"Paste the page, choose “Parse automatically” and review only open items under “Still to review”.",
    "Wird beim Import automatisch aus der Begabung/Hauptdisziplin gesetzt, kann aber manuell geändert werden.":"Set automatically from talent/main discipline during import, but can be changed manually.",
    "Häufige Auswertungen können als Dashboard-Kacheln bzw. gespeicherte Einstellungen wiederverwendet werden.":"Frequently used analyses can be reused as dashboard tiles or saved settings.",
    "Ø Gewinnwert je aktiver Rasse in den letzten fünf Monaten. Stuten und Hengste werden getrennt ausgewertet.":"Average winning value per active breed over the last five months. Mares and stallions are analysed separately.",
    "Nicht geänderte vorhandene Daten bleiben erhalten. Erst mit „Import speichern“ wird die Datenbank geändert.":"Existing data that was not changed is retained. The database changes only when you choose “Save import”."
  });

  Object.assign(EN, {
    "Stute ab +5 GP, Hengst ab +10 GP gegenüber dem Elternmittel – ohne relevante Ext/Ext%/Int-Verschlechterung.":"Mare from +5 GP, stallion from +10 GP compared with the parental mean – without relevant deterioration in Conformation, Conformation % or Temperament.",
    "Vor einer Entscheidung zusätzlich Stammbaum, Nachzucht, seltene Genetik, Turnierrolle und Zuchtziel prüfen.":"Before making a decision, also review pedigree, offspring, rare genetics, competition role and breeding goal.",
    "Wird aus dem MDR-Reiter „Turniere“ bzw. „Erfolge“ automatisch übernommen, bleibt aber manuell korrigierbar.":"Imported automatically from the MDR “Competitions” or “Results” tab, but can still be corrected manually.",
    "Eine Verpaarung wird mit Stute, Hengst und optionalem Abfohldatum gespeichert. Bei „Fohlen behalten?“ stehen":"A pairing is saved with mare, stallion and an optional foaling date. For “Keep foal?” the options are",
    "Ersetzt in der mobilen Kartenansicht das Sortieren per Klick auf die (dort ausgeblendete) Tabellenkopfzeile.":"In the mobile card view, this replaces sorting by clicking the table header, which is hidden there.",
    "Kacheln verwenden gespeicherte Filtervorlagen und bleiben unabhängig vom aktuell gesetzten Dashboard-Filter.":"Tiles use saved filter presets and remain independent of the currently active dashboard filter.",
    "Referenz sind Pferde mit erkannter Hauptbegabung. Je Pferd zählt der beste Wert innerhalb seiner Hauptgruppe.":"The reference set consists of horses with a detected main talent. For each horse, the best value within its main group counts.",
    "dokumentiert aktuelle und vergangene Verpaarungen und verbindet geborene Fohlen mit der ursprünglichen Planung.":"documents current and past pairings and links born foals to the original plan.",
    "Die Bewertung erfolgt innerhalb des aktuell gefilterten Bestands und ist bewusst in vier klare Bereiche getrennt:":"The evaluation is performed within the currently filtered stock and is deliberately divided into four clear areas:",
    "Verteilung der 7 Hauptgruppen und ihrer Begabungen im gefilterten Bestand. Unterrepräsentierung ist nur ein Hinweis.":"Distribution of the seven main groups and their talents in the filtered stock. Under-representation is only an indicator.",
    "Besitzer- und Rassefilter gelten für den Gegenpartner. Deckstation-Hengste werden nur für Prämienstuten berücksichtigt.":"Owner and breed filters apply to the partner. Breeding-station stallions are considered only for premium mares.",
    "Welche Pferde sind für eine bestimmte Disziplin am stärksten? Punkte und Interieur werden gemeinsam sichtbar gefiltert.":"Which horses are strongest for a specific discipline? Points and temperament can be filtered together visibly.",
    "Nach der Geburt kann ein vorhandenes Fohlen verknüpft oder direkt neu angelegt werden. Bei vergangenen Verpaarungen zeigt":"After birth, an existing foal can be linked or a new one can be created directly. For past pairings, the view shows",
    "Hauptdisziplin ab 180 Punkten, Nebendisziplin standardmäßig ab 150. Interieur bleibt Bestandteil jeder Disziplinbewertung.":"Main discipline from 180 points; secondary disciplines default to 150. Temperament remains part of every discipline evaluation.",
    "Passende Partner mit Fohlen-Vorhersage. ✓ Verwandtschaft, Overo × Overo und Deckstationsregeln werden automatisch geprüft.":"Suitable partners with foal forecast. ✓ Relationship, Overo × Overo and breeding-station rules are checked automatically.",
    "Gewichtet relevantes Interieur stärker: Exzellent Bonus, Gut neutral, In Ordnung leicht negativ, darunter deutlich negativ.":"Weights relevant temperament more strongly: Excellent gets a bonus, Good is neutral, Okay is slightly negative, and lower ratings are clearly negative.",
    "Welche Disziplinen passen zu diesem Pferd? Die stärksten Empfehlungen stehen zuerst; alle 28 Disziplinen bleiben aufklappbar.":"Which disciplines suit this horse? The strongest recommendations appear first; all 28 disciplines remain expandable.",
    "dreht die Frage um und zeigt die stärksten Pferde einer gewählten Disziplin; Besitzer können dabei mehrfach ausgewählt werden.":"reverses the question and shows the strongest horses for a selected discipline; multiple owners can be selected.",
    "Nur die Anzeige wird begrenzt; archivierte Verpaarungen bleiben vollständig gespeichert und werden weiter zum Lernen verwendet.":"Only the display is limited; archived pairings remain fully stored and continue to be used for learning.",
    "Datenqualität ist keine Bewertung des Pferdes, sondern nur eine Aussage darüber, wie belastbar die gespeicherten Auswertungen sind.":"Data quality is not a rating of the horse; it only indicates how reliable the stored analyses are.",
    "Cupstern automatisch ab 50 Gesamtstarts und 15 Siegen je Disziplin. Vorhandene Cup-LK wird übernommen; mehrere Cupsterne sind möglich.":"Cup star is detected automatically from 50 total starts and 15 wins per discipline. Existing Cup level is retained; multiple Cup stars are possible.",
    "Partner finden mit automatischer Verwandtschaftsprüfung, direkter Verpaarungsvergleich, gemerkte Kombinationen, Farbe und Turnierzucht.":"Find partners with automatic relationship checks, direct pairing comparison, saved combinations, colour preferences and competition breeding.",
    "Interessante Kombinationen bleiben 60 Tage gemerkt. Von hier kannst du sie erneut vergleichen oder direkt ins Verpaarungslog übernehmen.":"Interesting combinations remain saved for 60 days. From here you can compare them again or send them directly to the pairing log.",
    "Bestandsauswertung mit Besitzer- und Rassefiltern. Wird ein Besitzer gewählt, stehen nur dessen tatsächlich vorhandene Rassen zur Auswahl.":"Stock analysis with owner and breed filters. When an owner is selected, only breeds actually present for that owner are offered.",
    "P72 = höher als etwa 72 % der Hauptbegabungs-Referenz derselben LK. Gruppen ab n=3 zählen gleich. Vorerst nur Vergleich; Empfehlung unverändert.":"P72 = higher than about 72% of the main-talent reference at the same level. Groups from n=3 are weighted equally. For now this is comparison only; the recommendation is unchanged.",
    ". Zulassungsergebnisse beeinflussen den Score nicht. Fehlende Daten gelten zur Sicherheit als Unsicherheit, nicht automatisch als schlechte Leistung.":". Licence results do not affect the score. For safety, missing data is treated as uncertainty, not automatically as poor performance.",
    "Wenn das Fohlen schon als Pferd gespeichert ist, wähle es hier aus. Es wird nur mit dieser Verpaarung verknüpft – es wird kein zweites Pferd angelegt.":"If the foal is already stored as a horse, select it here. It will only be linked to this pairing – no second horse record is created.",
    "in einer Disziplin angezeigt. Die Liste zeigt Siege, Starts, Cup-Stern, Cup-LK und Turnierwert; zweite und dritte Plätze sind dort bewusst ausgeblendet.":"in a discipline. The list shows wins, starts, Cup star, Cup level and competition value; second and third places are deliberately omitted there.",
    "mit Disziplin und LK. Beide Ansichten können nacheinander eingefügt werden; die Daten werden zusammengeführt. Zukünftige Turniernennungen werden ignoriert.":"with discipline and level. Both views can be pasted one after the other; the data is merged. Future competition entries are ignored.",
    "Der Guide erklärt nicht nur, wo etwas zu finden ist, sondern auch, welche Daten eine Auswertung braucht und wann ein Pferd sinnvoll aktualisiert werden sollte.":"The guide explains not only where to find features, but also which data an analysis needs and when a horse should be updated.",
    "Das Dashboard eignet sich für Bestandsfragen: Welche Rassen besitzt ein Züchter? Wie liegen Durchschnittswerte? Wie verteilen sich Hauptbegabungen oder Zuchtwerte?":"The dashboard is useful for stock questions: Which breeds does a breeder own? How do averages compare? How are main talents or breeding values distributed?",
    "Stute oder Hengst als Ausgangspunkt wählen. Besitzer- und Rassefilter helfen, den Gegenpartner einzugrenzen; auch hier werden Rassen nach Besitzerwahl dynamisch reduziert.":"Choose a mare or stallion as the starting point. Owner and breed filters help narrow the partner; breeds are dynamically reduced after selecting an owner here as well.",
    "Turnierbonus bei ZS: 35 Punkte je 1. Platz, 25 je 2. Platz und 15 je 3. Platz, insgesamt maximal 500. Jeder zu diesem Zeitpunkt vorhandene Cupstern zählt zusätzlich 100 Punkte.":"Competition bonus in the breeding show: 35 points per 1st place, 25 per 2nd and 15 per 3rd, up to 500 total. Each Cup star present at that time adds another 100 points.",
    "Nach dem automatischen Auslesen zeigt die Datenbank vor dem Speichern, wie viele Datenbereiche geändert, ergänzt oder unverändert bleiben. Erst nach Bestätigung wird gespeichert.":"After automatic parsing, the database shows before saving how many data areas will be changed, added or left unchanged. Nothing is saved until you confirm.",
    "Ohne eigene Zielwerte vergleicht die Hilfe ein Pferd relativ mit dem aktuell gefilterten Bestand. Eigene Zielwerte können den Vergleich für den gewählten Schwerpunkt präzisieren.":"Without custom target values, the helper compares a horse relative to the currently filtered stock. Custom targets can refine the comparison for the selected focus.",
    "ist für historische oder zusätzliche Vergleichsdaten gedacht. Solche Pferde können Prognosemodelle unterstützen, werden aber aus operativen Bestandslisten standardmäßig ausgeblendet.":"is intended for historical or additional comparison data. Such horses can support forecast models but are hidden from operational stock lists by default.",
    "Hier liegen die Verwaltungsfunktionen gesammelt an einer Stelle. Die Sicherheitsanzeige oben bleibt weiterhin sichtbar, wenn ein Backup gestoppt oder eine Wiederherstellung nötig ist.":"Management functions are collected here in one place. The safety notice above remains visible if a backup is stopped or a restore is required.",
    "Grün = besser, rot = schlechter als Durchschnitt – GP/Ext%: höher besser, Ext/Int: niedriger besser. Die Felder „Basis“ bestimmen nur den Ø-Vergleich und filtern die Pferdeliste nicht.":"Green = better, red = worse than average – GP/Conformation %: higher is better; Conformation/Temperament: lower is better. The “baseline” fields affect only the average comparison and do not filter the horse list.",
    "Turnierbonus zum ZS-Eintrag (35/25/15, max. 500) minus 100 je damaligem Cupstern. Die beim Eintrag festgehaltenen Bonusdaten werden danach nicht mehr aus heutigen Erfolgen neu berechnet.":"Competition bonus at the time of the show entry (35/25/15, max. 500) minus 100 for each Cup star at that time. Once stored, these bonus data are not recalculated from later results.",
    "durchsucht Hengst, Stute, verknüpftes Fohlen, Besitzer/Züchter, Rasse, Notizen, Datum und bekannte Pferde-IDs; bei einer Suche werden auch ältere Verpaarungen vollständig berücksichtigt.":"searches stallion, mare, linked foal, owner/breeder, breed, notes, date and known horse IDs; older pairings are fully included in searches as well.",
    "Auf der MDR-Pferdeseite möglichst alle relevanten Bereiche öffnen: Gentest, Rasseanteile und sämtliche Disziplinen. Danach die komplette Seite kopieren und über „Pferd hinzufügen“ einlesen.":"On the MDR horse page, open as many relevant areas as possible: genetic test, breed composition and all disciplines. Then copy the complete page and import it via “Add horse”.",
    "erscheint nach Auswahl einer Gruppe ein zweites Feld mit den zugehörigen Unterdisziplinen. Aktive Filter werden oberhalb der Ergebnisliste als Chips angezeigt und können dort einzeln entfernt werden.":"after selecting a group, a second field appears with the corresponding sub-disciplines. Active filters are shown as chips above the results list and can be removed individually there.",
    "Automatisch erkannte Werte anschließend kurz prüfen. Manuelle Angaben wie Besitzer, Schlagwörter, ZS-Wert oder besondere Verwaltungsdaten können ergänzt werden, ohne die ausgelesenen Rohdaten zu verlieren.":"Briefly review automatically detected values afterwards. Manual data such as owner, tags, show score or special management information can be added without losing the parsed raw data.",
    "Der ZS-Grundwert ist ein fester Pferdewert. Beim ersten Speichern einer echten ZS-Gesamtpunktzahl werden Turnier- und Cupbonus dieses Moments automatisch eingefroren; spätere Erfolge verändern den Grundwert nicht.":"The breeding-show baseline is a fixed horse value. When an actual total show score is saved for the first time, the competition and Cup bonuses from that moment are frozen automatically; later results do not change the baseline.",
    "Besitzer und Rasse sind abhängig: Nach der Besitzerwahl zeigt die Rassenauswahl nur Rassen, die bei diesem Besitzer tatsächlich vorhanden sind. Deutsche und englische Rassenbezeichnungen bleiben dabei bewusst getrennt.":"Owner and breed are linked: after selecting an owner, the breed selector shows only breeds actually present for that owner. German and English breed names deliberately remain separate.",
    "nur Pferde mit positiver ZS-Punktzahl und auswertbarem GP, Ext, Ext% und Int. EKH wird nur optional mitgelernt, wenn dafür genügend eindeutig bekannte Daten vorliegen. Leer oder 0 bleibt Prognose und wird nicht gelernt.":"only horses with a positive breeding-show score and usable GP, Conformation, Conformation % and Temperament. Hereditary-disease data is learned only optionally when enough unambiguous data exists. Blank or 0 remains a forecast and is not learned.",
    "n<15 experimentell, 15–29 erste Tendenz, 30–49 brauchbar, 50–99 gut, ab 100 stabiler. Ein echter ZS-Eintrag mit historisch festgehaltenem Bonusstand 0 ist ein gültiger Lerndatensatz; Turnierplatzierungen sind keine Pflicht.":"n<15 experimental, 15–29 first trend, 30–49 usable, 50–99 good, 100+ more stable. An actual show entry with a historically stored bonus of 0 is a valid learning record; competition placings are not required.",
    "Die Aussortierhilfe ist eine Priorisierungshilfe, keine automatische Verkaufsentscheidung. Zuerst Besitzer/Rasse und anschließend den Schwerpunkt festlegen. Bei ausgewählten Besitzern werden nur deren vorhandene Rassen angeboten.":"The selection helper is a prioritisation aid, not an automatic sales decision. First choose owner/breed, then set the focus. For selected owners, only their existing breeds are offered.",
    "Besitzer zuerst einschränken und anschließend eine Rasse wählen. Die Rassenauswahl wird automatisch auf den ausgewählten Bestand reduziert. So entstehen keine scheinbaren Rassenoptionen, die beim gewählten Besitzer gar nicht vorkommen.":"Narrow by owner first, then choose a breed. The breed selector is automatically reduced to the selected stock, preventing breed options that do not actually occur for the chosen owner.",
    "Ein Cup-Stern wird weiterhin automatisch erkannt, wenn die hinterlegte Regel erfüllt ist: mindestens 50 Gesamtstarts und 15 Siege in der jeweiligen Disziplin. Der Cup-Kalender konzentriert sich auf heute und die nächsten fünf Kalendertage.":"A Cup star continues to be detected automatically when the stored rule is met: at least 50 total starts and 15 wins in the relevant discipline. The Cup calendar focuses on today and the next five calendar days.",
    "Nach einer kritischen Pferdeaktion – Import, Löschung oder Mehrfachänderung – erscheint unten rechts kurz eine schwebende Rückgängig-Leiste. Sie verändert das Seitenlayout nicht. Eine neue kritische Aktion ersetzt den vorherigen Undo-Punkt.":"After a critical horse action – import, deletion or bulk change – a floating undo bar briefly appears at the bottom right. It does not alter the page layout. A new critical action replaces the previous undo point.",
    "Bleibt für Lernmodelle und Eltern→Fohlen-Daten erhalten, wird aber aus Zucht-, Turnier-, Cup-, ZS-Prognose-, Dashboard- und Aussortierlisten ausgeblendet. GBH sowie Besitzerkennungen mit „(GBH)“ oder „(Friedhof)“ werden automatisch Lerndatei.":"Remains available for learning models and parent→foal data, but is hidden from breeding, competition, Cup, show-forecast, dashboard and selection-helper lists. GBH and owner labels containing “(GBH)” or “(Friedhof)” are assigned to the learning file automatically.",
    "In der Übersicht mehrere Pferde markieren und Besitzer, Zuchtstation, Zuchtzulassung oder Schlagwörter gemeinsam ändern. Alle Felder starten auf „Keine Änderung“. Bei Schlagwörtern stehen Hinzufügen, Entfernen und Ersetzen getrennt zur Verfügung.":"Select several horses in the overview and change owner, breeding-station status, breeding licence or tags together. All fields start at “No change”. For tags, Add, Remove and Replace are available separately.",
    "Unter „Zuchtschau“ zeigt die Modellprüfung MAE, RMSE, R² und die Spearman-Rangkorrelation sowie einen Vergleich mit einer einfachen Durchschnitts-Prognose. Der aufklappbare Modellvergleich zeigt zusätzlich, welche Variante tatsächlich gewonnen hat.":"Under “Breeding show”, model diagnostics display MAE, RMSE, R² and Spearman rank correlation, plus a comparison with a simple average forecast. The expandable model comparison also shows which variant actually won.",
    "GitHub Pages stellt die Anwendung bereit. Pferde, Verpaarungen und gemeinsame Einstellungen werden zentral und zugriffsgeschützt in Supabase gespeichert. IndexedDB dient nur als lokaler Lesecache. JSON-Backups bleiben als zusätzliche Sicherung erhalten.":"GitHub Pages serves the application. Horses, pairings and shared settings are stored centrally and access-protected in Supabase. IndexedDB is used only as a local read cache. JSON backups remain available as an additional safeguard.",
    "wird ausschließlich aus echten Lerndaten berechnet und nie selbst wieder zum Lerndatum. Sie bleibt bei jedem Pferd unabhängig vom Alter gültig, bis ein echter positiver ZS-Wert eingetragen wird. Sichtbare Züchter-/Rassefilter verändern das Lernen nicht.":"is calculated exclusively from actual learning data and is never fed back into the learning set itself. It remains valid for every horse regardless of age until an actual positive show score is entered. Visible breeder/breed filters do not affect learning.",
    "Die Datenbank testet mehrere Modellvarianten automatisch gegeneinander: linear, fachlich gerichtete Kernwerte, Ext×Ext%-Zusammenspiel und eine vorsichtig nichtlineare Variante. Verwendet wird die Variante mit der besten Kreuzvalidierungs-Prognoseleistung.":"The database automatically tests several model variants against each other: linear, domain-guided core values, an Ext×Ext% interaction and a cautious nonlinear variant. The variant with the best cross-validation forecasting performance is used.",
    ". Für neue ZS-Einträge speichert die Datenbank automatisch den Turnier- und Cupstand dieses Moments zusammen mit dem Eintragungsdatum. Aus dem ZS-Gesamtwert werden nur diese damaligen Boni herausgerechnet; spätere Turniererfolge verändern den Grundwert nicht.":". For new breeding-show entries, the database automatically stores the competition and Cup status at that moment together with the entry date. Only those historical bonuses are subtracted from the total show score; later competition results do not change the baseline.",
    "MAE = mittlere absolute Abweichung; RMSE gewichtet große Fehler stärker; R² näher an 1 ist besser. Spearman misst, wie gut die Rangfolge der Pferde getroffen wird (1 = perfekte Reihenfolge). Zusätzlich wird mit einer einfachen Durchschnitts-Prognose verglichen.":"MAE = mean absolute error; RMSE gives larger errors more weight; R² closer to 1 is better. Spearman measures how well the horse ranking is reproduced (1 = perfect order). A simple average forecast is also used as a baseline.",
    "Eine bereits vorhandene MDR-ID kann nicht als zweites Pferd gespeichert werden. Stattdessen lässt sich der bestehende Datensatz öffnen oder gezielt aktualisieren. Gleiche Namen bzw. identische GP/Ext/Ext%/Int-Werte bleiben nur Hinweise, weil sie nicht eindeutig sind.":"An existing MDR ID cannot be saved as a second horse. Instead, the existing record can be opened or updated selectively. Matching names or identical GP/Ext/Ext%/Int values remain only hints because they are not unique.",
    "1. Platz = 35, 2. Platz = 25, 3. Platz = 15 Zusatzpunkte; Turnierbonus maximal 500. Jeder Cupstern zählt 100 Punkte. Beim ersten Speichern eines neuen ZS-Werts werden Turnier- und Cupstand dieses Eintragungsdatums festgehalten. Spätere Erfolge verändern den ZS-Grundwert nicht.":"1st place = 35, 2nd = 25, 3rd = 15 bonus points; competition bonus capped at 500. Each Cup star counts 100 points. When a new show score is first saved, the competition and Cup status for that entry date is stored. Later results do not change the show baseline.",
    "lässt sich eine Stute mit bis zu drei Hengsten oder ein Hengst mit bis zu drei Stuten direkt nebeneinander vergleichen. Kombinationen können gemerkt oder unmittelbar ins Verpaarungslog übernommen werden. Gemerkte Kombinationen stehen in einem eigenen Tab und lassen sich später wieder in den Vergleich laden.":"a mare can be compared with up to three stallions, or a stallion with up to three mares, side by side. Combinations can be saved or sent directly to the pairing log. Saved combinations have their own tab and can be loaded back into the comparison later.",
    "Aktive Züchter gelten pro Login für persönliche Arbeitsansichten. Rassefilter zeigen nur Rassen aus ihrem aktuellen Bestand. Im Zuchtplaner stammen Stuten nur von aktiven Züchtern; Hengste dürfen fremden Besitzern gehören, wenn ihre Rasse bei einer aktiven Stute vorkommt. Die Verpaarungsansicht wird separat pro Login gespeichert.":"Active breeders apply per login to personal working views. Breed filters show only breeds from their current stock. In the breeding planner, mares come only from active breeders; stallions may belong to other owners if their breed occurs among an active breeder’s mares. The pairing view is saved separately per login.",
    "Der Bereich ist standardmäßig eingeklappt und zeigt für die aktiven Rassen die letzten fünf Kalendermonate. Stuten und Hengste werden über einen kompakten Umschalter getrennt ausgewertet. Jeder positive ZS-Eintrag gilt als Gewinnwert; pro Rasse, Geschlecht und Monat werden Durchschnitt und Anzahl der Einträge anhand des Eintragungsdatums angezeigt.":"The section is collapsed by default and shows the last five calendar months for active breeds. Mares and stallions are analysed separately using a compact switch. Each positive show entry counts as a winning value; average and entry count are shown by breed, sex and month using the entry date.",
    "Für eine ZS-Prognose müssen GP, Ext, Ext% und Int vorhanden sein. Ext und Ext% werden bewusst als zwei getrennte Informationen behandelt. Das Pferd selbst braucht keine Turnierplatzierung und keinen echten ZS-Wert. Die Prognose bleibt unabhängig vom Alter sichtbar, bis ein echter positiver ZS-Wert eingetragen wird, und wird niemals selbst als Lerndatum verwendet.":"A breeding-show forecast requires GP, Conformation, Conformation % and Temperament. Conformation and Conformation % are deliberately treated as separate information. The horse itself does not need a competition placing or an actual show score. The forecast remains visible regardless of age until an actual positive show score is entered, and the forecast itself is never used as learning data.",
    "Popup nach dem Eintragen einer Verpaarung ab erreichtem Abfohldatum; auch bei offenem ? kann das Fohlen eingetragen werden. Nutzt dieselben Feld-IDs wie das \"Neues Pferd\"-Formular in horse.html, damit horseForm.js dessen Funktionen (Textauslesen, Detail-Vorschau, Feld sammeln) hier ohne Duplizierung wiederverwenden kann. Das eigentliche Speichern übernimmt aber verpaarung.js, siehe onSaveFoal().":"Popup after entering a pairing once the foaling date has been reached; the foal can also be entered while ? is still open. It uses the same field IDs as the “New horse” form in horse.html so horseForm.js can reuse its parsing, detail preview and field-collection functions without duplication. Actual saving is handled by verpaarung.js; see onSaveFoal().",
    "Ext und Ext% bleiben immer als getrennte Kernwerte erhalten. Mehrere Modellvarianten werden automatisch in derselben Kreuzvalidierung gegeneinander getestet. Das niedrigste RMSE setzt die Referenz; Modelle bis 1% darüber gelten als praktisch gleichwertig. Innerhalb dieser Toleranz werden fachlich gerichtete und anschließend einfachere Modelle bevorzugt. Getestet werden lineare, fachlich gerichtete, Ext×Ext%- und vorsichtig nichtlineare Varianten.":"Ext and Ext% always remain separate core values. Several model variants are tested automatically in the same cross-validation. The lowest RMSE sets the reference; models up to 1% above it are treated as practically equivalent. Within this tolerance, domain-guided and then simpler models are preferred. Linear, domain-guided, Ext×Ext% and cautious nonlinear variants are tested.",
    ", Appaloosa-Muster, weitere Farbgene oder Turnierzucht nur aktivieren, wenn sie für die konkrete Verpaarung relevant sind. Beim Grundfarbenwunsch stehen Chestnut, Wild Bay, Bay, Sealbrown, Black und Grey zur Wahl; die Rangfolge nutzt die berechenbare Fohlenchance. Unknown/Unbekannt im Stammbaum gilt nie als echte Verwandtschaft. Verwandtschaft, Overo × Overo und die Deckstationsregel werden automatisch geprüft; dafür gibt es keinen separaten Inzucht-Tab mehr.":", Appaloosa pattern, additional colour genes or competition breeding only when relevant to the specific pairing. Base-colour preferences include Chestnut, Wild Bay, Bay, Sealbrown, Black and Grey; ranking uses the calculable foal probability. Unknown/Unbekannt in the pedigree never counts as actual relationship. Relationship, Overo × Overo and the breeding-station rule are checked automatically; there is no separate inbreeding tab anymore.",
    "konzentriert sich auf Grundfarben, die offiziellen MDR-Schattierungsstufen, LP-Scheckungsmuster und beobachtete Grundfarben-Vererbung. Verdünnungen und Überlagerungen wie Palomino, Dun, Champagne oder Pearl werden – soweit aus Fellfarbe bzw. Extension/Agouti eindeutig ableitbar – ihrer genetischen Grundfarbe zugeordnet. Die Schattierungstabelle zeigt jede bekannte Stufe hell → dunkel auch bei Bestand 0; echte Extension-/Agouti-Tests werden nur kompakt markiert und nicht als Ursache der Schattierung behauptet. Die Snowflake-Forschung bleibt im Code erhalten, wird im Dashboard aber nicht mehr als eigener Detektiv angezeigt. Auf LP-Schecken-Pferdeseiten wird P1/P2/P3 weiterhin kompakt mit ✓, ✗ oder ? angezeigt; P1 nutzt den echten PATN1-Test, P2/P3 werden aus dem sichtbaren Muster abgeleitet. Der Zuchtplaner berücksichtigt dieselbe Hierarchie bei Appaloosa-Farbwünschen.":"focuses on base colours, official MDR shade levels, LP spotting patterns and observed base-colour inheritance. Dilutions and overlays such as Palomino, Dun, Champagne or Pearl are assigned to their genetic base colour where this can be derived unambiguously from coat colour or Extension/Agouti. The shade table shows every known level from light → dark even when stock is 0; actual Extension/Agouti tests are marked compactly and are not claimed to cause the shade. Snowflake research remains in the code but is no longer shown as a separate detective in the dashboard. On LP-spotted horse pages, P1/P2/P3 continue to be displayed compactly as ✓, ✗ or ?; P1 uses the actual PATN1 test, while P2/P3 are derived from the visible pattern. The breeding planner uses the same hierarchy for Appaloosa colour preferences."
  });

  Object.assign(EN, {
    "Benutzername oder Passwort ist nicht korrekt.":"Username or password is incorrect.",
    "Bitte Passwort eingeben.":"Please enter your password.",
    "Anmeldung läuft…":"Signing in…",
    "Anmeldung fehlgeschlagen.":"Sign-in failed.",
    "Dieser Benutzer ist für MDR nicht freigeschaltet.":"This user is not approved for MDR.",
    "Zugriff auf die MDR-Datenbank nicht freigeschaltet.":"Access to the MDR database is not approved.",
    "Supabase-Bibliothek konnte nicht geladen werden.":"The Supabase library could not be loaded.",
    "Supabase-Bibliothek konnte nicht geladen werden. Bitte Internetverbindung prüfen.":"The Supabase library could not be loaded. Please check your internet connection.",
    "Deckhengst und Stute sind Pflichtfelder.":"Stallion and mare are required fields.",
    "Bitte das Abfohldatum als TT.MM.JJJJ eingeben, z. B. 19.08.2026.":"Please enter the foaling date as DD.MM.YYYY, e.g. 19.08.2026.",
    "Das ausgewählte Fohlen wurde nicht in der Pferdedatenbank gefunden. Bitte einen Namen aus der Vorschlagsliste auswählen.":"The selected foal was not found in the horse database. Please choose a name from the suggestions.",
    "Bitte einen Besitzer / Züchter aus der Liste auswählen.":"Please select an owner / breeder from the list.",
    "Fohlen verknüpfen oder eintragen":"Link or enter foal",
    "Fohlen verknüpfen oder Werte erfassen":"Link foal or enter values",
    "Verpaarung oder Fohlen fehlt.":"Pairing or foal is missing.",
    "Keine Verpaarung ausgewählt.":"No pairing selected.",
    "Bitte ein bereits gespeichertes Pferd auswählen.":"Please select a horse that is already stored.",
    "Dieses Pferd wurde nicht in der Datenbank gefunden. Bitte einen Namen aus der Vorschlagsliste auswählen.":"This horse was not found in the database. Please choose a name from the suggestions.",
    "Verknüpfen fehlgeschlagen:":"Linking failed:",
    "Turnier-Rangliste konnte nicht geladen werden:":"Competition ranking could not be loaded:",
    "Keine passenden Cupdaten bzw. noch keine 7 Siege in der gewählten Disziplin.":"No matching Cup data, or fewer than 7 wins in the selected discipline.",
    "Keine Werte vorhanden":"No values available",
    "einschließen":"include", "ausschließen":"exclude", "neutral":"neutral",
    "Server bestätigte die Sicherung nicht.":"The server did not confirm the backup.",
    "🛡️ Externe Sicherung nicht verfügbar":"🛡️ External backup unavailable",
    "🛡️ Backup-Ordner wählen":"🛡️ Choose backup folder",
    "🛡️ Backup-Ordner ändern":"🛡️ Change backup folder",
    "Backup-Ordner ändern":"Change backup folder", "Backup-Ordner wählen":"Choose backup folder",
    "Dieser Browser unterstützt die direkte Ordnersicherung nicht. JSON-Backups können weiterhin heruntergeladen werden.":"This browser does not support direct folder backups. JSON backups can still be downloaded.",
    "Auswahl-Exporte können aus Sicherheitsgründen nur ergänzt/zusammengeführt werden.":"For safety, selection exports can only be added/merged.",
    "Die Datei ist kein gültiges MDR-Backup.":"The file is not a valid MDR backup.",
    "Backup wurde vollständig importiert. Die enthaltenen Datenbereiche wurden ersetzt. Die Seite wird neu geladen.":"The backup was imported completely. The included data areas were replaced. The page will reload.",
    "Der Erledigt-Status konnte nicht dauerhaft gespeichert werden. Bitte erneut versuchen.":"The done status could not be saved permanently. Please try again.",
    "Keine Änderung ausgewählt.":"No change selected.",
    "Letzte Änderung":"Last change", "Änderung":"Change", "Letzte Aktion:":"Last action:",
    "Schlagwort zuweisen":"Assign tag", "Schlagwort entfernen":"Remove tag",
    "Noch keine Pferdedaten für die Auswertung vorhanden.":"No horse data available for analysis yet.",
    "Zucht- und Nachzuchtdaten werden ausgewertet…":"Analysing breeding and offspring data…",
    "Vorlage nicht mehr vorhanden":"Preset no longer exists",
    "Noch keine Filtervorlagen gespeichert.":"No filter presets saved yet.",
    "Noch keine Dashboard-Kacheln angelegt.":"No dashboard tiles created yet.",
    "🐴 Pferd bearbeiten":"🐴 Edit horse",
    "Konnte Pferd nicht laden:":"Could not load horse:",
    "Pferd wurde in der lokalen Datenbank nicht gefunden.":"Horse was not found in the local database.",
    "Bitte zuerst Text einfügen.":"Please paste text first.",
    "Gespeicherter ZS-Bonusstand. Spätere Turnier- oder Cup-Erfolge verändern diesen Grundwert nicht.":"Stored breeding-show bonus status. Later competition or Cup results do not change this baseline.",
    "Vorschau: Beim Speichern werden der aktuelle Turnier- und Cupbonus automatisch zum Eintragungsdatum festgehalten.":"Preview: When saving, the current competition and Cup bonus is stored automatically for the entry date.",
    "Noch kein echter ZS-Wert eingetragen.":"No actual breeding-show value entered yet.",
    "Prüfung auf bestehenden Datensatz fehlgeschlagen:":"Checking for an existing record failed:",
    "ZS-Prognose derzeit nicht verfügbar.":"Breeding-show forecast is currently unavailable.",
    "ZS-Prognose (Grundwert). Sie bleibt unabhängig vom Alter sichtbar und wird erst durch einen echten eingetragenen ZS-Wert ersetzt.":"Breeding-show forecast (baseline). It remains visible regardless of age and is replaced only by an actual entered show score.",
    "Kein weiteres Pferd (Ende der gewählten Sortierung).":"No next horse (end of the selected sort order).",
    "Kein vorheriges Pferd (Anfang der gewählten Sortierung).":"No previous horse (start of the selected sort order).",
    "Turnierzucht ist ausgeschaltet; die bisherige Sortierung bleibt unverändert.":"Competition breeding is off; the existing sorting remains unchanged.",
    "Bitte zuerst ein Ausgangspferd auswählen.":"Please select a starting horse first.",
    "⚠️ Hauptdisziplin nicht erkannt. Bitte „Bestimmte Disziplin“ verwenden oder das Pferd mit vollständig ausgeklappten Disziplinen neu einlesen.":"⚠️ Main discipline not detected. Please use “Specific discipline” or re-read the horse with all disciplines expanded.",
    "Der Eintrag konnte nach dem Speichern nicht wiedergefunden werden.":"The entry could not be found again after saving.",
    "✓ Gespeichert ·":"✓ Saved ·",
    "Zum Verpaarungs-Log":"Open pairing log",
    "Die Verpaarung konnte nicht gemerkt werden, weil Stute oder Hengst nicht mehr eindeutig gefunden wurde.":"The pairing could not be saved because the mare or stallion could no longer be identified unambiguously.",
    "Der gemerkte Vergleich konnte nach dem Speichern nicht wiedergefunden werden.":"The saved comparison could not be found again after saving.",
    "Fehler":"Error",
    "Für diesen Ergebnisfilter gibt es keine Pferde.":"There are no horses for this result filter.",
    "Wiederherstellung fehlgeschlagen:":"Restore failed:"
  });

  Object.assign(EN, {
    "Supabase hat keine gültige neue MDR-ID geliefert.":"Supabase did not return a valid new MDR ID.",
    "Einstellung besitzt keinen Schlüssel.":"Setting has no key.",
    "MDR-Mitgliedschaft konnte nicht bestätigt werden.":"MDR membership could not be confirmed.",
    "Dieser Browser unterstützt die direkte Ordnersicherung hier nicht. Du kannst jederzeit ein JSON-Backup herunterladen.":"This browser does not support direct folder backups here. You can download a JSON backup at any time.",
    "Der Browser hat keinen Schreibzugriff auf den bisherigen Backup-Ordner erhalten. Du kannst stattdessen einen anderen Ordner wählen.":"The browser did not receive write access to the existing backup folder. You can choose a different folder instead.",
    "Weder Server-Sicherheits-Spiegel noch externer Backup-Ordner konnten geschrieben werden.":"Neither the server safety mirror nor the external backup folder could be written.",
    "Supabase hat den Erledigt-Status nicht bestätigt.":"Supabase did not confirm the done status.",
    "0 Pferde":"0 horses",
    "❄️ Snowflake wird nach der MDR-Patterntafel als P1 ✗ · P2 ✗ · P3 ✗ berechnet. Verdeckte P2/P3-Zustände der Eltern bleiben als Spanne unbekannt.":"❄️ Snowflake is calculated from the MDR pattern table as P1 ✗ · P2 ✗ · P3 ✗. Hidden P2/P3 states of the parents remain unknown as a range.",
    "Stute-Rasse":"Mare breed",
    "Stute-Besitzer":"Mare owner",
    "Fehler:":"Error:"
  });

  Object.assign(EN, {
    "Abfohldatum (TT.MM.JJJJ), leer lassen zum Entfernen:":"Foaling date (DD.MM.YYYY), leave blank to remove:",
    "Neuer Name der Filtervorlage:":"New name for the filter preset:",
    "ohne Name":"unnamed",
    "ausgewählter Ordner":"selected folder",
    "gewählter Ordner":"selected folder",
    "Noch offen":"Still open",
    "Prüfen":"Review",
    "Übernehmen":"Apply",
    "Vollständig":"Complete",
    "Nicht eindeutig":"Ambiguous",
    "Gut möglich":"Quite possible",
    "Exzellent möglich":"Excellent possible",
    "In Ordnung möglich":"Okay possible",
    "Noch nicht bewertbar":"Not assessable yet",
    "✓ zulässig":"✓ eligible",
    "✗ Nicht zulässig":"✗ Not eligible",
    "Beste Disziplin":"Best discipline",
    "Disziplin unbekannt":"Discipline unknown",
    "Schwächenausgleich":"Weakness compensation",
    "Flaxen-Träger":"Flaxen carrier",
    "Pearl-Träger":"Pearl carrier",
    "Träger (mischerbig)":"Carrier (heterozygous)",
    "Nicht getestet":"Not tested",
    "Erste Plätze:":"First places:", "Zweite Plätze:":"Second places:", "Dritte Plätze:":"Third places:",
    "Körperbau":"Conformation", "Mentalität":"Mentality", "Präzision":"Precision", "Gutmütigkeit":"Good nature", "Nervenstärke":"Calmness",
    "Schulsprünge":"School Jumps", "Geländefahren":"Cross Country Driving", "Spanische Gänge":"Spanish Walk", "Holzrücken":"Pulling", "Tölt-Prüfung":"Tölt Trial",
    "Großeltern":"Grandparents", "Urgroßeltern":"Great-grandparents", "Eltern der Mutter":"Maternal grandparents", "Eltern des Vaters":"Paternal grandparents",
    "väterlicherseits":"paternal", "mütterlicherseits":"maternal", "zur Mutter":"to dam", "zum Vater":"to sire",
    "Zum Pferd":"Open horse", "Zum Pferd im Spiel":"Open horse in game",
    "Rang nach":"Rank by", "Relative Stärke":"Relative strength",
    "Aktuell:":"Current:", "Geändert":"Changed", "Geändert:":"Changed:", "Einträge":"Entries", "ausgewählt":"selected",
    "Datenqualität:":"Data quality:", "Datenlücken:":"Data gaps:", "Gespeichert:":"Saved:", "Übereinstimmung:":"Match:",
    "höher = besser":"higher = better", "besser als":"better than", "schlechter als":"worse than", "unter Hauptgrenze":"below main threshold", "unter Mindestgrenze":"below minimum threshold", "≈ unter Nebengrenze":"≈ below secondary threshold",
    "Rückschritt":"Regression", "unauffällig":"unremarkable", "Schlüsseltest":"key test"
  });

  Object.assign(EN, {
    // V54.0.50 dynamic/model fragments that are inserted as separate DOM nodes.
    "Noch ergänzen für vollständige Auswertung:":"Still needed for a complete analysis:",
    "ZS-Gesamtwert:":"Total breeding-show score:",
    "Historische Bonusdaten zum ZS-Eintrag fehlen noch.":"Historical bonus data for the breeding-show entry is still missing.",
    "Mögliche Dubletten nach Werten:":"Possible duplicates by values:",
    "Mögliche Dubletten:":"Possible duplicates:",
    "Gewünschtes Muster:":"Desired pattern:",
    "Höhere berechenbare Chancen werden bevorzugt.":"Higher calculable probabilities are preferred.",
    "Lernmodell:":"Learning model:",
    "Getestete Modellvarianten vergleichen":"Compare tested model variants",
    "Größte Kreuzvalidierungs-Abweichungen":"Largest cross-validation deviations",
    "Formel des automatisch gewählten Modells:":"Formula of the automatically selected model:",
    "Modell":"Model",
    "Linear · 4 Kernwerte":"Linear · 4 core values",
    "Linear · fachlich gerichtet":"Linear · domain-directed",
    "Ext-Zusammenspiel":"Conformation interaction",
    "Ext-Zusammenspiel · gerichtet":"Conformation interaction · directed",
    "Sanft nichtlinear":"Gently nonlinear",
    "Gerichtet":"Directed",
    "Gerichtet + Ext × Ext%":"Directed + Conformation × Conformation %",
    "Nichtlinear":"Nonlinear",
    "4 Kernwerte; bekannte Wirkungsrichtungen begrenzt":"4 core values; known effect directions constrained",
    "4 Kernwerte + Wechselwirkung Ext × Ext%":"4 core values + Conformation × Conformation % interaction",
    "4 Kernwerte + Ext × Ext%; Kernrichtungen begrenzt":"4 core values + Conformation × Conformation %; core directions constrained",
    "4 Kernwerte + Ext × Ext% + GP² + Ext%²":"4 core values + Conformation × Conformation % + GP² + Conformation %²",
    "experimentell":"experimental",
    "erste brauchbare Tendenz":"first usable trend",
    "brauchbare Datenbasis":"usable data basis",
    "gute Datenbasis":"good data basis",
    "deutlich stabilere Datenbasis":"significantly more stable data basis",
    "reines RMSE-Minimum":"pure RMSE minimum",
    "Erbkrankheit":"hereditary disease",
    "ZS-Grundwert":"breeding-show baseline",
    "CV-Prognose":"CV forecast",
    "Abweichung":"deviation",
    "Keine aktive Rasse im aktuellen Filter.":"No active breed in the current filter.",
    "Keine Pferde im aktuellen Filter.":"No horses in the current filter.",
    "Keine Pferde gefunden.":"No horses found.",
    "Für dieses Pferd fehlen noch vollständige Turnier-Potenzialwerte.":"Complete competition-potential values are still missing for this horse.",
    "Ausgangspferd und mindestens einen Gegenpartner auswählen.":"Select the starting horse and at least one counterpart.",
    "Noch nichts gemerkt.":"Nothing saved yet.",
    "Keine Präferenz":"No preference",
    "Keine Änderung ausgewählt.":"No change selected.",
    "Bitte mindestens ein Schlagwort auswählen. Zum vollständigen Leeren der Schlagwörter bitte die Pferde einzeln prüfen.":"Please select at least one tag. To clear all tags completely, review the horses individually.",
    "Bitte zuerst mindestens ein Pferd über das Häkchen auswählen.":"Please select at least one horse using the checkbox first.",
    "Zucht & Nachzucht":"Breeding & offspring",
    "Meine Rassenauswahl":"My breed selection",
    "Neu (jetzt eingegeben)":"New (entered now)",
    "Besitzer bzw. Schlagwort aktualisieren":"Update owner or tag",
    "Nachzuchtvergleich und Verpaarungsbewertung funktionieren sauber.":"Offspring comparison and pairing evaluation work reliably.",
    "Grundfarben, MDR-Schattierungsstufen, LP-Scheckungsmuster und beobachtete Grundfarben-Vererbung im aktuell gefilterten Bestand.":"Base colours, MDR shade levels, LP spotting patterns and observed base-colour inheritance in the currently filtered stock.",
    ". Höhere berechenbare Chancen werden bevorzugt.":". Higher calculable probabilities are preferred.",
    "✓ Gespeichert ·":"✓ Saved ·",
    "· ausgewählt:":"· selected:",
    "Kreuzvalidierung: MAE":"Cross-validation: MAE",
    "Ø-Baseline: MAE":"Ø baseline: MAE"
  });

  const EXACT_REVERSE = Object.fromEntries(Object.entries(EN).map(([de,en]) => [en,de]));

  const DYNAMIC_EN = [
    [/^Das gefundene Pferd hat bereits folgende Schlagwörter: (.+?)\.\n\nOK = behalten und mit den neu angehakten zusammenführen\.\nAbbrechen = entfernen, nur die im Formular angehakten Schlagwörter übernehmen\.$/s, 'The matched horse already has these tags: $1.\n\nOK = keep them and merge with the newly selected tags.\nCancel = remove them and keep only the tags selected in the form.'],
    [/^„(.+?)“ wirklich rückgängig machen\?$/s, 'Really undo “$1”?'],
    [/^⚠️ Dieses manuelle Backup enthält 0 Pferde\.[\s\S]*Möchtest du die 0-Pferde-Datei trotzdem nur als Download erstellen\?$/s, '⚠️ This manual backup contains 0 horses.\n\nAutomatic backup would NOT overwrite a valid state with this for safety reasons. Do you still want to create the 0-horse file as a download only?'],
    [/^Backup-Ordner „(.+?)“ wirklich vergessen\?[\s\S]*$/s, 'Really forget backup folder “$1”?\n\nExisting JSON backups in this folder will NOT be deleted. The MDR database will stop writing there automatically until you choose a new backup folder.'],
    [/^Es wurde keine gültige größere Sicherung gefunden\. Aktuell sind (\d+) Pferde in der lokalen Datenbank\.$/s, 'No valid larger backup was found. There are currently $1 horses in the local database.'],
    [/^Wiederherstellung erfolgreich\.[\s\S]*$/s, (m) => m
      .replace('Wiederherstellung erfolgreich.', 'Restore successful.')
      .replace(/(\d+) Pferde, (\d+) Verpaarungen und (\d+) ZS-Datensätze wurden aus „(.+?)“ wiederhergestellt\./, '$1 horses, $2 pairings and $3 breeding-show records were restored from “$4”.')
      .replace(/Der vorherige kleinere Stand wurde zusätzlich als „(.+?)“ gesichert\./, 'The previous smaller state was additionally saved as “$1”.')],
    [/^(.+): einschließen$/s, (m, label) => `${EN[label] ?? label}: include`],
    [/^(.+): ausschließen$/s, (m, label) => `${EN[label] ?? label}: exclude`],
    [/^(.+): neutral$/s, (m, label) => `${EN[label] ?? label}: neutral`],
    [/^Zucht- und Nachzuchtdaten konnten nicht ausgewertet werden:\s*(.+)$/s, 'Breeding and offspring data could not be analysed: $1'],
    [/^verwertbare echte Zuchtschau-Grundwerte\. Ab n=8 startet eine vorsichtige Prognose\.(?: Noch nicht im Lernmodell: (.+)\.)?$/s, (m, waiting) => `usable actual breeding-show baselines. A cautious forecast starts at n=8.${waiting ? ` Not yet in the learning model: ${waiting}.` : ''}`],
    [/^· ausgewählt:$/s, '· selected:'],
    [/^· (\d+) Einträge$/, '· $1 entries'],
    [/^(.+?): positive eingetragene ZS-Gesamtwerte nach Eintragungsdatum\. Ein Eintrag gilt als Gewinnwert der betreffenden Zuchtschau\.$/s, '$1: positive entered total breeding-show scores by entry date. An entry is treated as the winning value of the respective breeding show.'],
    [/^(\d+) Referenzpferde · (\d+) LK-Stufen mit gleich gewichteten Hauptgruppen$/s, '$1 reference horses · $2 licence levels with equally weighted main groups'],
    [/^🔎 Mögliche Dubletten: (\d+)$/, '🔎 Possible duplicates: $1'],
    [/^innerhalb (\d+)% RMSE-Toleranz$/, 'within $1% RMSE tolerance'],
    [/^Noch nicht im Lernmodell: (.+)\.$/s, 'Not yet in the learning model: $1.'],
    [/^Nicht zum Lernen verwendet: (.+)\.$/s, 'Not used for learning: $1.'],
    [/^(\d+) ZS-Datensätze ohne historischen Bonus-Snapshot$/, '$1 breeding-show records without a historical bonus snapshot'],
    [/^(\d+) ZS-Datensätze mit unvollständigen GP\/Ext\/Ext%\/Int-Daten$/, '$1 breeding-show records with incomplete GP/Conformation/Conformation %/Temperament data'],
    [/^(\d+) Züchter ausgewählt · gespeichert$/, '$1 breeders selected · saved'],
    [/^Alle (\d+) aktiven Züchter$/, 'All $1 active breeders'],
    [/^(\d+) ausgewählt$/, '$1 selected'],
    [/^(\d+) Einträge$/, '$1 entries'],
    [/^(\d+) von (\d+) Pferden werden tatsächlich geändert\.$/, '$1 of $2 horses will actually be changed.'],
    [/^(\d+) Pferde ausgewählt$/, '$1 horses selected'],
    [/^(\d+) von (\d+) Pferden konnten nicht aktualisiert werden:\s*(.+)$/s, '$1 of $2 horses could not be updated: $3'],
    [/^(\d+) Pferd(?:e)? konnte(?:n)? nicht aktualisiert werden:\s*(.+)$/s, '$1 horse(s) could not be updated: $2'],
    [/^(\d+) Pferd(?:e)? (?:bleibt|bleiben) automatisch Lerndatei.*$/s, '$1 horse(s) remain in the learning file automatically (GBH tag or owner with “(GBH)”/“(Friedhof)”).'],
    [/^Deckhengst:\s*(.+?)\s*×\s*Stute:\s*(.+?)\. Wenn das Fohlen bereits gespeichert ist, oben einfach auswählen und verknüpfen\.$/s, 'Stallion: $1 × Mare: $2. If the foal is already stored, simply select and link it above.'],
    [/^Deckhengst:\s*(.+?)\s*×\s*Stute:\s*(.+?)\. Ein bereits vorhandenes Pferd kann oben direkt verknüpft werden\.$/s, 'Stallion: $1 × Mare: $2. An existing horse can be linked directly above.'],
    [/^Aktuell:\s*(.+?) · klicken, um einen anderen Ordner zu wählen$/s, 'Current: $1 · click to choose a different folder'],
    [/^Aktueller Backup-Ordner:\s*(.+?)\. Der Browser benötigt erneut Schreibzugriff\. Du kannst ihn freigeben oder einen anderen Ordner wählen\.$/s, 'Current backup folder: $1. The browser needs write access again. You can grant it or choose another folder.'],
    [/^Aktueller Backup-Ordner:\s*(.+?)\. Lokale Änderungen vorhanden – Autosave wird geschrieben\.(.+)$/s, 'Current backup folder: $1. Local changes detected – autosave is being written.$2'],
    [/^Aktueller Backup-Ordner:\s*(.+?) · Autosave:\s*(.+)$/s, 'Current backup folder: $1 · Autosave: $2'],
    [/^Aktueller Backup-Ordner:\s*(.+?) · bereit(.*)$/s, 'Current backup folder: $1 · ready$2'],
    [/^Der aktuelle Stand mit (\d+) Pferden und (\d+) ZS-Datensätzen wurde bewusst als neue gültige Sicherungsbasis gespeichert\.$/s, 'The current state with $1 horses and $2 breeding-show records was deliberately saved as the new valid backup baseline.'],
    [/^Backup-Ordner „(.+?)“ gespeichert und sofort mit einem geprüften aktuellen Backup befüllt\.$/s, 'Backup folder “$1” saved and immediately populated with a verified current backup.'],
    [/^Backup-Ordner „(.+?)“ wurde aus der MDR-Datenbank entfernt\. Die Dateien im Ordner selbst bleiben unverändert erhalten\.$/s, 'Backup folder “$1” was removed from the MDR database. The files in the folder itself remain unchanged.'],
    [/^Bereinigte Lerndatei erstellt:\s*(\d+) Pferde\/Fohlen, davon (\d+) mit echten ZS-Punkten\. Besitzer aller exportierten Datensätze: Lerndatei\.$/s, 'Cleaned learning file created: $1 horses/foals, including $2 with actual breeding-show points. Owner of all exported records: Learning file.'],
    [/^Filtervorlage „(.+?)“ wirklich löschen\?$/s, 'Really delete filter preset “$1”?'],
    [/^Schlagwort „(.+?)“ löschen\? Vorhandene Zuordnungen bei Pferden werden ebenfalls entfernt\.$/s, 'Delete tag “$1”? Existing assignments on horses will also be removed.'],
    [/^Das Schlagwort „(.+?)“ kommt doppelt vor\.$/s, 'The tag “$1” occurs more than once.'],
    [/^Noch keine ZS-Prognose: aktuell (\d+) verwertbare echte ZS-Datensätze, mindestens (\d+) nötig\.$/s, 'No breeding-show forecast yet: currently $1 usable actual show records; at least $2 are required.'],
    [/^Zuletzt aktualisiert:\s*(.+?) · (.+)$/s, 'Last updated: $1 · $2'],
    [/^Bitte zuerst einen Hengst auswählen\.$/s, 'Please select a stallion first.'],
    [/^Bitte zuerst eine Stute auswählen\.$/s, 'Please select a mare first.'],
    [/^(\d+) aktiv · (.+) Pferde$/, '$1 active · $2 horses'],
    [/^(\d+) Pferd$/, '$1 horse'], [/^(\d+) Pferde$/, '$1 horses'],
    [/^(\d+) Pferd(?:e)? wiederhergestellt\.$/, '$1 horse(s) restored.'],
    [/^Fehler beim Laden:\s*(.+)$/s, 'Error while loading: $1'],
    [/^Speichern fehlgeschlagen:\s*(.+)$/s, 'Save failed: $1'],
    [/^Löschen fehlgeschlagen:\s*(.+)$/s, 'Deletion failed: $1'],
    [/^Import fehlgeschlagen:\s*(.+)$/s, 'Import failed: $1'],
    [/^Rückgängig fehlgeschlagen:\s*(.+)$/s, 'Undo failed: $1'],
    [/^Vorlage konnte nicht gespeichert werden:\s*(.+)$/s, 'Preset could not be saved: $1'],
    [/^Lerndatei konnte nicht erstellt werden:\s*(.+)$/s, 'Learning file could not be created: $1'],
    [/^Backup konnte nicht erstellt werden:\s*(.+)$/s, 'Backup could not be created: $1'],
    [/^Filtervorlage:\s*(.+)$/s, 'Filter preset: $1'],
    [/^Nächstes Abfohldatum:\s*(.+)$/s, 'Next foaling date: $1'],
    [/^Aktuell:\s*(.+)$/s, 'Current: $1'],
    [/^Bitte (.+) auswählen\.$/s, 'Please select $1.'],
    [/^Keine (.+) vorhanden\.$/s, 'No $1 available.'],
  ];

  // Used only for the static HTML already present when i18n.js starts. This
  // makes long explanatory copy bilingual without touching user-entered data.
  const STATIC_REPLACEMENTS = [
    ['Pferdedatenbank','horse database'], ['Pferdeseite','horse page'], ['Pferde','horses'], ['Pferd','horse'],
    ['Besitzer','owner'], ['Rasse','breed'], ['Geschlecht','sex'], ['Zuchtzulassung','breeding licence'],
    ['Zuchtschau','breeding show'], ['Zucht','breeding'], ['Turnier','competition'], ['Verpaarung','pairing'],
    ['Verpaarungen','pairings'], ['Fohlen','foal'], ['Hengst','stallion'], ['Stute','mare'],
    ['Datenbank','database'], ['Daten','data'], ['Filter','filters'], ['Schlagwörter','tags'], ['Schlagwort','tag'],
    ['Genetik','genetics'], ['Exterieur','conformation'], ['Interieur','temperament'], ['Erbkrankheiten','hereditary diseases'],
    ['Lerndatei','learning file'], ['Zuchtplaner','breeding planner'], ['Aussortierhilfe','selection helper'],
    ['Einstellungen','settings'], ['Sicherung','backup'], ['Datensicherung','backup'], ['Ordner','folder'],
    ['Speichern','save'], ['gespeichert','saved'], ['speichern','save'], ['Löschen','delete'], ['löschen','delete'],
    ['anzeigen','show'], ['auswählen','select'], ['Auswahl','selection'], ['wählen','select'], ['laden','load'],
    ['berechnet','calculated'], ['berechnen','calculate'], ['prüfen','review'], ['Prüfung','check'],
    ['vollständig','complete'], ['Unvollständig','Incomplete'], ['unvollständig','incomplete'],
    ['aktuell','current'], ['Aktuelle','Current'], ['vorhanden','available'], ['Vorhandenes','Existing'],
    ['gemeinsamen','shared'], ['Gemeinsame','Shared'], ['automatisch','automatically'], ['Automatisch','Automatically'],
    ['optional','optional'], ['nur','only'], ['Nur','Only'], ['ohne','without'], ['Ohne','Without'],
    ['mit','with'], ['Mit','With'], ['für','for'], ['Für','For'], ['und','and'], ['oder','or'],
    ['nicht','not'], ['Keine','No'], ['keine','no'], ['Alle','All'], ['alle','all'], ['Ja','Yes'], ['Nein','No'],
    ['Bitte','Please'], ['Wichtig','Important'], ['Hinweis','Note'], ['Fehler','Error'], ['Änderungen','changes'],
    ['Werte','values'], ['Wert','value'], ['Punkte','points'], ['Begabung','talent'], ['Schwerpunkt','focus'],
    ['Vergleich','comparison'], ['Durchschnitt','average'], ['Bestand','stock'], ['Rassendurchschnitt','breed average'],
    ['Geburt','birth'], ['Geburtsdatum','date of birth'], ['Abfohldatum','foaling date'], ['Nachkommen','offspring'],
    ['Stammbaum','pedigree'], ['Fellfarbe','coat colour'], ['Grundfarbe','base colour'], ['Notizen','notes'],
    ['freigeschaltete','approved'], ['Nutzer','users'], ['Anwendung','application'], ['Seite','page'],
    ['zur Verfügung','available'], ['kann jederzeit','can be changed at any time'], ['bleiben','remain'],
  ].sort((a,b)=>b[0].length-a[0].length);

  function translateExactOrDynamic(raw) {
    const original = String(raw ?? '');
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    const text = original.trim();
    if (!text) return original;
    if (EN[text] != null) return leading + EN[text] + trailing;
    for (const [re, replacement] of DYNAMIC_EN) {
      if (re.test(text)) return leading + text.replace(re, replacement) + trailing;
    }
    return original;
  }

  function translateStaticFallback(raw) {
    let out = translateExactOrDynamic(raw);
    if (out !== raw) return out;
    const original = String(raw ?? '');
    const leading = original.match(/^\s*/)?.[0] || '';
    const trailing = original.match(/\s*$/)?.[0] || '';
    let text = original.trim();
    if (!text) return original;
    let changed = false;
    for (const [de,en] of STATIC_REPLACEMENTS) {
      if (text.includes(de)) { text = text.split(de).join(en); changed = true; }
    }
    return changed ? leading + text + trailing : original;
  }

  function translateAttributeValue(value) {
    const exact = ATTR_EN[value] || EN[value];
    if (exact != null) return exact;
    return translateExactOrDynamic(value);
  }

  function protectedNode(node) {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el) return false;
    return !!el.closest('textarea,input,[contenteditable="true"],[data-i18n-skip],.mdr-account-name');
  }

  function translateNode(node, staticPass=false) {
    if (lang !== 'en' || !node || protectedNode(node)) return;
    if (node.nodeType === Node.TEXT_NODE) {
      let next = staticPass ? translateStaticFallback(node.nodeValue) : translateExactOrDynamic(node.nodeValue);
      // Dynamic UI copy often arrives as small text fragments around <strong>
      // values. Apply the broader phrase fallback only in clear UI elements;
      // never in generic table/data cells or editable/user-content elements.
      if (!staticPass && next === node.nodeValue) {
        const el = node.parentElement;
        const tag = el?.tagName || '';
        const uiTag = /^(BUTTON|LABEL|OPTION|SUMMARY|TH|H1|H2|H3|H4|H5|H6)$/.test(tag);
        const uiClass = !!el?.matches?.('.muted,.error,.notice,.tiny,.small,.flash-banner,.status,.hint,.modal-actions,.filter-group-summary-note,.dashboard-tile-caption,.tp-zs-model-status,.tp-zs-current-formula');
        if (uiTag || uiClass) next = translateStaticFallback(node.nodeValue);
      }
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    for (const attr of ['title','placeholder','aria-label']) {
      if (!el.hasAttribute(attr)) continue;
      const before = el.getAttribute(attr);
      const after = translateAttributeValue(before);
      if (after !== before) el.setAttribute(attr, after);
    }
    for (const child of [...el.childNodes]) translateNode(child, staticPass);
  }

  function installObserver() {
    if (!document.documentElement || lang !== 'en') return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          translateNode(mutation.target, false);
          continue;
        }
        for (const node of mutation.addedNodes) translateNode(node, false);
      }
    });
    observer.observe(document.documentElement, {
      subtree:true, childList:true, characterData:true, attributes:true,
      attributeFilter:['title','placeholder','aria-label']
    });
  }

  function setLanguage(next) {
    next = String(next || '').toLowerCase();
    if (!SUPPORTED.has(next)) return;
    try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    if (next !== lang) location.reload();
  }

  function createSwitcher() {
    if (document.getElementById('mdr-language-switch')) return;
    const wrap = document.createElement('div');
    wrap.id = 'mdr-language-switch';
    wrap.className = 'mdr-language-switch';
    wrap.setAttribute('data-i18n-skip','');
    wrap.setAttribute('role','group');
    wrap.setAttribute('aria-label', lang === 'en' ? 'Language' : 'Sprache');
    wrap.innerHTML = `
      <span class="mdr-language-label">${lang === 'en' ? 'Language' : 'Sprache'}</span>
      <button type="button" class="mdr-language-btn${lang==='de'?' active':''}" data-lang="de" aria-pressed="${lang==='de'}">DE</button>
      <button type="button" class="mdr-language-btn${lang==='en'?' active':''}" data-lang="en" aria-pressed="${lang==='en'}">EN</button>`;
    wrap.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-lang]');
      if (btn) setLanguage(btn.dataset.lang);
    });
    const topbar = document.querySelector('.topbar');
    const loginCard = document.querySelector('.mdr-login-card');
    if (topbar) topbar.appendChild(wrap);
    else if (loginCard) loginCard.prepend(wrap);
    else document.body.prepend(wrap);
  }

  function translateDocument() {
    document.documentElement.lang = lang;
    if (lang === 'en') {
      document.title = translateStaticFallback(document.title);
      translateNode(document.body, true);
    }
    createSwitcher();
  }

  // Native dialogs are outside the DOM, so translate them explicitly.
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.alert = (message) => nativeAlert(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message);
  window.confirm = (message) => nativeConfirm(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message);
  window.prompt = (message, defaultValue) => nativePrompt(lang === 'en' ? translateStaticFallback(String(message ?? '')) : message, defaultValue);

  window.MDR_I18N = {
    get language(){ return lang; },
    setLanguage,
    t(text){ return lang === 'en' ? translateExactOrDynamic(text) : String(text ?? ''); },
    translateElement(el){ translateNode(el, false); },
    translations: EN,
  };
  window.mdrT = (text) => window.MDR_I18N.t(text);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', translateDocument, { once:true });
  } else translateDocument();
  installObserver();
})();
