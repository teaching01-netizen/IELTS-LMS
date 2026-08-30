import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Pilcrow, Plus } from "lucide-react";
import type { StructuredContent } from "../contracts/assessment";
import {
  plainContentFromText,
  plainTextFromContent,
  supportsFastPlainEditing,
} from "./richContent";
import { RichQuestionComposer, type RichComposerCapabilities } from "./RichQuestionComposer";
import { authoringMotion } from "../ui/authoringMotion";

export interface FastQuestionComposerProps {
  value: StructuredContent;
  onChange: (value: StructuredContent) => void;
  label: string;
  placeholder?: string;
  compact?: boolean;
  minHeightClassName?: string;
  assetOwnerId?: string;
  capabilities?: Readonly<RichComposerCapabilities>;
  richTriggerAlwaysVisible?: boolean;
  richTriggerLabel?: string;
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
  richTriggerAlwaysVisible = false,
  richTriggerLabel,
}: FastQuestionComposerProps) {
  const compatible = supportsFastPlainEditing(value);
  const [richMode, setRichMode] = useState(!compatible);

  useEffect(() => {
    if (!supportsFastPlainEditing(value)) setRichMode(true);
  }, [value]);

  if (richMode) {
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
      />
    );
  }

  const text = plainTextFromContent(value);
  return (
    <div className="group relative rounded-[14px] border border-black/[0.10] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.025)] transition focus-within:border-[#0a84ff]/55 focus-within:ring-[3px] focus-within:ring-[#0a84ff]/10">
      <textarea
        aria-label={label}
        value={text}
        onChange={(event) => onChange(plainContentFromText(event.target.value))}
        placeholder={placeholder}
        rows={compact ? 1 : 4}
        className={`${minHeightClassName} w-full resize-y rounded-[14px] bg-transparent px-4 py-3 text-[14px] leading-6 text-slate-950 outline-none placeholder:text-slate-300 ${compact ? "pr-12" : "pr-14"}`}
      />
      <motion.button
        type="button"
        whileTap={authoringMotion.press}
        transition={authoringMotion.fast}
        onClick={() => setRichMode(true)}
        className={`authoring-interactive absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-opacity hover:bg-black/[0.05] hover:text-slate-700 ${richTriggerAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"}`}
        title={richTriggerLabel ?? "Show formatting, equation, image, and table tools"}
        aria-label={richTriggerLabel ?? `Show rich formatting for ${label}`}
      >
        {richTriggerAlwaysVisible ? <Plus size={15} /> : <Pilcrow size={14} />}
      </motion.button>
    </div>
  );
}
