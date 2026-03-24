import type { GoogleSyncDecisionState, GoogleSyncPreview, GoogleSyncPreviewItem } from "@/components/giornata/types";

export type LastSyncSummary = {
  created?: number;
  updated?: number;
  unchanged?: number;
  skipped?: number;
};

export function seedGoogleDecisionState(preview: GoogleSyncPreview): Record<string, GoogleSyncDecisionState> {
  const seeded: Record<string, GoogleSyncDecisionState> = {};

  for (const item of preview.items) {
    seeded[item.key] = {
      action: "confirm",
      overrides: {},
    };
  }

  return seeded;
}

export function withGoogleDecisionAction(
  previous: Record<string, GoogleSyncDecisionState>,
  itemKey: string,
  action: "confirm" | "skip" | "edit",
): Record<string, GoogleSyncDecisionState> {
  return {
    ...previous,
    [itemKey]: {
      ...(previous[itemKey] || { action: "confirm", overrides: {} }),
      action,
    },
  };
}

export function withGoogleTopFieldOverride(
  previous: Record<string, GoogleSyncDecisionState>,
  itemKey: string,
  field: Exclude<keyof GoogleSyncPreviewItem["proposed"], "schedaData">,
  value: string,
): Record<string, GoogleSyncDecisionState> {
  const current = previous[itemKey] || { action: "confirm" as const, overrides: {} };
  return {
    ...previous,
    [itemKey]: {
      action: "edit",
      overrides: {
        ...current.overrides,
        [field]: value.trim() ? value : null,
      },
    },
  };
}

export function withGoogleSchedaOverride(
  previous: Record<string, GoogleSyncDecisionState>,
  itemKey: string,
  fieldKey: string,
  value: string,
): Record<string, GoogleSyncDecisionState> {
  const current = previous[itemKey] || { action: "confirm" as const, overrides: {} };
  return {
    ...previous,
    [itemKey]: {
      action: "edit",
      overrides: {
        ...current.overrides,
        schedaData: {
          ...(current.overrides.schedaData || {}),
          [fieldKey]: value.trim() ? value : null,
        },
      },
    },
  };
}

export function parseLastSyncSummary(lastSyncReport: string | null | undefined): LastSyncSummary | null {
  if (!lastSyncReport) return null;

  try {
    const parsed = JSON.parse(lastSyncReport);
    if (!parsed?.report || typeof parsed.report !== "object") {
      return null;
    }

    return {
      created: parsed.report.created,
      updated: parsed.report.updated,
      unchanged: parsed.report.unchanged,
      skipped: parsed.report.skipped,
    };
  } catch {
    return null;
  }
}
