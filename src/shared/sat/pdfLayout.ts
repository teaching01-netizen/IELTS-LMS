export type PdfTarget =
  | { kind: "cover" | "scoreReport" | "answerSummary" | "answerKey" | "examReview" }
  | { kind: "reviewSubject"; sectionKey: string }
  | { kind: "reviewModule"; sectionKey: string; moduleKey: string };

export type PdfSide = "before" | "after";
export type PdfLogoSlot = "cover" | "leftWatermark" | "rightWatermark";
export type PdfImagePurpose = "slide" | "logo";

export interface PdfSlide {
  id: string;
  assetId: string;
  target: PdfTarget;
  side: PdfSide;
  description: string;
}

export interface PdfLogo {
  assetId: string;
  description?: string;
}

export interface PdfLayout {
  slides: PdfSlide[];
  logos: Record<PdfLogoSlot, PdfLogo | null>;
}

export interface PdfLayoutAsset {
  id: string;
  purpose: PdfImagePurpose;
  filename: string;
  contentType: string;
  bytes: number;
  width: number;
  height: number;
}

export interface PdfTargetOption {
  target: PdfTarget;
  label: string;
}

export interface PdfLayoutEditorData {
  revision: number;
  layout: PdfLayout;
  assets: PdfLayoutAsset[];
  targets: PdfTargetOption[];
}

export interface ResolvedPdfLayout {
  revision: number;
  layout: PdfLayout;
  images: Record<string, string>;
}

export const samplePageMarkerOrigin = "https://sat-pdf-preview.invalid/section/";

export function pdfTargetKey(target: PdfTarget): string {
  switch (target.kind) {
    case "reviewSubject":
      return JSON.stringify([target.kind, target.sectionKey]);
    case "reviewModule":
      return JSON.stringify([target.kind, target.sectionKey, target.moduleKey]);
    default:
      return target.kind;
  }
}
