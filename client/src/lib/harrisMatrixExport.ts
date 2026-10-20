import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export type ExportNode = {
  key: string;
  label: string;
  usType: "taglio" | "riempimento" | "deposito" | "struttura";
  qcStatus?: string | null;
  x: number;
  y: number;
  definizione?: string;
  tipo?: string;
};

export type ExportEdge = {
  key: string;
  from: string;
  to: string;
  type: "copre" | "riempie" | "taglia" | "appoggia" | "equivalenza" | "posteriore";
  directed: boolean;
};

export type ExportMatrixOptions = {
  cantiereCode?: string;
  cantiereName?: string;
  modeLabel?: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  nodeWidth?: number;
  nodeHeight?: number;
  svgWidth: number;
  svgHeight: number;
};

const NODE_W = 130;
const NODE_H = 46;

export function edgeColorHex(type: string): string {
  switch (type) {
    case "copre":
      return "#0f766e"; // teal
    case "riempie":
      return "#0284c7"; // sky
    case "taglia":
      return "#d97706"; // amber/orange
    case "appoggia":
      return "#475569"; // slate
    case "equivalenza":
      return "#7c3aed"; // violet
    case "posteriore":
      return "#dc2626"; // red
    default:
      return "#334155";
  }
}

export function edgeLabelText(type: string): string {
  switch (type) {
    case "copre":
      return "copre";
    case "riempie":
      return "riempie";
    case "taglia":
      return "taglia";
    case "appoggia":
      return "si appoggia";
    case "equivalenza":
      return "uguale/si lega";
    case "posteriore":
      return "posteriore a";
    default:
      return type;
  }
}

/**
 * Builds a clean, fully standalone, standards-compliant SVG document.
 * This SVG can be directly opened in Adobe Illustrator, Inkscape, Affinity Designer, QGIS, or web browsers.
 * Text and shapes are preserved as native vector objects with semantic grouping layers.
 */
