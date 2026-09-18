/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- img onError is a resource lifecycle signal; the figure frame is a pannable surface rather than a control. */
/* eslint-disable jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-tabindex -- the frame becomes tabbable and labelled only while zoomed, so a magnified figure keeps a keyboard path (arrow keys) to the parts the window no longer shows. */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  RichTextDocument,
  RichTextNode,
  StructuredContent,
} from "./api/assessmentContracts";
import { getAssessmentMediaAsset } from "../exam-authoring/api/assessmentMediaApi";
import { satImagePresentation } from "../exam-authoring/api/satImagePresentation";
import { documentFromStructuredContent } from "../exam-authoring/api/renderingPublic";
import {
  SAT_IMAGE_ENLARGE_FIT_VIEW,
  SAT_IMAGE_ENLARGE_NO_GEOMETRY,
  type SatImageEnlargeGeometry,
  type SatImageEnlargeSlot,
  type SatImageEnlargeView,
  type SatImageGestureIntent,
  type SatImageResolveGesture,
} from "./api/structuredContentEnlarge";

const CONTENT_CLASS_NAME =
  "structured-content-renderer outline-none text-[inherit] leading-7 [&_p]:my-2 [&_h1]:my-3 [&_h1]:text-2xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-slate-300 [&_blockquote]:pl-4 [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2.5 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-50 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[0.92em] [&_pre]:leading-6 [&_pre]:text-slate-900 [&_a]:underline [&_a]:underline-offset-2";

function stringAttribute(node: RichTextNode, name: string): string {
  const value = node.attrs?.[name];
  return typeof value === "string" ? value : "";
}

function positiveDimension(node: RichTextNode, name: string): number | undefined {
  const value = node.attrs?.[name];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : undefined;
}

function directSource(value: string): string {
  if (/^blob:/i.test(value)) return value;
  if (/^data:image\/(?:png|gif|jpeg|webp)[;,]/i.test(value)) return value;
  return /^(?:https?:\/\/|\/)/i.test(value) ? value : "";
}

function initialImageSource(node: RichTextNode): string {
  const assetId = stringAttribute(node, "assetId");
  if (directSource(assetId)) return assetId;
  return assetId ? "" : directSource(stringAttribute(node, "src"));
}

function safeHref(value: string): string | null {
  return /^(?:https?:|mailto:|tel:|\/|#)/i.test(value) ? value : null;
}

function textFromNodes(nodes: readonly RichTextNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      return textFromNodes(node.content);
    })
    .join("");
}

