export type QFieldFieldDeltaStatus = "unchanged" | "new" | "conflict" | "redundant" | "complementary";

export type QFieldFieldDelta = {
  field: string;
  valueArcheodoc: string | number | null;
  valueIncoming: string | number | null;
  status: QFieldFieldDeltaStatus;
  aiSuggestion?: string;
};

export type QFieldPhotoDelta = {
  fileName: string;
  relativePath: string;
  status: "new";
  source: "dcim" | "media" | "other";
};

export type QFieldSyncPreviewEntry = {
  cantiereId: number;
  usId: number | null;
  codiceUS: string;
  deltas: QFieldFieldDelta[];
  photos: QFieldPhotoDelta[];
  requiresReview: boolean;
};

export type QFieldSyncPreview = {
  uploadId: string;
  cantiereId: number;
  sourceZipName: string;
  qgzProjectName: string | null;
  gpkgFileName: string;
  totalIncoming: number;
  matchedUS: number;
  missingUS: number;
  entries: QFieldSyncPreviewEntry[];
  generatedAt: string;
};

export type QFieldApproval = {
  usId: number | null;
  codiceUS: string;
  field: string;
  value: string | number | null;
};

export type QFieldApplyResult = {
  ok: boolean;
  updated: number;
  created: number;
  photosAttached: number;
  skippedConflicts: number;
  skippedMissingUs: number;
};