export function generateHarrisMatrixSvg({
  cantiereCode = "N/D",
  cantiereName = "",
  modeLabel = "Sequenza fisica",
  nodes,
  edges,
  nodeWidth = NODE_W,
  nodeHeight = NODE_H,
  svgWidth,
  svgHeight,
}: ExportMatrixOptions): string {
  const dateStr = new Date().toLocaleDateString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  const nodeMap = new Map<string, ExportNode>();
  for (const n of nodes) {
    nodeMap.set(n.key, n);
  }

  const marginX = 40;
  const marginY = 40;
  const headerHeight = 110;
  const legendHeight = 65;

  // Calculate actual content bounds
  let minX = 0;
  let minY = 0;
  let maxX = svgWidth;
  let maxY = svgHeight;

  if (nodes.length > 0) {
    minX = Math.min(...nodes.map((n) => n.x));
    minY = Math.min(...nodes.map((n) => n.y));
    maxX = Math.max(...nodes.map((n) => n.x + nodeWidth));
    maxY = Math.max(...nodes.map((n) => n.y + nodeHeight));
  }

  const contentW = Math.max(maxX - minX + marginX * 2, 750);
  const contentH = maxY - minY + marginY * 2;
  const totalW = Math.max(contentW, 850);
  const totalH = headerHeight + contentH + legendHeight + 40;

  // Shift nodes so they fit cleanly below header
  const shiftX = marginX - minX + (totalW - contentW) / 2;
  const shiftY = headerHeight + marginY - minY;

  const positionedNodes = nodes.map((n) => ({
    ...n,
    x: n.x + shiftX,
    y: n.y + shiftY,
  }));

  const posMap = new Map<string, { x: number; y: number; node: ExportNode }>();
  for (const n of positionedNodes) {
    posMap.set(n.key, { x: n.x, y: n.y, node: n });
  }

  // Generate SVG parts
  let svg = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" style="background-color: #faf8f5; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <defs>
    <!-- Filtro ombra per nodi -->
    <filter id="box-shadow" x="-5%" y="-5%" width="115%" height="115%" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#4a3b2c" flood-opacity="0.10" />
    </filter>
    
    <!-- Marker frecce orientate per relazioni -->
    <marker id="arr-copre" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#0f766e" />
    </marker>
    <marker id="arr-riempie" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#0284c7" />
    </marker>
    <marker id="arr-taglia" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#d97706" />
    </marker>
    <marker id="arr-appoggia" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#475569" />
    </marker>
    <marker id="arr-posteriore" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 9 5 L 0 9 z" fill="#dc2626" />
    </marker>

    <!-- Pattern archeologici -->
    <pattern id="hatch-cut" width="8" height="8" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
      <line x1="0" y1="0" x2="0" y2="8" stroke="#f59e0b" stroke-width="1.5" opacity="0.25" />
    </pattern>
    <pattern id="dots-fill" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1" fill="#0284c7" opacity="0.3" />
    </pattern>
  </defs>

  <!-- SFONDO TAVOLA -->
  <rect width="${totalW}" height="${totalH}" fill="#faf8f5" />
  
  <!-- CORNICE TAVOLA -->
  <rect x="15" y="15" width="${totalW - 30}" height="${totalH - 30}" fill="none" stroke="#d5ccbe" stroke-width="1.5" rx="8" />

  <!-- CARTIGLIO / HEADER TAVOLA ARCHEOLOGICA -->
  <g id="layer-cartiglio">
    <rect x="25" y="25" width="${totalW - 50}" height="75" fill="#f3efe8" stroke="#c8beaf" stroke-width="1.2" rx="6" />
    
    <!-- Titolo principale -->
    <text x="45" y="55" font-size="20" font-weight="700" fill="#8c3a1e" letter-spacing="0.5">HARRIS MATRIX</text>
    <text x="45" y="78" font-size="12" font-weight="500" fill="#605445">ArcheoDoc · Documentazione Stratigrafica</text>
    
    <!-- Dati cantiere -->
    <text x="${totalW - 45}" y="52" text-anchor="end" font-size="14" font-weight="700" fill="#2d241e">Cantiere: ${escapeXml(cantiereCode)} ${cantiereName ? `(${escapeXml(cantiereName)})` : ""}</text>
    <text x="${totalW - 45}" y="72" text-anchor="end" font-size="11.5" font-weight="500" fill="#605445">Modalità: <tspan font-weight="700">${escapeXml(modeLabel)}</tspan> | US: <tspan font-weight="700">${nodes.length}</tspan> | Relazioni: <tspan font-weight="700">${edges.length}</tspan> | Data: ${dateStr}</text>
  </g>

  <!-- LAYER CONNESSIONI STRATIGRAFICHE -->
  <g id="layer-connessioni">
`;

  // Draw Edges
  for (const edge of edges) {
    const fp = posMap.get(edge.from);
    const tp = posMap.get(edge.to);
    if (!fp || !tp) continue;

    const color = edgeColorHex(edge.type);

    if (edge.type === "equivalenza") {
      const y = fp.y + nodeHeight / 2;
      const x1 = fp.x + nodeWidth;
      const x2 = tp.x;
      const mx = (x1 + x2) / 2;
      svg += `    <g id="edge-${escapeXml(edge.key)}">
      <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${color}" stroke-width="2" stroke-dasharray="5 4" opacity="0.9" />
      <circle cx="${mx}" cy="${y}" r="8" fill="#faf8f5" stroke="${color}" stroke-width="1.2" />
      <text x="${mx}" y="${y + 3.5}" text-anchor="middle" font-size="11" font-weight="700" fill="${color}">=</text>
    </g>\n`;
    } else {
      const x1 = fp.x + nodeWidth / 2;
      const y1 = fp.y + nodeHeight;
      const x2 = tp.x + nodeWidth / 2;
      const y2 = tp.y;
      const my2 = (y1 + y2) / 2;

      let pathData: string;
      if (Math.abs(x2 - x1) < 2) {
        pathData = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        pathData = `M ${x1} ${y1} L ${x1} ${my2} L ${x2} ${my2} L ${x2} ${y2}`;
      }

      svg += `    <g id="edge-${escapeXml(edge.key)}">
      <path d="${pathData}" stroke="${color}" stroke-width="2" fill="none" marker-end="url(#arr-${edge.type})" opacity="0.9" stroke-linejoin="round" stroke-linecap="round" />
    </g>\n`;
    }
  }

  svg += `  </g>\n\n  <!-- LAYER NODI (UNITA STRATIGRAFICHE) -->\n  <g id="layer-unita-stratigrafiche">\n`;

  // Draw Nodes
  for (const item of positionedNodes) {
    const cx = item.x + nodeWidth / 2;
    const cy = item.y + nodeHeight / 2;
    const keyAttr = escapeXml(item.key);
    const labelText = escapeXml(item.label || item.key);

    let shapeSvg = "";
    if (item.usType === "taglio") {
      // Interfaccia negativa / Taglio: Ellisse / Capsula con tratteggio
      shapeSvg = `      <rect x="${item.x}" y="${item.y}" width="${nodeWidth}" height="${nodeHeight}" rx="${nodeHeight / 2}" fill="#fffbeb" stroke="#d97706" stroke-width="2" stroke-dasharray="5 3" filter="url(#box-shadow)" />
      <rect x="${item.x + 3}" y="${item.y + 3}" width="${nodeWidth - 6}" height="${nodeHeight - 6}" rx="${(nodeHeight - 6) / 2}" fill="url(#hatch-cut)" stroke="none" pointer-events="none" />`;
    } else if (item.usType === "riempimento") {
      // Riempimento: Rettangolo a doppio bordo
      shapeSvg = `      <rect x="${item.x}" y="${item.y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="#f0f9ff" stroke="#0284c7" stroke-width="2" filter="url(#box-shadow)" />
      <rect x="${item.x + 3.5}" y="${item.y + 3.5}" width="${nodeWidth - 7}" height="${nodeHeight - 7}" rx="4" fill="none" stroke="#0284c7" stroke-width="1" opacity="0.6" stroke-dasharray="3 2" />`;
    } else if (item.usType === "struttura") {
      // USM / Struttura muraria: Bordo mattone / doppio bordo
      shapeSvg = `      <rect x="${item.x}" y="${item.y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="#fdf2f8" stroke="#be185d" stroke-width="2" filter="url(#box-shadow)" />
      <line x1="${item.x + 8}" y1="${item.y}" x2="${item.x + 8}" y2="${item.y + nodeHeight}" stroke="#be185d" stroke-width="1.5" opacity="0.6" />
      <line x1="${item.x + nodeWidth - 8}" y1="${item.y}" x2="${item.x + nodeWidth - 8}" y2="${item.y + nodeHeight}" stroke="#be185d" stroke-width="1.5" opacity="0.6" />`;
    } else {
      // Deposito / Strato: Rettangolo standard
      shapeSvg = `      <rect x="${item.x}" y="${item.y}" width="${nodeWidth}" height="${nodeHeight}" rx="6" fill="#ffffff" stroke="#2d241e" stroke-width="2" filter="url(#box-shadow)" />`;
    }

    svg += `    <g id="node-${keyAttr}" class="harris-node" data-code="${keyAttr}">
${shapeSvg}
      <!-- Testo codice US -->
      <text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#1e1915" letter-spacing="0.3">${labelText}</text>
    </g>\n`;
  }

  // Draw Legend at the bottom
  const legY = totalH - legendHeight - 15;
  svg += `  </g>\n\n  <!-- LEGENDA ARCHEOLOGICA -->
  <g id="layer-legenda">
    <rect x="25" y="${legY}" width="${totalW - 50}" height="${legendHeight}" fill="#f3efe8" stroke="#c8beaf" stroke-width="1.2" rx="6" />
    
    <!-- Sezione forme US -->
    <text x="40" y="${legY + 22}" font-size="11" font-weight="700" fill="#4a3b2c" text-transform="uppercase">Forme US:</text>
    
    <!-- Strato -->
    <rect x="110" y="${legY + 11}" width="24" height="14" rx="2" fill="#fff" stroke="#2d241e" stroke-width="1.5" />
    <text x="140" y="${legY + 22}" font-size="11" fill="#2d241e">Deposito / Strato</text>
    
    <!-- Taglio -->
    <rect x="245" y="${legY + 11}" width="24" height="14" rx="7" fill="#fffbeb" stroke="#d97706" stroke-width="1.5" stroke-dasharray="3 2" />
    <text x="275" y="${legY + 22}" font-size="11" fill="#2d241e">Taglio / Negativo</text>
    
    <!-- Riempimento -->
    <rect x="390" y="${legY + 11}" width="24" height="14" rx="2" fill="#f0f9ff" stroke="#0284c7" stroke-width="1.5" />
    <text x="420" y="${legY + 22}" font-size="11" fill="#2d241e">Riempimento</text>

    <!-- Struttura -->
    <rect x="525" y="${legY + 11}" width="24" height="14" rx="2" fill="#fdf2f8" stroke="#be185d" stroke-width="1.5" />
    <text x="555" y="${legY + 22}" font-size="11" fill="#2d241e">Struttura (USM)</text>

    <!-- Sezione relazioni -->
    <text x="40" y="${legY + 48}" font-size="11" font-weight="700" fill="#4a3b2c" text-transform="uppercase">Relazioni:</text>
    
    <line x1="110" y1="${legY + 44}" x2="132" y2="${legY + 44}" stroke="#0f766e" stroke-width="2" />
    <text x="138" y="${legY + 48}" font-size="11" fill="#0f766e" font-weight="600">Copre</text>
    
    <line x1="195" y1="${legY + 44}" x2="217" y2="${legY + 44}" stroke="#0284c7" stroke-width="2" />
    <text x="223" y="${legY + 48}" font-size="11" fill="#0284c7" font-weight="600">Riempie</text>

    <line x1="285" y1="${legY + 44}" x2="307" y2="${legY + 44}" stroke="#d97706" stroke-width="2" />
    <text x="313" y="${legY + 48}" font-size="11" fill="#d97706" font-weight="600">Taglia</text>

    <line x1="370" y1="${legY + 44}" x2="392" y2="${legY + 44}" stroke="#475569" stroke-width="2" />
    <text x="398" y="${legY + 48}" font-size="11" fill="#475569" font-weight="600">Si appoggia</text>

    <line x1="485" y1="${legY + 44}" x2="507" y2="${legY + 44}" stroke="#7c3aed" stroke-width="2" stroke-dasharray="3 2" />
    <text x="513" y="${legY + 48}" font-size="11" fill="#7c3aed" font-weight="600">Uguale / Si lega (=)</text>

    <line x1="645" y1="${legY + 44}" x2="667" y2="${legY + 44}" stroke="#dc2626" stroke-width="2" />
    <text x="673" y="${legY + 48}" font-size="11" fill="#dc2626" font-weight="600">Posteriore</text>
  </g>
</svg>`;

  return svg;
}

function escapeXml(unsafe: string): string {
  return String(unsafe ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Downloads a string content as a client-side file.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export Harris Matrix as standalone vector SVG file.
 */
export function exportMatrixAsSvg(options: ExportMatrixOptions, filename?: string): void {
  const svgContent = generateHarrisMatrixSvg(options);
  const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
  const fname = filename || `Harris_Matrix_${options.cantiereCode || "cantiere"}.svg`;
  downloadBlob(blob, fname);
}

/**
 * Converts SVG XML string to high-res HTMLCanvasElement.
 */
export async function renderSvgToCanvas(
  svgString: string,
  scale = 2,
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();

    img.onload = () => {
      const width = img.naturalWidth || 800;
      const height = img.naturalHeight || 600;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error("Impossibile inizializzare il contesto Canvas"));
        return;
      }

      // Background fill
      ctx.fillStyle = "#faf8f5";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);

      URL.revokeObjectURL(url);
      resolve({ canvas, width, height });
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}

/**
 * Export Harris Matrix as high-resolution PNG (300 DPI equivalent).
 */
export async function exportMatrixAsPng(options: ExportMatrixOptions, filename?: string): Promise<void> {
  const svgContent = generateHarrisMatrixSvg(options);
  const { canvas } = await renderSvgToCanvas(svgContent, 2.5); // 2.5x crisp rendering

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Errore durante la conversione in PNG"));
        return;
      }
      const fname = filename || `Harris_Matrix_${options.cantiereCode || "cantiere"}.png`;
      downloadBlob(blob, fname);
      resolve();
    }, "image/png");
  });
}

/**
 * Export Harris Matrix as a crisp, full visual Graphic PDF with title block and legend.
 */
export async function exportMatrixAsGraphicPdf(
  options: ExportMatrixOptions,
  filename?: string,
): Promise<void> {
  const svgContent = generateHarrisMatrixSvg(options);
  const { canvas, width, height } = await renderSvgToCanvas(svgContent, 2);

  // Convert canvas to PNG bytes
  const pngDataUrl = canvas.toDataURL("image/png");
  const pngBase64 = pngDataUrl.split(",")[1];
  const pngBytes = Uint8Array.from(atob(pngBase64), (c) => c.charCodeAt(0));

  const pdfDoc = await PDFDocument.create();

  // Determine standard A4/A3 or custom dimension fitted to diagram aspect ratio
  // Standard A4 landscape is 841.89 x 595.28 pt
  const margin = 20;
  const isWide = width > height * 1.2;
  let pageWidth: number;
  let pageHeight: number;

  if (width > 1200 || height > 850) {
    // A3 Landscape (1190.55 x 841.89) or scaled to content
    pageWidth = Math.max(width * 0.75 + margin * 2, 842);
    pageHeight = Math.max(height * 0.75 + margin * 2, 595);
  } else {
    // Standard fitted landscape
    pageWidth = Math.max(width + margin * 2, 842);
    pageHeight = Math.max(height + margin * 2, 595);
  }

  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const embeddedImage = await pdfDoc.embedPng(pngBytes);

  // Fit image proportionally within page margins
  const availW = pageWidth - margin * 2;
  const availH = pageHeight - margin * 2;
  const scaleFactor = Math.min(availW / width, availH / height, 1);

  const drawW = width * scaleFactor;
  const drawH = height * scaleFactor;
  const drawX = (pageWidth - drawW) / 2;
  const drawY = (pageHeight - drawH) / 2;

  page.drawImage(embeddedImage, {
    x: drawX,
    y: drawY,
    width: drawW,
    height: drawH,
  });

  const pdfBytes = await pdfDoc.save();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const fname = filename || `Harris_Matrix_${options.cantiereCode || "cantiere"}.pdf`;
  downloadBlob(blob, fname);
}
