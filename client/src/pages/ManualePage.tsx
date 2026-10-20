import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, CheckSquare, Type, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Section = { id: string; title: string; content: React.ReactNode };

function Collapsible({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-md overflow-hidden mb-3">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium text-sm">{title}</span>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {open && <div className="px-4 py-4 text-sm space-y-3">{children}</div>}
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="bg-muted border border-border rounded px-1.5 py-0.5 text-xs font-mono text-primary">
      {children}
    </code>
  );
}

function PlaceholderRow({ placeholder, label, note }: { placeholder: string; label: string; note?: string }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-1.5 pr-4 font-mono text-xs text-primary whitespace-nowrap">{`{${placeholder}}`}</td>
      <td className="py-1.5 pr-4 text-xs">{label}</td>
      {note && <td className="py-1.5 text-xs text-muted-foreground italic">{note}</td>}
    </tr>
  );
}

const PLACEHOLDERS_TESTO: { placeholder: string; label: string; note?: string }[] = [
  { placeholder: "codiceUS", label: "Codice US" },
  { placeholder: "nCatalogoGenerale", label: "N. catalogo generale" },
  { placeholder: "nCatalogoInternazionale", label: "N. catalogo internazionale" },
  { placeholder: "soprintendenza", label: "Soprintendenza" },
  { placeholder: "localita", label: "Località" },
  { placeholder: "anno", label: "Anno" },
  { placeholder: "area", label: "Area" },
  { placeholder: "saggio", label: "Saggio" },
  { placeholder: "settore", label: "Settore/i" },
  { placeholder: "quadrati", label: "Quadrati/i" },
  { placeholder: "quoteSlm", label: "Quote s.l.m." },
  { placeholder: "quota", label: "Quota numerica (REAL)" },
  { placeholder: "piante", label: "Piante" },
  { placeholder: "sezioni", label: "Sezioni" },
  { placeholder: "prospetti", label: "Prospetti" },
  { placeholder: "haFoto", label: "Foto (numero)" },
  { placeholder: "tabelleMaterialiRa", label: "Tabelle materiali – RA" },
  { placeholder: "tabelleMaterialiN", label: "Tabelle materiali – N" },
  { placeholder: "definizione", label: "Definizione e posizione" },
  { placeholder: "criteriDistinzione", label: "Criteri di distinzione" },
  { placeholder: "modoFormazione", label: "Modo di formazione (testo libero)" },
  { placeholder: "altroInorganico", label: "Componenti inorganici – Altro" },
  { placeholder: "densitaInorganici", label: "Densità inorganici (testo)" },
  { placeholder: "altroOrganico", label: "Componenti organici – Altro" },
  { placeholder: "densitaOrganici", label: "Densità organici (testo)" },
  { placeholder: "consistenza", label: "Consistenza" },
  { placeholder: "colore", label: "Colore" },
  { placeholder: "misure", label: "Misure" },
  { placeholder: "danneggiatoDa", label: "Danneggiato da" },
  { placeholder: "descrizione", label: "Descrizione" },
  { placeholder: "uguale_a", label: "Uguale a" },
  { placeholder: "si_lega_a", label: "Si lega a" },
  { placeholder: "posterioreA", label: "Posteriore a" },
  { placeholder: "gliSiAppoggia", label: "Gli si appoggia" },
  { placeholder: "siAppoggia", label: "Si appoggia" },
  { placeholder: "coperto_da", label: "Coperto da" },
  { placeholder: "copre", label: "Copre" },
  { placeholder: "anterioreA", label: "Anteriore a" },
  { placeholder: "tagliatoDa", label: "Tagliato da" },
  { placeholder: "taglia", label: "Taglia" },
  { placeholder: "riempitoDa", label: "Riempito da" },
  { placeholder: "riempie", label: "Riempie" },
  { placeholder: "corrispondeAltraUnita", label: "Corrisponde altra unità (testo)" },
  { placeholder: "altroScavo", label: "Osservazioni – Altro (testo compilabile)" },
  { placeholder: "interpretazione", label: "Interpretazione" },
  { placeholder: "datazione", label: "Datazione" },
  { placeholder: "periodoFase", label: "Periodo o fase" },
  { placeholder: "epoca", label: "Epoca" },
  { placeholder: "datiQuantitativiReperti", label: "Dati quantitativi reperti" },
  { placeholder: "campionatureN", label: "Campionature n." },
  { placeholder: "affidabilitaStratigrafica", label: "Affidabilità stratigrafica (testo)" },
  { placeholder: "responsabileSabap", label: "Responsabile SABAP-UMB" },
  { placeholder: "responsabileScavo", label: "Responsabile scavo" },
  { placeholder: "cantiereCodice", label: "Codice cantiere" },
  { placeholder: "cantiereNome", label: "Nome cantiere" },
  { placeholder: "dataExport", label: "Data di esportazione (automatica)" },
];

