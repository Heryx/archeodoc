import { useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { buildProjectUrl } from "@/lib/project";
import { Button } from "@/components/ui/button";
import { getUSRelations } from "@/lib/us_relations";

type USAIPanelProps = {
  us: any;
  cantiereId?: number;
  schedaAiGenerata?: string | null;
};

const CELL = "border border-border px-2 py-1 align-top";

function Head({ children, colSpan }: { children: ReactNode; colSpan?: number }) {
  return (
    <th colSpan={colSpan} className={`${CELL} bg-muted text-left text-[10px] font-semibold uppercase tracking-wide`}>
      {children}
    </th>
  );
}

function Val({ children, colSpan, minH }: { children?: ReactNode; colSpan?: number; minH?: boolean }) {
  const empty = children == null || children === "";
  return (
    <td colSpan={colSpan} className={`${CELL} whitespace-pre-wrap ${minH ? "h-12" : ""}`}>
      {empty ? <span className="text-muted-foreground/50">—</span> : children}
    </td>
  );
}

function Field({ label, value, colSpan }: { label: string; value: unknown; colSpan?: number }) {
  const text = value == null || value === "" ? "" : String(value);
  return (
    <td colSpan={colSpan} className={CELL}>
      <span className="text-[10px] text-muted-foreground">{label}: </span>
      <span className="font-medium">{text || "—"}</span>
    </td>
  );
}

function Checks({ options, current }: { options: string[]; current?: string | null }) {
  return (
    <span className="flex flex-wrap gap-x-4">
      {options.map((o) => (
        <span key={o}>
          {current === o ? "☑" : "☐"} {o}
        </span>
      ))}
    </span>
  );
}

function FlagList({ items }: { items: { label: string; on: boolean }[] }) {
  return (
    <span className="flex flex-col">
      {items.map((i) => (
        <span key={i.label}>
          {i.on ? "☑" : "☐"} {i.label}
        </span>
      ))}
    </span>
  );
}

function RelCell({ us, keys }: { us: any; keys: string[] }) {
  const rels = getUSRelations(us);
  const codes = keys.flatMap((k) => rels.find((r) => r.key === k)?.codes ?? []);
  return <Val>{codes.join(", ")}</Val>;
}

function SchedaPreview({ us }: { us: any }) {
  const periodo =
    us.periodoFase || [us.periodoIniziale, us.periodoFinale].filter(Boolean).join(" – ") || "";

  return (
    <div className="mt-2 overflow-x-auto rounded border border-border bg-background">
      <table className="w-full table-fixed border-collapse text-xs">
        <tbody>
          <tr>
            <th colSpan={3} className="bg-primary px-2 py-2 text-center text-sm font-semibold text-primary-foreground">
              SCHEDA DI UNITÀ STRATIGRAFICA (US)
            </th>
          </tr>
          <tr>
            <Field label="US" value={us.codiceUS} />
            <Field label="n. catalogo generale" value={us.nCatalogoGenerale} />
            <Field label="n. catalogo internazionale" value={us.nCatalogoInternazionale} />
          </tr>
          <tr>
            <Field label="Anno" value={us.anno} />
            <Field label="Area / Settore" value={us.area || us.settore} />
            <Field label="Tipo" value={us.tipo} />
          </tr>
          <tr>
            <Field label="Località" value={us.localita} colSpan={3} />
          </tr>
          <tr>
            <Field label="Quota s.l.m. (m)" value={us.quota} />
            <Field label="Quota da piano campagna (m)" value={us.quotaPianoCampagna} colSpan={2} />
          </tr>
          <tr>
            <Field label="Piante" value={us.piante} />
            <Field label="Sezioni" value={us.sezioni} />
            <Field label="Prospetti" value={us.prospetti} />
          </tr>

          <tr><Head colSpan={3}>Definizione e posizione</Head></tr>
          <tr><Val colSpan={3} minH>{us.definizione}</Val></tr>

          <tr><Head colSpan={3}>Criteri di distinzione</Head></tr>
          <tr><Val colSpan={3} minH>{us.criteriDistinzione}</Val></tr>

          <tr><Head colSpan={3}>Modo di formazione</Head></tr>
          <tr>
            <td colSpan={3} className={CELL}>
              <Checks options={["artificiale", "naturale"]} current={us.modoFormazione} />
              {us.modoFormazioneOrigine && <div className="italic">{us.modoFormazioneOrigine}</div>}
            </td>
          </tr>

          <tr>
            <Head>Componenti</Head>
            <Head>Inorganici</Head>
            <Head>Organici</Head>
          </tr>
          <tr>
            <td className={`${CELL} font-medium`}>Materiali presenti</td>
            <td className={CELL}>
              <FlagList
                items={[
                  { label: "Materiale da costruzione", on: !!us.compMaterialeCostruzione },
                  { label: "Ceramica", on: !!us.compCeramica },
                  { label: "Metalli", on: !!us.compMetalli },
                  { label: "Vetro", on: !!us.compVetro },
                  { label: "Ciottoli", on: !!us.compCiottoli },
                  { label: "Ghiaia", on: !!us.compGhiaia },
                  { label: us.compAltroInorganico ? `Altro: ${us.compAltroInorganico}` : "Altro", on: !!us.compAltroInorganico },
                ]}
              />
            </td>
            <td className={CELL}>
              <FlagList
                items={[
                  { label: "Reperti faunistici", on: !!us.compFauna },
                  { label: "Osso", on: !!us.compOsso },
                  { label: "Corno", on: !!us.compCorno },
                  { label: "Semi", on: !!us.compSemi },
                  { label: "Frutti", on: !!us.compFrutti },
                  { label: "Carboni", on: !!us.compCarboni },
                  { label: "Legno", on: !!us.compLegno },
                  { label: "Tessuti", on: !!us.compTessuti },
                  { label: us.compAltroOrganico ? `Altro: ${us.compAltroOrganico}` : "Altro", on: !!us.compAltroOrganico },
                ]}
              />
            </td>
          </tr>
          <tr>
            <td className={`${CELL} font-medium`}>Densità del materiale</td>
            <td className={CELL}><Checks options={["fitta", "media", "rada"]} current={us.densitaInorganici} /></td>
            <td className={CELL}><Checks options={["fitta", "media", "rada"]} current={us.densitaOrganici} /></td>
          </tr>

          <tr>
            <Head>Consistenza</Head>
            <Head>Colore</Head>
            <Head>Misure</Head>
          </tr>
          <tr>
            <Val>{us.consistenza}</Val>
            <Val>{us.colore}</Val>
            <Val>{us.misure}</Val>
          </tr>

          <tr><Head colSpan={3}>Stato di conservazione</Head></tr>
          <tr>
            <td colSpan={3} className={CELL}>
              <Checks options={["Intatto", "Buono", "Discreto", "Mediocre", "Pessimo"]} current={us.statoConservazione} />
              <div>
                <span className="font-semibold">L'unità è stata danneggiata da: </span>
                {us.danneggiatoDa || "—"}
              </div>
            </td>
          </tr>

          <tr><Head colSpan={3}>Descrizione</Head></tr>
          <tr><Val colSpan={3} minH>{us.descrizione}</Val></tr>

          <tr><Head colSpan={3}>Rapporti fisici</Head></tr>
          <tr>
            <Head>Uguale a</Head>
            <Head>Si lega a</Head>
            <Head>Sequenza fisica</Head>
          </tr>
          <tr>
            <RelCell us={us} keys={["uguale_a"]} />
            <RelCell us={us} keys={["si_lega_a"]} />
            <Val>{us.sequenzaFisica}</Val>
          </tr>
          {(
            [
              ["Gli si appoggia", "gliSiAppoggia", "Si appoggia a", "siAppoggia"],
              ["Coperto da", "coperto_da", "Copre", "copre"],
              ["Tagliato da", "tagliatoDa", "Taglia", "taglia"],
              ["Riempito da", "riempitoDa", "Riempie", "riempie"],
            ] as const
          ).map(([l1, k1, l2, k2]) => (
            <tr key={k1}>
              <td className={CELL}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l1}</div>
                <div>{getUSRelations(us).find((r) => r.key === k1)?.codes.join(", ") || "—"}</div>
              </td>
              <td className={CELL}>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{l2}</div>
                <div>{getUSRelations(us).find((r) => r.key === k2)?.codes.join(", ") || "—"}</div>
              </td>
              <td className={CELL} />
            </tr>
          ))}

          <tr><Head colSpan={3}>Rapporti stratigrafici</Head></tr>
          <tr>
            <Head>Posteriore a</Head>
            <Head colSpan={2}>Anteriore a</Head>
          </tr>
          <tr>
            <RelCell us={us} keys={["posterioreA"]} />
            <td colSpan={2} className={CELL}>
              {getUSRelations(us).find((r) => r.key === "anterioreA")?.codes.join(", ") || (
                <span className="text-muted-foreground/50">—</span>
              )}
            </td>
          </tr>

          <tr><Head colSpan={3}>Osservazioni</Head></tr>
          <tr>
            <td colSpan={3} className={CELL}>
              <FlagList
                items={[
                  { label: "L'unità è stata scavata integralmente", on: !!us.scavataIntegralmente },
                  { label: "L'unità è stata scavata parzialmente", on: !!us.scavataParzialmente },
                  {
                    label: us.corrispondeAltraUnita
                      ? `L'unità corrisponde ad un'altra unità: ${us.corrispondeAltraUnita}`
                      : "L'unità corrisponde ad un'altra unità dello scavo",
                    on: !!us.corrispondeAltraUnita,
                  },
                  { label: "L'unità è stata asportata insieme ad altri strati", on: !!us.asportataConAltriStrati },
                ]}
              />
              {us.altroScavo && <div>Altro: {us.altroScavo}</div>}
            </td>
          </tr>

          <tr><Head colSpan={3}>Interpretazione</Head></tr>
          <tr><Val colSpan={3} minH>{us.interpretazione}</Val></tr>

          <tr><Head colSpan={3}>Elementi datanti</Head></tr>
          <tr>
            <td colSpan={3} className={CELL}>
              <Checks options={["Sequenza stratigrafica", "Reperti diagnostici"]} current={us.elementiDatanti} />
            </td>
          </tr>

          <tr>
            <Head>Datazione</Head>
            <Head>Periodo o fase</Head>
            <Head>Epoca</Head>
          </tr>
          <tr>
            <Val>{us.datazione}</Val>
            <Val>{periodo}</Val>
            <Val>{us.epoca}</Val>
          </tr>

          <tr><Head colSpan={3}>Dati quantitativi dei reperti</Head></tr>
          <tr><Val colSpan={3}>{us.datiQuantitativiReperti || us.materialiRinvenuti}</Val></tr>

          <tr>
            <Head>Campionature</Head>
            <Head>Flottazione</Head>
            <Head>Setacciatura</Head>
          </tr>
          <tr>
            <Field label="n." value={us.campionatureN || us.campioni} />
            <td className={CELL}><Checks options={["di tutta l'unità", "parziale"]} current={us.flottazioneTipo} /></td>
            <td className={CELL}><Checks options={["di tutta l'unità", "parziale"]} current={us.setacciaturaTipo} /></td>
          </tr>

          <tr>
            <Head>Affidabilità stratigrafica</Head>
            <Head>Responsabile SABAP</Head>
            <Head>Responsabile scavo</Head>
          </tr>
          <tr>
            <td className={CELL}><Checks options={["nessuna", "modesta", "buona"]} current={us.affidabilitaStratigrafica} /></td>
            <Val>{us.responsabileSabap}</Val>
            <Val>{us.responsabileScavo}</Val>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function USAIPanel({ us, schedaAiGenerata }: USAIPanelProps) {
  const [showScheda, setShowScheda] = useState(false);

  if (!schedaAiGenerata) return null;

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex justify-between items-center mb-2">
        <span className="text-xs font-medium text-muted-foreground">Scheda AI generata</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs"
            onClick={() => setShowScheda((prev) => !prev)}
          >
            {showScheda ? "Nascondi" : "Vedi scheda"}
          </Button>
          <a href={buildProjectUrl(`/api/us/${us.id}/export-docx`)} download className="text-xs text-primary hover:underline">
            <Download size={12} className="inline mr-1" />
            Scarica .docx
          </a>
        </div>
      </div>
      {showScheda && <SchedaPreview us={us} />}
    </div>
  );
}