function renderMath(latex: string, displayMode: boolean): ReactNode {
  const label = latex.trim() ? `Equation: ${latex}` : "Equation";
  try {
    const html = katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
    return (
      <span
        role="math"
        aria-label={label}
        className={displayMode ? "my-4 block overflow-x-auto text-center" : "inline-block"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return (
      <code role="math" aria-label={label}>
        {latex}
      </code>
    );
  }
}

function applyMarks(node: RichTextNode, value: ReactNode): ReactNode {
  return (node.marks ?? []).reduceRight<ReactNode>((current, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{current}</strong>;
      case "italic":
        return <em>{current}</em>;
      case "underline":
        return <u>{current}</u>;
      case "strike":
      case "s":
        return <s>{current}</s>;
      case "code":
        return <code>{current}</code>;
      case "subscript":
        return <sub>{current}</sub>;
      case "superscript":
        return <sup>{current}</sup>;
      case "link": {
        const href = typeof mark.attrs?.["href"] === "string" ? safeHref(mark.attrs["href"]) : null;
        if (!href) return current;
        const target = mark.attrs?.["target"] === "_blank" ? "_blank" : undefined;
        return (
          <a
            href={href}
            {...(target ? { target, rel: "noreferrer" } : {})}
          >
            {current}
          </a>
        );
      }
      default:
        return current;
    }
  }, value);
}

export interface StaticStructuredImageEnlargeApi {
  renderEnlarge: SatImageEnlargeSlot | undefined;
  /**
   * Optional: how a gesture on the frame becomes the next view. Absent means
   * the figure is inert, which is also what a zoom-less consumer wants.
   */
  resolveGesture?: SatImageResolveGesture | undefined;
}

function StaticStructuredImage({ node, enlarge }: { node: RichTextNode; enlarge?: StaticStructuredImageEnlargeApi | undefined }) {
  const assetId = stringAttribute(node, "assetId");
  const fallbackSource = stringAttribute(node, "src");
  const alt = stringAttribute(node, "alt");
  const caption = stringAttribute(node, "caption");
  const width = positiveDimension(node, "width");
  const height = positiveDimension(node, "height");
  // Authoring choices the student surface must honour, from the same rule the
  // authoring editor renders. Absent values mean the pre-existing presentation
  // (centred at the column's natural width), so questions authored before these
  // controls existed render unchanged — the styles come back empty.
  const align = stringAttribute(node, "align");
  const size = stringAttribute(node, "size");
  const presentation = satImagePresentation(node.attrs ?? {});
  const [source, setSource] = useState(() => initialImageSource(node));
  const [failed, setFailed] = useState(() => !assetId && !directSource(fallbackSource));
  // Bluebook figure inspection (Phase 10): transient per-image viewing state.
  // No timer, answer, or persistence touch — pure presentation over the same
  // source. The view and the measured geometry live here, beside the image they
  // describe, and are handed to the consumer's slot: this module reports what it
  // measures and applies what it is given, while the consumer decides what a
  // zoom or a pan means.
  const [viewerOpen, setViewerOpen] = useState(false);
  const [view, setView] = useState<SatImageEnlargeView>(SAT_IMAGE_ENLARGE_FIT_VIEW);
  const [geometry, setGeometry] = useState<SatImageEnlargeGeometry>(SAT_IMAGE_ENLARGE_NO_GEOMETRY);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const enlargeId = `sat-enlarge-${assetId || "inline"}-${width ?? 0}x${height ?? 0}`;

  useEffect(() => {
    let cancelled = false;
    const directAssetSource = directSource(assetId);
    const directFallbackSource = directSource(fallbackSource);
    setSource(directAssetSource || (!assetId ? directFallbackSource : ""));
    setFailed(!assetId && !directFallbackSource);

    if (!assetId || directAssetSource) return;
    void getAssessmentMediaAsset(assetId)
      .then((asset) => {
        if (cancelled) return;
        if (asset.downloadUrl) {
          setSource(asset.downloadUrl);
          setFailed(false);
        } else {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, fallbackSource]);

  // A new source is a new figure: no magnification survives it.
  useEffect(() => {
    setView(SAT_IMAGE_ENLARGE_FIT_VIEW);
  }, [source]);

  // Layout boxes, not rects: the image carries the consumer's zoom transform,
  // and a transformed rect would report the zoomed size back as its own.
  const measure = useCallback(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return;
    const next: SatImageEnlargeGeometry = {
      viewport: { width: frame.clientWidth, height: frame.clientHeight },
      image: { width: image.offsetWidth, height: image.offsetHeight },
      natural: { width: image.naturalWidth, height: image.naturalHeight },
    };
    setGeometry((current) =>
      current.viewport.width === next.viewport.width &&
      current.viewport.height === next.viewport.height &&
      current.image.width === next.image.width &&
      current.image.height === next.image.height &&
      current.natural.width === next.natural.width &&
      current.natural.height === next.natural.height
        ? current
        : next,
    );
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(image);
    return () => observer.disconnect();
  }, [measure, source, failed]);

  const aspectRatio = width && height ? `${width} / ${height}` : "16 / 9";
  const mediaStyle: CSSProperties = { aspectRatio };

  const enlargeLabel = alt || caption || "question visual";
  const zoomed = view.zoom > 1;
  const resolveGesture = enlarge?.resolveGesture;
  // Panning is the consumer's if and only if it offers a gesture rule; the frame
  // never invents one, so a zoom-less consumer keeps a plain, undraggable image.
  const pannable = Boolean(resolveGesture) && zoomed;

  // Only writes when the gesture actually changed the view: a release, or a drag
  // that hit the boundary, must not re-render — and must not restart the zoom
  // transition the student is watching.
  const applyGesture = useCallback(
    (intent: SatImageGestureIntent) => {
      if (!resolveGesture) return;
      setView((current) => {
        const next = resolveGesture({ view: current, geometry, intent });
        return next.zoom === current.zoom &&
          next.offsetX === current.offsetX &&
          next.offsetY === current.offsetY
          ? current
          : next;
      });
    },
    [resolveGesture, geometry],
  );

  return (
    <figure
      className="my-4 space-y-2"
      data-asset-id={assetId}
      data-align={align || undefined}
      data-size={size || undefined}
      style={presentation.figure}
    >
      {/* The quiet utility strip belongs ABOVE the figure and inside the same
          object it commands: no instructional text, no floating chrome, and the
          controls never move while the student zooms. */}
      {source && !failed && enlarge?.renderEnlarge
        ? enlarge.renderEnlarge({
            label: enlargeLabel,
            enlargeId,
            src: source,
            open: viewerOpen,
            view,
            geometry,
            onOpen: () => setViewerOpen(true),
            onClose: () => setViewerOpen(false),
            onViewChange: setView,
            returnFocusSelector: `#${CSS.escape(enlargeId)}`,
          })
        : null}
      <div
        ref={frameRef}
        className={
          "mx-auto flex w-full max-w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white" +
          (pannable
            ? " cursor-grab touch-none select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 active:cursor-grabbing"
            : "")
        }
        style={mediaStyle}
        // Focusable only once there is something to move: an unzoomed figure is
        // content, not a control, and must not add a tab stop to every question.
        role={pannable ? "group" : undefined}
        tabIndex={pannable ? 0 : undefined}
        aria-label={pannable ? enlargeLabel : undefined}
        // The keyboard path to the same capability the pointer has. Without it
        // a keyboard-only student could zoom but never reach the parts of a
        // magnified figure the window is no longer showing.
        onKeyDown={(event) => {
          if (!pannable) return;
          const PAN_STEP = 40;
          const deltas: Record<string, { dx: number; dy: number }> = {
            ArrowLeft: { dx: PAN_STEP, dy: 0 },
            ArrowRight: { dx: -PAN_STEP, dy: 0 },
            ArrowUp: { dx: 0, dy: PAN_STEP },
            ArrowDown: { dx: 0, dy: -PAN_STEP },
          };
          const delta = deltas[event.key];
          if (!delta) return;
          event.preventDefault();
          applyGesture({ kind: "pan", ...delta });
        }}
        // The drag flag silences the zoom transition for the length of the
        // gesture: a pan must stay 1:1 with the finger, and an eased transform
        // would put the figure behind it.
        data-sat-image-dragging={dragging ? "true" : undefined}
        onPointerDown={(event) => {
          if (!pannable) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { x: event.clientX, y: event.clientY };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (dx === 0 && dy === 0) return;
          dragRef.current = { x: event.clientX, y: event.clientY };
          applyGesture({ kind: "pan", dx, dy });
        }}
        onPointerUp={(event) => {
          if (!dragRef.current) return;
          dragRef.current = null;
          setDragging(false);
          // Release settles the view, and the now-restored transition carries it
          // back if anything needs carrying.
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
          applyGesture({ kind: "pan-end" });
        }}
        onPointerCancel={() => {
          if (!dragRef.current) return;
          dragRef.current = null;
          setDragging(false);
          applyGesture({ kind: "pan-end" });
        }}
        // Double-click is the expert's shortcut to fullscreen: the visible
        // Full screen button already teaches the capability, and double-click
        // is the faster gesture for students who know it.
        //
        // In the embedded context, double-click = open fullscreen.
        // In the fullscreen context, double-click = zoom toward cursor.
        // These are deliberately different contextual meanings.
        onDoubleClick={(event) => {
          if (!enlarge?.renderEnlarge) return;
          event.preventDefault();
          // Open fullscreen — same path as the Full screen toolbar button.
          // Do NOT zoom the embedded image as a side effect.
          if (!viewerOpen) {
            setViewerOpen(true);
          }
        }}
        // While the figure owns the gesture, the browser's menu is not part of
        // it: a right-click mid-inspection should not interrupt the graph.
        onContextMenu={(event) => {
          if (zoomed) event.preventDefault();
        }}
      >
        {source && !failed ? (
          <img
            ref={imageRef}
            src={source}
            alt={alt}
            {...(width ? { width } : {})}
            {...(height ? { height } : {})}
            decoding="async"
            loading="lazy"
            draggable={false}
            onError={() => setFailed(true)}
            onLoad={measure}
            aria-hidden={viewerOpen ? true : undefined}
            // The visual itself carries the alignment: auto margins move it
            // inside a full-width box, which is what makes "Align left" mean
            // something even when no size was chosen.
            //
            // Inspection centres instead: the zoom maths measures from the
            // frame's centre, and an off-centre image would crop against a
            // window it does not share a centre with — an empty band beside a
            // magnified figure. Author alignment governs the resting 100% state.
            style={
              zoomed
                ? {
                    transform:
                      "translate(" + view.offsetX + "px, " + view.offsetY + "px) scale(" + view.zoom + ")",
                    transformOrigin: "center",
                  }
                : presentation.content
            }
            // `sat-figure-zoom` eases the transform so a zoom step reads as
            // "of course it got bigger" rather than a snap; it is attached
            // whenever the consumer offers gestures, so resetting to 100%
            // animates home too. Reduced motion zeroes it upstream.
            className={
              "h-full max-h-80 max-w-full object-contain" +
              (resolveGesture ? " sat-figure-zoom" : "") +
              (viewerOpen ? " invisible" : "")
            }
          />
        ) : (
          <div
            className="flex min-h-32 w-full items-center justify-center px-4 text-xs text-slate-500"
            role="status"
            aria-live="polite"
          >
            {failed ? "Visual could not be loaded" : "Loading visual…"}
          </div>
        )}
      </div>
      {caption ? <figcaption className="text-center text-xs text-slate-500">{caption}</figcaption> : null}
    </figure>
  );
}

export type StructuredTextRenderer = (value: {
  nodeId: string;
  blockText: string;
  text: string;
  startOffset: number;
}) => ReactNode;

function RichNode({ node, renderText, enlarge }: { node: RichTextNode; renderText?: StructuredTextRenderer | undefined; enlarge?: StaticStructuredImageEnlargeApi | undefined }): ReactNode {
  const children = (key: string) => renderNodes(node.content, key, renderText, enlarge);
  const nodeId = stringAttribute(node, 'id');
  const annotatable = Boolean(renderText && nodeId && (node.content ?? []).every((child) => child.type === 'text' || child.type === 'hardBreak'));
  const textAttributes = annotatable ? { 'data-content-text-node': nodeId } : {};
  const textChildren = () => {
    if (!annotatable || !renderText) return children('text-block');
    const blockText = textFromNodes(node.content);
    let offset = 0;
    return (node.content ?? []).map((child, index) => {
      if (child.type === 'hardBreak') return <br key={index} />;
      const text = child.text ?? '';
      const startOffset = offset;
      offset += text.length;
      return <span key={index}>{applyMarks(child, renderText({ nodeId, blockText, text, startOffset }))}</span>;
    });
  };

  switch (node.type) {
    case "text":
      return applyMarks(node, node.text ?? "");
    case "doc":
      return children("doc");
    case "paragraph":
      return <p {...textAttributes}>{textChildren()}</p>;
    case "heading": {
      const level = Number(node.attrs?.["level"] ?? 2);
      const content = textChildren();
      if (level <= 1) return <h1 {...textAttributes}>{content}</h1>;
      if (level === 2) return <h2 {...textAttributes}>{content}</h2>;
      return <h3 {...textAttributes}>{content}</h3>;
    }
    case "blockquote":
      return <blockquote>{children("blockquote")}</blockquote>;
    case "bulletList":
      return <ul>{children("bullet-list")}</ul>;
    case "orderedList": {
      const order = Number(node.attrs?.["order"] ?? 1);
      return <ol {...(Number.isFinite(order) && order > 1 ? { start: order } : {})}>{children("ordered-list")}</ol>;
    }
    case "listItem":
      return <li>{children("list-item")}</li>;
    case "codeBlock":
      return (
        <pre>
          <code {...textAttributes}>{annotatable ? textChildren() : textFromNodes(node.content)}</code>
        </pre>
      );
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    case "inlineMath":
      return renderMath(stringAttribute(node, "latex"), false);
    case "blockMath":
      return <div>{renderMath(stringAttribute(node, "latex"), true)}</div>;
    case "image":
      return <StaticStructuredImage node={node} enlarge={enlarge} />;
    case "table":
      return <table><tbody>{children("table")}</tbody></table>;
    case "tableRow":
      return <tr>{children("table-row")}</tr>;
    case "tableHeader":
      return <th scope="col" {...cellSpanAttributes(node)}>{children("table-header")}</th>;
    case "tableCell":
      return <td {...cellSpanAttributes(node)}>{children("table-cell")}</td>;
    default:
      return <>{children("unknown")}</>;
  }
}

function cellSpanAttributes(node: RichTextNode): { colSpan?: number; rowSpan?: number } {
  const colSpan = positiveDimension(node, "colspan");
  const rowSpan = positiveDimension(node, "rowspan");
  return {
    ...(colSpan && colSpan > 1 ? { colSpan } : {}),
    ...(rowSpan && rowSpan > 1 ? { rowSpan } : {}),
  };
}

function renderNodes(nodes: readonly RichTextNode[] | undefined, keyPrefix: string, renderText?: StructuredTextRenderer, enlarge?: StaticStructuredImageEnlargeApi): ReactNode[] {
  return (nodes ?? []).map((node, index) => <RichNode key={`${keyPrefix}-${index}`} node={node} renderText={renderText} enlarge={enlarge} />);
}

export const RichStructuredContentRenderer = memo(function RichStructuredContentRenderer({
  content,
  renderText,
  enlarge,
}: {
  content: StructuredContent;
  renderText?: StructuredTextRenderer | undefined;
  enlarge?: StaticStructuredImageEnlargeApi | undefined;
}) {
  const document = documentFromStructuredContent(content) as RichTextDocument;
  return <div className={CONTENT_CLASS_NAME}>{renderNodes(document.content, "content", renderText, enlarge)}</div>;
});
