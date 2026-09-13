import { useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ImageIcon } from "lucide-react";
import { getAssessmentMediaAsset } from "../api/assessmentMediaApi";

// Renderable without the media service: http(s) and app-relative paths
// only. data:/blob: URLs are never rendered directly — pasted images must go
// through the upload pipeline (allowBase64:false) so unverified bytes cannot
// become publishable content and so no object-URL lifetime leaks into drafts.
function isDirectSource(value: string): boolean {
  return /^(https?:\/\/|\/)/i.test(value);
}

function SatImageNodeView({ node }: NodeViewProps) {
  const assetId = String(node.attrs["assetId"] ?? "");
  const fallbackSource = String(node.attrs["src"] ?? "");
  const alt = String(node.attrs["alt"] ?? "");
  const caption = node.attrs["caption"] ? String(node.attrs["caption"]) : null;
  const [source, setSource] = useState(() =>
    isDirectSource(assetId) ? assetId : isDirectSource(fallbackSource) ? fallbackSource : ""
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!assetId || isDirectSource(assetId)) return;
    void getAssessmentMediaAsset(assetId)
      .then((asset) => {
        if (!cancelled && asset.downloadUrl) setSource(asset.downloadUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return (
    <NodeViewWrapper as="figure" className="my-4 space-y-2" data-asset-id={assetId}>
      {source && !failed ? (
        // The error handler only switches to the recoverable missing-visual state;
        // it is not a user interaction listener.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <img
          src={source}
          alt={alt}
          onError={() => setFailed(true)}
          className="mx-auto max-h-80 max-w-full rounded-xl border border-au-separator bg-au-surface object-contain"
        />
      ) : (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-au-fill px-4 text-xs text-slate-500">
          <ImageIcon size={16} aria-hidden="true" />
          {failed ? "Visual could not be loaded" : "Loading visual…"}
        </div>
      )}
      {caption ? (
        <figcaption className="text-center text-xs text-slate-500">{caption}</figcaption>
      ) : null}
    </NodeViewWrapper>
  );
}

export const SatImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      assetId: { default: null },
      caption: { default: null },
      // Phase 06 carve-out (attrs only, no render change): transient upload
      // state for clipboard image paste. The pipe inserts a temp node with
      // uploadId/uploading set, then swaps attrs with addToHistory:false so
      // the paste stays one undo step. Undeclared attrs are dropped by the
      // schema, so these must be declared or the state vanishes silently.
      // The node view below is UNCHANGED: blob: previews are never rendered
      // (existing loading placeholder covers uploading); data: stays
      // unrendarable; allowBase64:false untouched.
      uploadId: { default: null },
      uploading: { default: false },
      uploadError: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(SatImageNodeView);
  },
});
