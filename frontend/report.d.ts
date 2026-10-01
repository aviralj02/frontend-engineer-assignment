export type ReportRegion = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";

export interface ReportContext {
  region: ReportRegion;
  screenId: string | null;
  elementKey?: string;
}

export function report(error: unknown, context: ReportContext): void;
