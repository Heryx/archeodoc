import { google } from "googleapis";
import { getAuthorizedClient } from "./google_auth";

type HeadingStyle = "HEADING_1" | "HEADING_2" | "HEADING_3";

type TemplateLine = {
  text: string;
  heading?: HeadingStyle;
  boldLabel?: boolean;
};

function sanitizeName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80);
}

function currentItalianDatePlaceholder(): string {
  return "GG/MM/AAAA";
}

function buildJournalTemplateLines(cantiereName: string): TemplateLine[] {
  const year = new Date().getFullYear();

  return [
    { text: `GIORNALE DI SCAVO - ${cantiereName}`, heading: "HEADING_1" },
    { text: "Responsabile: ", boldLabel: true },
    { text: `Comune:  | Localita:  | Anno: ${year}`, boldLabel: true },
    { text: "" },
    { text: "_______________________________________________" },
    { text: "" },
    { text: `GIORNATA - ${currentItalianDatePlaceholder()}`, heading: "HEADING_2" },
    { text: "Meteo:  | Operai:  | Responsabile: ", boldLabel: true },
    { text: "" },
    { text: "US 001", heading: "HEADING_3" },
    { text: "Tipo: ", boldLabel: true },
    { text: "Definizione: ", boldLabel: true },
    { text: "Colore: ", boldLabel: true },
    { text: "Consistenza: ", boldLabel: true },
    { text: "Inclusi: ", boldLabel: true },
    { text: "Misure: ", boldLabel: true },
    { text: "Copre: ", boldLabel: true },
    { text: "Tagliata da: ", boldLabel: true },
    { text: "Interpretazione: ", boldLabel: true },
    { text: "Note: ", boldLabel: true },
    { text: "" },
    { text: "US 002", heading: "HEADING_3" },
    { text: "Tipo: ", boldLabel: true },
    { text: "Definizione: ", boldLabel: true },
    { text: "Colore: ", boldLabel: true },
    { text: "Consistenza: ", boldLabel: true },
    { text: "Inclusi: ", boldLabel: true },
    { text: "Misure: ", boldLabel: true },
    { text: "Copre: ", boldLabel: true },
    { text: "Tagliata da: ", boldLabel: true },
    { text: "Interpretazione: ", boldLabel: true },
    { text: "Note: ", boldLabel: true },
  ];
}

function buildTemplateText(lines: TemplateLine[]): string {
  return `${lines.map((line) => line.text).join("\n")}\n`;
}

function buildTemplateRequests(lines: TemplateLine[]) {
  const requests: any[] = [];
  let cursor = 1;

  for (const line of lines) {
    const start = cursor;
    const end = start + line.text.length;
    const paragraphEnd = end + 1;

    if (line.heading) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: start, endIndex: paragraphEnd },
          paragraphStyle: { namedStyleType: line.heading },
          fields: "namedStyleType",
        },
      });
    }

    if (line.boldLabel) {
      const colonIdx = line.text.indexOf(":");
      if (colonIdx >= 0) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: start + colonIdx + 1 },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }
    }

    cursor = paragraphEnd;
  }

  return requests;
}

export function buildGoogleFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function buildGoogleDocUrl(docId: string): string {
  return `https://docs.google.com/document/d/${docId}/edit`;
}

export async function createProjectFolder(cantiereName: string): Promise<string> {
  const auth = getAuthorizedClient();
  const drive = google.drive({ version: "v3", auth });

  const folderName = `Cantiere_${sanitizeName(cantiereName) || "ArcheoDoc"}`;
  const created = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  const folderId = created.data.id;
  if (!folderId) {
    throw new Error("Google Drive non ha restituito un folderId valido");
  }

  return folderId;
}

export async function createJournalDocument(cantiereName: string, folderId: string): Promise<string> {
  const auth = getAuthorizedClient();
  const docs = google.docs({ version: "v1", auth });
  const drive = google.drive({ version: "v3", auth });

  const docTitle = `Giornale_${sanitizeName(cantiereName) || "ArcheoDoc"}`;
  const doc = await docs.documents.create({
    requestBody: {
      title: docTitle,
    },
  });

  const docId = doc.data.documentId;
  if (!docId) {
    throw new Error("Google Docs non ha restituito un documentId valido");
  }

  const parentInfo = await drive.files.get({ fileId: docId, fields: "parents" });
  const previousParents = (parentInfo.data.parents || []).join(",");

  await drive.files.update({
    fileId: docId,
    addParents: folderId,
    removeParents: previousParents || undefined,
    fields: "id,parents",
  });

  const lines = buildJournalTemplateLines(cantiereName);
  const text = buildTemplateText(lines);
  const requests = [
    {
      insertText: {
        location: { index: 1 },
        text,
      },
    },
    ...buildTemplateRequests(lines),
  ];

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  return docId;
}
