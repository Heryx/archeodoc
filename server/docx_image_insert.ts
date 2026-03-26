import JSZip from "jszip";

type InsertDocxImageInput = {
  docxBuffer: Buffer;
  imageBuffer: Buffer;
  imageMimeType?: "image/png" | "image/jpeg";
  title?: string | null;
  caption?: string | null;
  widthEmu?: number;
  heightEmu?: number;
  afterParagraphIndex?: number | null;
};

type InsertDocxImageResult = {
  buffer: Buffer;
  warnings: string[];
};

const DEFAULT_WIDTH_EMU = 14 * 360_000;
const DEFAULT_HEIGHT_EMU = 8 * 360_000;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function ensureContentTypeForImage(contentTypesXml: string, extension: "png" | "jpg"): string {
  const extensionRegex = new RegExp(`Extension="${extension}"`, "i");
  if (extensionRegex.test(contentTypesXml)) return contentTypesXml;

  const contentType = extension === "jpg" ? "image/jpeg" : "image/png";
  const addition = `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  return contentTypesXml.replace("</Types>", `${addition}</Types>`);
}

function ensureDocumentRelsXml(existing: string | null): string {
  if (existing && existing.trim()) return existing;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
}

function nextRelationshipId(relsXml: string): string {
  const regex = /Id="rId(\d+)"/g;
  let max = 0;
  let match: RegExpExecArray | null = regex.exec(relsXml);
  while (match) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed)) max = Math.max(max, parsed);
    match = regex.exec(relsXml);
  }
  return `rId${max + 1}`;
}

function appendImageRelationship(relsXml: string, relationshipId: string, imageFileName: string): string {
  const relation = `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${imageFileName}"/>`;
  return relsXml.replace("</Relationships>", `${relation}</Relationships>`);
}

function paragraphWithText(text: string, italic = false): string {
  const runStyle = italic ? "<w:rPr><w:i/></w:rPr>" : "";
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r>${runStyle}<w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

function drawingParagraph(input: {
  relationshipId: string;
  widthEmu: number;
  heightEmu: number;
  description: string;
}): string {
  const { relationshipId, widthEmu, heightEmu, description } = input;
  const escaped = escapeXml(description);
  const docPrId = Math.floor(Math.random() * 100_000) + 1;

  return `<w:p>
    <w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>
    <w:r>
      <w:drawing>
        <wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
          <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
          <wp:effectExtent l="0" t="0" r="0" b="0"/>
          <wp:docPr id="${docPrId}" name="Map snapshot" descr="${escaped}"/>
          <wp:cNvGraphicFramePr>
            <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
          </wp:cNvGraphicFramePr>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
            <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                <pic:nvPicPr>
                  <pic:cNvPr id="0" name="snapshot"/>
                  <pic:cNvPicPr/>
                </pic:nvPicPr>
                <pic:blipFill>
                  <a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/>
                  <a:stretch><a:fillRect/></a:stretch>
                </pic:blipFill>
                <pic:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>
                  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
                </pic:spPr>
              </pic:pic>
            </a:graphicData>
          </a:graphic>
        </wp:inline>
      </w:drawing>
    </w:r>
  </w:p>`;
}

function insertAfterParagraphIndex(documentXml: string, blockXml: string, index: number): string {
  if (index < 0) return documentXml.replace("</w:body>", `${blockXml}</w:body>`);

  let count = -1;
  let searchIndex = 0;
  while (searchIndex < documentXml.length) {
    const closeIdx = documentXml.indexOf("</w:p>", searchIndex);
    if (closeIdx === -1) break;
    count += 1;
    if (count === index) {
      const insertAt = closeIdx + "</w:p>".length;
      return `${documentXml.slice(0, insertAt)}${blockXml}${documentXml.slice(insertAt)}`;
    }
    searchIndex = closeIdx + "</w:p>".length;
  }
  return documentXml.replace("</w:body>", `${blockXml}</w:body>`);
}

function buildInsertBlock(input: {
  relationshipId: string;
  widthEmu: number;
  heightEmu: number;
  title: string | null;
  caption: string | null;
}): string {
  const parts: string[] = [];
  if (input.title) parts.push(paragraphWithText(input.title));
  parts.push(
    drawingParagraph({
      relationshipId: input.relationshipId,
      widthEmu: input.widthEmu,
      heightEmu: input.heightEmu,
      description: input.title || "Snapshot mappa",
    }),
  );
  if (input.caption) parts.push(paragraphWithText(input.caption, true));
  return parts.join("");
}

export async function insertImageIntoDocx(input: InsertDocxImageInput): Promise<InsertDocxImageResult> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(input.docxBuffer);

  const imageExt: "png" | "jpg" = input.imageMimeType === "image/jpeg" ? "jpg" : "png";
  const imageFileName = `map_snapshot_${Date.now()}.${imageExt}`;
  zip.file(`word/media/${imageFileName}`, input.imageBuffer);

  const contentTypeFile = zip.file("[Content_Types].xml");
  if (!contentTypeFile) throw new Error("DOCX non valido: manca [Content_Types].xml");
  const contentTypesXml = await contentTypeFile.async("string");
  zip.file("[Content_Types].xml", ensureContentTypeForImage(contentTypesXml, imageExt));

  const relsPath = "word/_rels/document.xml.rels";
  const relsRaw = await zip.file(relsPath)?.async("string");
  const relsXml = ensureDocumentRelsXml(relsRaw ?? null);
  const relationshipId = nextRelationshipId(relsXml);
  zip.file(relsPath, appendImageRelationship(relsXml, relationshipId, imageFileName));

  const documentPath = "word/document.xml";
  const documentFile = zip.file(documentPath);
  if (!documentFile) throw new Error("DOCX non valido: manca word/document.xml");
  const documentXml = await documentFile.async("string");
  if (!documentXml.includes("</w:body>")) {
    warnings.push("Tag </w:body> non trovato: inserimento in append forzato");
  }

  const widthEmu = Number.isFinite(input.widthEmu) && (input.widthEmu ?? 0) > 0
    ? Number(input.widthEmu)
    : DEFAULT_WIDTH_EMU;
  const heightEmu = Number.isFinite(input.heightEmu) && (input.heightEmu ?? 0) > 0
    ? Number(input.heightEmu)
    : DEFAULT_HEIGHT_EMU;
  const block = buildInsertBlock({
    relationshipId,
    widthEmu,
    heightEmu,
    title: input.title?.trim() || null,
    caption: input.caption?.trim() || null,
  });
  const index = Number.isFinite(input.afterParagraphIndex) ? Number(input.afterParagraphIndex) : -1;
  const updatedXml = documentXml.includes("</w:body>")
    ? insertAfterParagraphIndex(documentXml, block, index)
    : `${documentXml}${block}`;
  zip.file(documentPath, updatedXml);

  const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { buffer, warnings };
}
