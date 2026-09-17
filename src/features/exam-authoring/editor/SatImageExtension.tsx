import { useEffect, useState } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ImageIcon } from "lucide-react";
import { getAssessmentMediaAsset } from "../api/assessmentMediaApi";
import {
  removeTransientImage,
  retryTransientUploadForNode,
} from "./ingestionImagePipe";
import { SatImageNode, isDirectImageSource as isDirectSource } from "./schema/imageNode";
import { imageContentStyle, imageFigureStyle } from "./imageObjectActions";

function SatImageNodeView({ node, editor, selected }: NodeViewProps) {
  const assetId = String(node.attrs["assetId"] ?? "");
  const fallbackSource = String(node.attrs["src"] ?? "");
  const alt = String(node.attrs["alt"] ?? "");
  const caption = node.attrs["caption"] ? String(node.attrs["caption"]) : null;
  const uploadId = String(node.attrs["uploadId"] ?? "");
  const uploadError = String(node.attrs["uploadError"] ?? "");
  const uploadFailed = Boolean(uploadId && uploadError && node.attrs["uploading"] !== true);
  const [source, setSource] = useState(() =>
    isDirectSource(assetId) ? assetId : isDirectSource(fallbackSource) ? fallbackSource : ""
  );
  const [failed, setFailed] = useState(false);

  const figureStyle = imageFigureStyle(node.attrs as Record<string, unknown>);
  const contentStyle = imageContentStyle(node.attrs as Record<string, unknown>);

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
    <NodeViewWrapper
      as="figure"
      className="my-4 space-y-2"
      data-asset-id={assetId}
      // Selection is stated by the object itself (a restrained accent stroke)
      // rather than by a ring around the whole editor: the smallest meaningful
      // object gets the focus, and it fades in with the object controls.
      data-image-selected={selected ? "true" : undefined}
      style={figureStyle}
    >
      {uploadFailed ? (
        <div className="space-y-3 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <span
            role="status"
            aria-live="polite"
            aria-label="Upload failed"
            className="block font-medium"
          >
            Upload failed
          </span>
          <p className="text-xs text-amber-800">{uploadError}</p>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Retry image upload"
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
              onClick={() => void retryTransientUploadForNode(editor, uploadId)}
            >
              Retry
            </button>
            <button
              type="button"
              aria-label="Remove image"
              className="rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium hover:bg-amber-100"
              onClick={() => removeTransientImage(editor, uploadId)}
            >
              Remove
            </button>
          </div>
        </div>
      ) : source && !failed ? (
        // The error handler only switches to the recoverable missing-visual state;
        // it is not a user interaction listener.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
        <img
          src={source}
          alt={alt}
          onError={() => setFailed(true)}
          style={contentStyle}
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
// rendered (the loading placeholder covers uploading); failed staged uploads
// expose retry/remove controls; data: stays unrenderable; allowBase64:false
// untouched.
export const SatImage = SatImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(SatImageNodeView);
  },
});
