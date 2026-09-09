/**
 * Single field-label voice for the spine (taste slice 1): one 13px semibold
 * foreground label plus a tiny requirement pill. Displaces the two
 * disagreeing header styles (prompt `text-sm` vs supporting `text-xs muted`)
 * so every block in the column speaks at the same level.
 */
export function SpineFieldLabel({
  label,
  required,
  hint,
}: {
  label: string;
  required: boolean;
  hint?: string | undefined;
}) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-semibold text-foreground">{label}</span>
      <span
        className={
          required
            ? "shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary"
            : "shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        }
      >
        {required ? "Required" : hint ?? "Optional"}
      </span>
    </div>
  );
}
