import type { StructuredContent } from "./api/assessmentContracts";
import { RichStructuredContentRenderer } from "./RichStructuredContentRenderer";

export interface StructuredContentRendererProps {
  content: StructuredContent;
  className?: string;
}

export function StructuredContentRenderer({ content, className }: StructuredContentRendererProps) {
  return (
    <div className={className}>
      <RichStructuredContentRenderer content={content} />
    </div>
  );
}
