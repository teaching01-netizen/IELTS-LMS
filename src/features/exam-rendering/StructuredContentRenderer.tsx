import type { StructuredContent } from "./api/assessmentContracts";
import { RichStructuredContentRenderer, type StructuredTextRenderer } from "./RichStructuredContentRenderer";

export interface StructuredContentRendererProps {
  content: StructuredContent;
  className?: string;
  renderText?: StructuredTextRenderer | undefined;
}

export function StructuredContentRenderer({ content, className, renderText }: StructuredContentRendererProps) {
  return (
    <div className={className}>
      <RichStructuredContentRenderer content={content} renderText={renderText} />
    </div>
  );
}