const PLACEHOLDERS_CHECKBOX: { placeholder: string; label: string; gruppo: string }[] = [
  // Modo formazione
  { placeholder: "chkArtificiale", label: "artificiale", gruppo: "Modo di formazione" },
  { placeholder: "chkNaturale", label: "naturale", gruppo: "Modo di formazione" },
  // Componenti inorganici
  { placeholder: "chkMaterialeCostruzione", label: "Materiale da costruzione", gruppo: "Componenti inorganici" },
  { placeholder: "chkCeramica", label: "Ceramica", gruppo: "Componenti inorganici" },
  { placeholder: "chkMetalli", label: "Metalli", gruppo: "Componenti inorganici" },
  { placeholder: "chkVetro", label: "Vetro", gruppo: "Componenti inorganici" },
  { placeholder: "chkCiottoli", label: "ciottoli", gruppo: "Componenti inorganici" },
  { placeholder: "chkGhiaia", label: "ghiaia", gruppo: "Componenti inorganici" },
  { placeholder: "chkDensitaInorgFitta", label: "fitta", gruppo: "Densità inorganici" },
  { placeholder: "chkDensitaInorgMedia", label: "media", gruppo: "Densità inorganici" },
  { placeholder: "chkDensitaInorgRada", label: "rada", gruppo: "Densità inorganici" },
  // Componenti organici
  { placeholder: "chkFauna", label: "Fauna", gruppo: "Componenti organici" },
  { placeholder: "chkOsso", label: "osso", gruppo: "Componenti organici" },
  { placeholder: "chkCorno", label: "corno", gruppo: "Componenti organici" },
  { placeholder: "chkSemi", label: "semi", gruppo: "Componenti organici" },
  { placeholder: "chkFrutti", label: "frutti", gruppo: "Componenti organici" },
  { placeholder: "chkCarboni", label: "carboni", gruppo: "Componenti organici" },
  { placeholder: "chkLegno", label: "legno", gruppo: "Componenti organici" },
  { placeholder: "chkTessuti", label: "tessuti", gruppo: "Componenti organici" },
  { placeholder: "chkDensitaOrgFitta", label: "fitta", gruppo: "Densità organici" },
  { placeholder: "chkDensitaOrgMedia", label: "media", gruppo: "Densità organici" },
  { placeholder: "chkDensitaOrgRada", label: "rada", gruppo: "Densità organici" },
  // Stato conservazione
  { placeholder: "chkIntatto", label: "Intatto", gruppo: "Stato di conservazione" },
  { placeholder: "chkBuono", label: "Buono", gruppo: "Stato di conservazione" },
  { placeholder: "chkDiscreto", label: "Discreto", gruppo: "Stato di conservazione" },
  { placeholder: "chkMediocre", label: "Mediocre", gruppo: "Stato di conservazione" },
  { placeholder: "chkPessimo", label: "Pessimo", gruppo: "Stato di conservazione" },
  // Osservazioni scavo
  { placeholder: "chkScavataIntegralmente", label: "Scavata integralmente", gruppo: "Osservazioni scavo" },
  { placeholder: "chkScavataParzialmente", label: "Scavata parzialmente", gruppo: "Osservazioni scavo" },
  { placeholder: "chkCorrispondeAltraUnita", label: "Corrisponde altra unità", gruppo: "Osservazioni scavo" },
  { placeholder: "chkAsportataConAltriStrati", label: "Asportata con altri strati", gruppo: "Osservazioni scavo" },
  { placeholder: "chkAltroScavo", label: "Altro (checkbox)", gruppo: "Osservazioni scavo" },
  // Elementi datanti
  { placeholder: "chkSequenzaStratigrafica", label: "Sequenza stratigrafica", gruppo: "Elementi datanti" },
  { placeholder: "chkRepertiDiagnostici", label: "Reperti diagnostici", gruppo: "Elementi datanti" },
  // Flottazione
  { placeholder: "chkFlottazioneTutta", label: "di tutta l'unità", gruppo: "Flottazione" },
  { placeholder: "chkFlottazioneParziale", label: "parziale", gruppo: "Flottazione" },
  // Setacciatura
  { placeholder: "chkSetacciaturaTutta", label: "di tutta l'unità", gruppo: "Setacciatura" },
  { placeholder: "chkSetacciaturaParziale", label: "parziale", gruppo: "Setacciatura" },
  // Affidabilità
  { placeholder: "chkAffidNessuna", label: "nessuna", gruppo: "Affidabilità stratigrafica" },
  { placeholder: "chkAffidModesta", label: "modesta", gruppo: "Affidabilità stratigrafica" },
  { placeholder: "chkAffidBuona", label: "buona", gruppo: "Affidabilità stratigrafica" },
];

