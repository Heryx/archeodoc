// Larghezza di riferimento del testo nel foglio dell'editor (px). Le larghezze delle colonne
// delle tabelle sono salvate in px su questa base, e l'export Word le riporta alla pagina.
export const RELAZIONE_TEXT_WIDTH_PX = 740;

// Larghezza del testo nell'export Word (px a 96 dpi, ~15 cm)
export const RELAZIONE_EXPORT_WIDTH_PX = 560;

export type FigureAlign = "left" | "center" | "right";

// "none" = la figura sta da sola sulla riga (testo sopra e sotto); "square" = figura mobile con il testo a fianco,
// dal lato indicato dall'allineamento (a destra se "right", altrimenti a sinistra)
export type FigureWrap = "none" | "square";

export const figureWrap = (attrs: { wrap?: unknown } | null | undefined): FigureWrap => (attrs?.wrap === "square" ? "square" : "none");

export const figureFloatSide = (attrs: { align?: unknown } | null | undefined): "left" | "right" => (attrs?.align === "right" ? "right" : "left");

// Larghezza di una figura in % del testo. Le immagini di progetto salvate prima dell'introduzione
// del gestore figure avevano solo una larghezza in px (base 560).
export function figureWidthPct(attrs: { widthPct?: unknown; width?: unknown } | null | undefined): number {
  const pct = Number(attrs?.widthPct);
  if (Number.isFinite(pct) && pct > 0) return Math.min(100, Math.max(5, pct));
  const px = Number(attrs?.width);
  if (Number.isFinite(px) && px > 20) return Math.min(100, Math.round((px / RELAZIONE_EXPORT_WIDTH_PX) * 100));
  return 100;
}
