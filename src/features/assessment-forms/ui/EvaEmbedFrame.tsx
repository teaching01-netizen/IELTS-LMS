/**
 * The one external Eva SIM frame, shared by student delivery and the Settings
 * preview so both use the same isolation: sandboxed (no top navigation,
 * popups or downloads), no referrer, and a title naming the destination.
 * Load events are never treated as readiness or submission.
 */
export function EvaEmbedFrame({ src, host, className }: { src: string; host: string; className: string }) {
  return (
    <iframe
      src={src}
      title={`Eva SIM form from ${host}`}
      sandbox="allow-forms allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      className={className}
    />
  );
}
