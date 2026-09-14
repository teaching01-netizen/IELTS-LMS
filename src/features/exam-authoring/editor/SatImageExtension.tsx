import { useEffect, useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ImageIcon } from "lucide-react";
import { getAssessmentMediaAsset } from "../api/assessmentMediaApi";
import { SatImageNode, isDirectImageSource as isDirectSource } from "./schema/imageNode";

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

// The browser extends the SHARED node definition (see ./schema/imageNode.ts)
// with a node view only: attributes and schema rules stay identical to what
// the Hocuspocus co-editing service converts.
//
// The node view is UNCHANGED from before the split: blob: previews are never
// rendered (the loading placeholder covers uploading); data: stays
// unrenderable; allowBase64:false untouched.
export const SatImage = SatImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SatImageNodeView);
  },
});
