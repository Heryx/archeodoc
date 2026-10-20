import proj4 from "proj4";
import { resolveProj4Def } from "./geopackage_import";

export type WorldFileParams = {
  /** pixel size X (columns) */
  a: number;
  /** rotation term (row) */
  d: number;
  /** rotation term (column) */
  b: number;
  /** pixel size Y (rows), normalmente negativo */
  e: number;
  /** coordinata X del centro del pixel top-left */
  c: number;
  /** coordinata Y del centro del pixel top-left */
  f: number;
};

/**
 * Un world file e' 6 righe: pixel size X, rotazione riga, rotazione colonna,
 * pixel size Y (negativo), coordinata X e Y del centro del pixel [0,0].
 */
export function parseWorldFile(text: string): WorldFileParams | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(Number);
  if (lines.length < 6 || lines.some((n) => !Number.isFinite(n))) return null;
  const [a, d, b, e, c, f] = lines;
  return { a, d, b, e, c, f };
}

function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (!isPng) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0..SOF15 markers (esclusi DHT/JPG/DAC) contengono le dimensioni immagine.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }
    const segmentLength = buffer.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

export function readImageDimensions(buffer: Buffer, format: string): { width: number; height: number } | null {
  const fmt = format.toLowerCase();
  if (fmt === "png") return readPngDimensions(buffer);
  if (fmt === "jpg" || fmt === "jpeg") return readJpegDimensions(buffer);
  return null;
}

function pixelToWorld(px: number, py: number, w: WorldFileParams): [number, number] {
  return [w.a * px + w.b * py + w.c, w.d * px + w.e * py + w.f];
}

/**
 * Angoli dell'immagine in ordine [topLeft, topRight, bottomRight, bottomLeft],
 * come richiesto dal source "image" di MapLibre. Le coordinate C/F del world file
 * indicano il centro del pixel [0,0]: gli angoli reali sono spostati di mezzo pixel.
 */
function imageCornersInSourceCrs(
  width: number,
  height: number,
  w: WorldFileParams,
): [[number, number], [number, number], [number, number], [number, number]] {
  return [
    pixelToWorld(-0.5, -0.5, w),
    pixelToWorld(width - 0.5, -0.5, w),
    pixelToWorld(width - 0.5, height - 0.5, w),
    pixelToWorld(-0.5, height - 0.5, w),
  ];
}

/**
 * Calcola i 4 angoli geografici (EPSG:4326) di un raster dato world file + dimensioni,
 * riproiettando dal CRS sorgente se necessario. Ritorna null se il CRS sorgente non e' risolvibile.
 */
export async function computeRasterBoundsWgs84(
  width: number,
  height: number,
  worldFile: WorldFileParams,
  sourceCrs: string | null,
): Promise<[[number, number], [number, number], [number, number], [number, number]] | { error: string }> {
  const corners = imageCornersInSourceCrs(width, height, worldFile);

  const sridMatch = sourceCrs?.match(/(\d+)\s*$/);
  const srid = sridMatch ? Number(sridMatch[1]) : null;

  if (!srid || srid === 4326) {
    return corners;
  }

  const projDef = await resolveProj4Def(srid);
  if (!projDef) {
    return { error: `CRS EPSG:${srid} non risolto per la riproiezione automatica in WGS84.` };
  }

  try {
    const sourceCode = `EPSG:${srid}`;
    if (!(proj4 as any).defs(sourceCode)) {
      (proj4 as any).defs(sourceCode, projDef);
    }
    const converter = proj4(sourceCode, "EPSG:4326");
    return corners.map(([x, y]) => converter.forward([x, y])) as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
  } catch {
    return { error: `Errore durante la riproiezione EPSG:${srid} -> EPSG:4326.` };
  }
}