export function ManualePage() {
  const [activeSection, setActiveSection] = useState<string>("template");

  const sections: Section[] = [
    {
      id: "template",
      title: "Template DOCX — come funziona",
      content: (
        <div className="space-y-4">
          <p>
            ArcheoDoc può esportare le schede US usando un <strong>template Word personalizzato</strong> (file <code className="bg-muted px-1 rounded text-xs">.docx</code>) invece del layout generato automaticamente.
            Il template viene compilato con i dati reali di ogni US tramite la libreria <strong>docxtemplater</strong>, che sostituisce i segnaposto con i valori del database.
          </p>

          <Collapsible title="Passo 1 — Prepara il file .docx" defaultOpen>
            <p>Crea o apri il tuo template in Microsoft Word (o LibreOffice Writer). Struttura il documento esattamente come vuoi che appaia la scheda stampata: tabelle, intestazioni, loghi, sezioni.</p>
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-3 text-xs">
              <strong>Importante:</strong> il file deve essere salvato nel formato <code>.docx</code> (Word 2007+), non nel vecchio formato <code>.doc</code> o nel formato XML Word 2003.
            </div>
          </Collapsible>

          <Collapsible title="Passo 2 — Inserisci i placeholder nei campi dati" defaultOpen>
            <p>
              Nei punti in cui vuoi che appaia un valore compilato dal database, scrivi il nome del placeholder tra doppie graffe:
            </p>
            <div className="bg-muted rounded p-3 font-mono text-sm my-2">{"{{codiceUS}}"}</div>
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded p-3 text-xs">
              <strong>Attenzione — graffe singole o doppie?</strong><br />
              ArcheoDoc usa la sintassi con <strong>graffe singole</strong>: <Code>{"{codiceUS}"}</Code>.<br />
              Alcune guide online mostrano doppie graffe (stile Jinja/Mustache) — qui NON funzionano.
            </div>
            <p className="mt-2">Puoi inserire i placeholder:</p>
            <ul className="list-disc list-inside space-y-1 text-xs ml-2">
              <li>Direttamente nel testo di una cella di tabella</li>
              <li>In un paragrafo normale</li>
              <li>In un'intestazione o piè di pagina</li>
              <li>Non dentro content control nativi di Word (i campi modulo con sfondo grigio)</li>
            </ul>
          </Collapsible>

          <Collapsible title="Passo 3 — Gestisci i checkbox">
            <p>
              Word ha checkbox nativi (content control) che <strong>non possono essere compilati da codice esterno</strong>.
              La soluzione è sostituirli con simboli di testo puro.
            </p>
            <p className="mt-2 font-medium">Come fare:</p>
            <ol className="list-decimal list-inside space-y-2 text-xs ml-2">
              <li>Seleziona e <strong>cancella</strong> il checkbox Wingdings nella cella (simbolo □ in font Wingdings 2)</li>
              <li>Al suo posto, scrivi il placeholder corrispondente: es. <Code>{"{chkArtificiale}"}</Code></li>
              <li>Lascia l'etichetta testuale accanto: <Code>{"{chkArtificiale}"}</Code> artificiale</li>
            </ol>
            <p className="mt-2">ArcheoDoc inserirà automaticamente:</p>
            <ul className="list-disc list-inside space-y-1 text-xs ml-2">
              <li><strong>☑</strong> se il campo è attivo/selezionato</li>
              <li><strong>☐</strong> se il campo è vuoto/non selezionato</li>
            </ul>
            <div className="bg-muted rounded p-3 font-mono text-sm mt-2">
              {"{chkArtificiale}"} artificiale {"    "}{"{chkNaturale}"} naturale
            </div>
          </Collapsible>

          <Collapsible title="Passo 4 — Carica il template">
            <ol className="list-decimal list-inside space-y-1 text-xs ml-2">
              <li>Vai alla pagina <strong>US</strong> del cantiere</li>
              <li>Clicca su <strong>Modello scheda US</strong> (icona ingranaggio)</li>
              <li>Nella sezione <em>Template Word personalizzato</em>, clicca <strong>Importa template .docx</strong></li>
              <li>Il template viene salvato per quel cantiere specifico</li>
              <li>Da quel momento, ogni esportazione DOCX di una US userà il tuo template</li>
            </ol>
            <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3 text-xs mt-2">
              Se vuoi tornare al layout automatico, elimina il template dalla stessa finestra.
            </div>
          </Collapsible>

          <Collapsible title="Passo 5 — Diagnostica placeholder">
            <p>Se vuoi verificare quali placeholder il tuo template contiene prima di esportare, puoi usare l'endpoint diagnostico:</p>
            <div className="bg-muted rounded p-2 font-mono text-xs">
              GET /api/cantieri/[id]/us-template/placeholders
            </div>
            <p className="mt-1">Restituisce la lista di tutti i <Code>{"{placeholder}"}</Code> trovati nel template caricato.</p>
          </Collapsible>
        </div>
      ),
    },
    {
      id: "placeholders-testo",
      title: "Tutti i placeholder — campi testo",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Inserisci questi placeholder nelle celle o nei paragrafi del template. Vengono sostituiti con il valore testuale del campo corrispondente (stringa vuota se il campo non è compilato).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="text-left py-2 pr-4 font-semibold">Placeholder</th>
                  <th className="text-left py-2 pr-4 font-semibold">Voce nella scheda</th>
                </tr>
              </thead>
              <tbody>
                {PLACEHOLDERS_TESTO.map((p) => (
                  <PlaceholderRow key={p.placeholder} {...p} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ),
    },
    {
      id: "placeholders-checkbox",
      title: "Tutti i placeholder — checkbox",
      content: (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Ogni placeholder checkbox produce <strong>☑</strong> se il campo è attivo, <strong>☐</strong> se non lo è. Va scritto nel testo della cella al posto del simbolo grafico Word.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b-2 border-border">
                  <th className="text-left py-2 pr-4 font-semibold">Placeholder</th>
                  <th className="text-left py-2 pr-4 font-semibold">Etichetta</th>
                  <th className="text-left py-2 font-semibold">Sezione</th>
                </tr>
              </thead>
              <tbody>
                {PLACEHOLDERS_CHECKBOX.map((p) => (
                  <tr key={p.placeholder} className="border-b border-border last:border-0">
                    <td className="py-1.5 pr-4 font-mono text-xs text-primary whitespace-nowrap">{`{${p.placeholder}}`}</td>
                    <td className="py-1.5 pr-4 text-xs">{p.label}</td>
                    <td className="py-1.5 text-xs text-muted-foreground">{p.gruppo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-muted rounded p-3 text-xs mt-2 space-y-2">
            <p className="font-medium">Esempio — Sezione Osservazioni scavo nel template:</p>
            <div className="font-mono whitespace-pre-wrap leading-relaxed">
{`{chkScavataIntegralmente} L'unità è stata scavata integralmente    {chkScavataParzialmente} parzialmente
{chkCorrispondeAltraUnita} L'unità corrisponde ad altra unità: {corrispondeAltraUnita}
{chkAsportataConAltriStrati} L'unità è stata asportata insieme ad altri strati
{chkAltroScavo} Altro: {altroScavo}`}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "layout-automatico",
      title: "Layout automatico US Estesa ArcheoDoc (senza template)",
      content: (
        <div className="space-y-3">
          <p>
            Se non carichi nessun template, ArcheoDoc genera automaticamente una scheda DOCX a <strong>2 pagine</strong> con layout ArcheoDoc esteso, compilata con tutti i dati della US.
          </p>
          <p>Per usare questo layout, seleziona il modello <strong>"US Estesa ArcheoDoc"</strong> nelle impostazioni del cantiere (Modello scheda US). Il cantiere deve avere <code className="bg-muted px-1 rounded text-xs">usModelKey = "extended-us"</code>.</p>
          <p className="text-xs text-muted-foreground">Il layout automatico include: intestazione ArcheoDoc, Soprintendenza, tutti i campi identificativi, componenti con checkbox, sequenza fisica con Posteriore a / Anteriore a, osservazioni scavo con campo Altro, datazione, campionature, affidabilità e responsabili.</p>
        </div>
      ),
    },
  ];

  return (
    <div className="flex h-full">
      {/* Sidebar sezioni */}
      <nav className="w-56 shrink-0 border-r border-border bg-muted/20 p-4 space-y-1 overflow-y-auto">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Manuale</p>
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={cn(
              "w-full text-left text-sm rounded px-3 py-2 transition-colors",
              activeSection === s.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {s.title}
          </button>
        ))}
      </nav>

      {/* Contenuto sezione */}
      <div className="flex-1 overflow-y-auto p-6 max-w-3xl">
        {sections.map((s) =>
          s.id === activeSection ? (
            <div key={s.id}>
              <h1 className="text-xl font-bold mb-4">{s.title}</h1>
              {s.content}
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}
