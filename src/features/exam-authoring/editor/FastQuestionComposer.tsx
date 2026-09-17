import type { StructuredContent } from "../contracts/assessment";
import {
  RichQuestionComposer,
  type RichComposerCapabilities,
  type RichComposerCollaboration,
  type SmartPasteStatus,
} from "./RichQuestionComposer";

export interface FastQuestionComposerProps {
  value: StructuredContent;
  onChange: (value: StructuredContent) => void;
  onLocalChange?: ((value: StructuredContent) => void) | undefined;
  label: string;
  placeholder?: string;
  compact?: boolean;
  minHeightClassName?: string;
  assetOwnerId?: string;
  capabilities?: Readonly<RichComposerCapabilities>;
  smartPaste?: boolean;
  onSmartPaste?: ((info: SmartPasteStatus) => void) | undefined;
  /** Prompt co-editing binding; absent means the legacy editor. */
  collaboration?: RichComposerCollaboration | undefined;
}

export function FastQuestionComposer({
  value,
  onChange,
  onLocalChange,
  label,
  placeholder = "Write or paste…",
  compact = false,
  minHeightClassName = "min-h-[112px]",
  assetOwnerId,
  capabilities,
  smartPaste,
  onSmartPaste,
  collaboration,
}: FastQuestionComposerProps) {
  return (
    <RichQuestionComposer
      value={value}
      onChange={onChange}
      {...(onLocalChange ? { onLocalChange } : {})}
      label={label}
      placeholder={placeholder}
      compact={compact}
      minHeightClassName={minHeightClassName}
      {...(assetOwnerId ? { assetOwnerId } : {})}
      {...(capabilities ? { capabilities } : {})}
      {...(smartPaste !== undefined ? { smartPaste } : {})}
      {...(onSmartPaste ? { onSmartPaste } : {})}
      {...(collaboration ? { collaboration } : {})}
    />
  );
}
