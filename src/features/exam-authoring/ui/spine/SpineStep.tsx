import type { ReactNode } from "react";

/**
 * Numbered spine step (taste slice 2): the authoring column is a true
 * sequence — prompt, material, classification, key, rationale, validation —
 * so the step number carries information the reader needs. Renders the
 * `data-authoring-field` anchor itself so `onIssueSelect` scroll-focus keeps
 * working; the scroll margin clears the sticky header.
 */
export function SpineStep({
  step,
  title,
  field,
  children,
}: {
  step: string;
  title: string;
  field?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section data-authoring-field={field} className="scroll-mt-20">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {step} — {title}
      </p>
      {children}
    </section>
  );
}
