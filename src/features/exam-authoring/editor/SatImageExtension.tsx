import { useEffect, useState } from "react";
import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ImageIcon } from "lucide-react";
import { getAssessmentMediaAsset } from "../api/assessmentMediaApi";

function isDirectSource(value: string): boolean {
  return /^(https?:\/\/|data:|blob:|\/)/i.test(value);
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
        <img
          src={source}
          alt={alt}
          onError={() => setFailed(true)}
          className="mx-auto max-h-80 max-w-full rounded-xl border border-au-separator bg-white object-contain"
        />
      ) : (
        <div className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-au-fill px-4 text-xs text-slate-500">
          <ImageIcon size={16} />
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
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(SatImageNodeView);
  },
});
