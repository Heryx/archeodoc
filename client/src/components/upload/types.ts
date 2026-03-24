export type GiornataOption = {
  id: number;
  data: string;
};

export type USOption = {
  id: number;
  codiceUS: string;
};

export type AllegatoItem = {
  id: number;
  tipo: string;
  nomeFile: string;
  operatore?: string | null;
  descrizione?: string | null;
  descrizioneAi?: string | null;
  dimensione?: number | null;
};

export type GeoPackageImportPayload = {
  sourceFileName?: string;
  tableName?: string | null;
  tablesScanned?: number;
  tablesImported?: string[];
  rowsScanned?: number;
  created: number;
  skippedWithoutCode: number;
  skippedDuplicateCode: number;
  warnings: string[];
};

export type GeoPackagePreviewTable = {
  tableName: string;
  dataType: string;
  rowCount: number;
  columns: string[];
  geometryColumn: string | null;
  srid: number | null;
  autoMap: Record<string, string | undefined>;
  sampleRows: Array<Record<string, string | null>>;
  style: {
    styleName: string | null;
    hasQml: boolean;
    hasSld: boolean;
  } | null;
};

export type GeoPackagePreviewPayload = {
  sourceFileName: string;
  tables: GeoPackagePreviewTable[];
  warnings: string[];
};
