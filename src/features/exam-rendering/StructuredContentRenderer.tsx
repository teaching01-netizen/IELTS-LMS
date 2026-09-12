import type { StructuredContent } from "./api/assessmentContracts";
import { RichStructuredContentRenderer, type StaticStructuredImageEnlargeApi, type StructuredTextRenderer } from "./RichStructuredContentRenderer";

export type { StaticStructuredImageEnlargeApi, StructuredTextRenderer };

export interface StructuredContentRendererProps {
  content: StructuredContent;
  className?: string;
  renderText?: StructuredTextRenderer | undefined;
  enlarge?: StaticStructuredImageEnlargeApi | undefined;
}

export function StructuredContentRenderer({ content, className, renderText, enlarge }: StructuredContentRendererProps) {
  return (
    <div className={className}>
      <RichStructuredContentRenderer content={content} renderText={renderText} enlarge={enlarge} />
    </div>
  );
}
