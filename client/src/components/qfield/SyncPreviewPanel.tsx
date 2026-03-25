import { useMemo, useState } from "react";
import { Camera, CheckCircle2, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildProjectUrl } from "@/lib/project";
import type { QFieldApproval, QFieldSyncPreview } from "./types";

type SyncPreviewPanelProps = {
  cantiereId: number;
  preview: QFieldSyncPreview;
  onApply: (payload: { approvals: QFieldApproval[]; includeNonConflicts: boolean; attachPhotos: boolean }) => void;
  applyPending: boolean;
};

function statusBadge(status: string) {
  if (status === "new") return "bg-green-500/15 text-green-300";
  if (status === "conflict") return "bg-red-500/15 text-red-300";
  if (status === "complementary") return "bg-amber-500/15 text-amber-300";
  if (status === "redundant") return "bg-blue-500/15 text-blue-300";
  return "bg-muted text-muted-foreground";
}

export function SyncPreviewPanel({ cantiereId, preview, onApply, applyPending }: SyncPreviewPanelProps) {
  const [approvedKeys, setApprovedKeys] = useState<Record<string, boolean>>({});
  const [attachPhotos, setAttachPhotos] = useState(true);
  const [includeNonConflicts, setIncludeNonConflicts] = useState(true);

  const summary = useMemo(() => {
    const totalPhotos = preview.entries.reduce((sum, entry) => sum + entry.photos.length, 0);
    const needsReview = preview.entries.filter((entry) => entry.requiresReview).length;
    return { totalPhotos, needsReview };
  }, [preview.entries]);

  const approvals = useMemo(() => {
    const output: QFieldApproval[] = [];
    for (const entry of preview.entries) {
      for (const delta of entry.deltas) {
        const key = `${entry.usId ?? entry.codiceUS}:${delta.field}`;
        if (!approvedKeys[key]) continue;
        output.push({
          usId: entry.usId,
          codiceUS: entry.codiceUS,
          field: delta.field,
          value: delta.aiSuggestion ?? delta.valueIncoming,
        });
      }
    }
    return output;
  }, [approvedKeys, preview.entries]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 size={16} className="text-primary" />
          Preview sincronizzazione QField
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm">
          ZIP: <span className="font-medium">{preview.sourceZipName}</span> · GPKG:{" "}
          <span className="font-medium">{preview.gpkgFileName}</span>
        </div>
        <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
          <span>US rilevate: {preview.totalIncoming}</span>
          <span>Match DB: {preview.matchedUS}</span>
          <span>US mancanti: {preview.missingUS}</span>
          <span>Conflitti: {summary.needsReview}</span>
          <span>Foto: {summary.totalPhotos}</span>
        </div>

        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox checked={includeNonConflicts} onCheckedChange={(v) => setIncludeNonConflicts(Boolean(v))} />
            Applica merge automatici (new/complementary/redundant)
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={attachPhotos} onCheckedChange={(v) => setAttachPhotos(Boolean(v))} />
            Allega foto da DCIM/media
          </label>
        </div>

        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {preview.entries.map((entry) => (
            <div key={`${entry.codiceUS}-${entry.usId ?? "new"}`} className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{entry.codiceUS}</span>
                {entry.requiresReview && (
                  <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-300">
                    <CircleAlert size={11} />
                    revisione
                  </span>
                )}
                {entry.usId == null && (
                  <span className="text-[11px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-300">
                    nuova US
                  </span>
                )}
              </div>

              {entry.deltas
                .filter((delta) => delta.status !== "unchanged")
                .map((delta) => {
                  const canApprove = !!delta.aiSuggestion || delta.status === "conflict";
                  const key = `${entry.usId ?? entry.codiceUS}:${delta.field}`;
                  return (
                    <div key={`${entry.codiceUS}-${delta.field}`} className="text-xs rounded border border-border/60 p-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{delta.field}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${statusBadge(delta.status)}`}>
                          {delta.status}
                        </span>
                        {canApprove && (
                          <label className="ml-auto flex items-center gap-1">
                            <Checkbox
                              checked={!!approvedKeys[key]}
                              onCheckedChange={(checked) =>
                                setApprovedKeys((prev) => ({ ...prev, [key]: Boolean(checked) }))
                              }
                            />
                            usa suggerimento
                          </label>
                        )}
                      </div>
                      <div className="text-muted-foreground">DB: {String(delta.valueArcheodoc ?? "-")}</div>
                      <div className="text-muted-foreground">Incoming: {String(delta.valueIncoming ?? "-")}</div>
                      {delta.aiSuggestion && (
                        <div className="text-foreground">Suggerito: {delta.aiSuggestion}</div>
                      )}
                    </div>
                  );
                })}

              {entry.photos.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium flex items-center gap-1">
                    <Camera size={12} /> Foto ({entry.photos.length})
                  </div>
                  <div className="flex gap-2 overflow-x-auto">
                    {entry.photos.slice(0, 8).map((photo) => (
                      <img
                        key={photo.relativePath}
                        src={buildProjectUrl(`/api/cantieri/${cantiereId}/qfield/media/${preview.uploadId}/${encodeURI(photo.relativePath)}`)}
                        alt={photo.fileName}
                        className="w-16 h-16 object-cover rounded border border-border"
                        loading="lazy"
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <Button
            onClick={() => onApply({ approvals, includeNonConflicts, attachPhotos })}
            disabled={applyPending}
          >
            {applyPending ? "Applico..." : "Applica sincronizzazione"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
