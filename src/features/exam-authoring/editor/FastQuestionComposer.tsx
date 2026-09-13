import type { StructuredContent } from "../contracts/assessment";
import {
  RichQuestionComposer,
  type RichComposerCapabilities,
  type SmartPasteStatus,
} from "./RichQuestionComposer";

export interface FastQuestionComposerProps {
  value: StructuredContent;
  onChange: (value: StructuredContent) => void;
  label: string;
  placeholder?: string;
  compact?: boolean;
  minHeightClassName?: string;
  assetOwnerId?: string;
  capabilities?: Readonly<RichComposerCapabilities>;
  smartPaste?: boolean;
  onSmartPaste?: ((info: SmartPasteStatus) => void) | undefined;
}

export function FastQuestionComposer({
  value,
  onChange,
  label,
  placeholder = "Start typing…",
  compact = false,
  minHeightClassName = "min-h-[112px]",
  assetOwnerId,
  capabilities,
  smartPaste,
  onSmartPaste,
}: FastQuestionComposerProps) {
  return (
    <RichQuestionComposer
      value={value}
      onChange={onChange}
      label={label}
      placeholder={placeholder}
      compact={compact}
      minHeightClassName={minHeightClassName}
      {...(assetOwnerId ? { assetOwnerId } : {})}
      {...(capabilities ? { capabilities } : {})}
      {...(smartPaste !== undefined ? { smartPaste } : {})}
      {...(onSmartPaste ? { onSmartPaste } : {})}
    />
  );
}
