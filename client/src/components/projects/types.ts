export type ProjectItem = {
  id: string;
  name: string;
  projectRoot: string;
  dbPath: string;
  mediaDir: string;
  exportsDir: string;
  backupsDir: string;
  documentationMode: "iccd" | "custom";
  schemaKey: string;
  exportMode: "iccd_strict" | "iccd_extended" | "custom";
  defaultUsModelKey: string;
  createdAt: string;
  updatedAt: string;
};

export type SchemaPresetSummary = {
  key: string;
  label: string;
};
