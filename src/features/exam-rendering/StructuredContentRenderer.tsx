import type { StructuredContent } from "./api/assessmentContracts";
import { RichStructuredContentRenderer, type StaticStructuredImageEnlargeApi, type StructuredContentMediaProps, type StructuredTextRenderer } from "./RichStructuredContentRenderer";

export type { StaticStructuredImageEnlargeApi, StructuredTextRenderer };
export type { StructuredContentMediaProps } from "./RichStructuredContentRenderer";

export interface StructuredContentRendererProps extends StructuredContentMediaProps {
  content: StructuredContent;
  className?: string;
  renderText?: StructuredTextRenderer | undefined;
  enlarge?: StaticStructuredImageEnlargeApi | undefined;
}

export function StructuredContentRenderer({ content, className, renderText, enlarge, loadMediaUrl, onMediaFailure, questionId }: StructuredContentRendererProps) {
  return (
    <div className={className}>
      <RichStructuredContentRenderer content={content} renderText={renderText} enlarge={enlarge} loadMediaUrl={loadMediaUrl} onMediaFailure={onMediaFailure} questionId={questionId} />
    </div>
  );
}
