/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- img onError is a resource lifecycle signal. */
import { memo, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type {
  RichTextDocument,
  RichTextNode,
  StructuredContent,
} from "./api/assessmentContracts";
import { getAssessmentMediaAsset } from "../exam-authoring/api/assessmentMediaApi";
import { documentFromStructuredContent } from "../exam-authoring/api/structuredContentPublic";

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

function StaticStructuredImage({ node }: { node: RichTextNode }) {
  const assetId = stringAttribute(node, "assetId");
  const fallbackSource = stringAttribute(node, "src");
  const alt = stringAttribute(node, "alt");
  const caption = stringAttribute(node, "caption");
  const width = positiveDimension(node, "width");
  const height = positiveDimension(node, "height");
  const [source, setSource] = useState(() => initialImageSource(node));
  const [failed, setFailed] = useState(() => !assetId && !directSource(fallbackSource));

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

  const aspectRatio = width && height ? `${width} / ${height}` : "16 / 9";
  const mediaStyle: CSSProperties = { aspectRatio };

  return (
    <figure className="my-4 space-y-2" data-asset-id={assetId}>
      <div
        className="mx-auto flex w-full max-w-full items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white"
        style={mediaStyle}
      >
        {source && !failed ? (
          <img
            src={source}
            alt={alt}
            {...(width ? { width } : {})}
            {...(height ? { height } : {})}
            decoding="async"
            loading="lazy"
            onError={() => setFailed(true)}
            className="h-full max-h-80 max-w-full object-contain"
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

function RichNode({ node, renderText }: { node: RichTextNode; renderText?: StructuredTextRenderer | undefined }): ReactNode {
  const children = (key: string) => renderNodes(node.content, key, renderText);
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
      return <StaticStructuredImage node={node} />;
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

function renderNodes(nodes: readonly RichTextNode[] | undefined, keyPrefix: string, renderText?: StructuredTextRenderer): ReactNode[] {
  return (nodes ?? []).map((node, index) => <RichNode key={`${keyPrefix}-${index}`} node={node} renderText={renderText} />);
}

export const RichStructuredContentRenderer = memo(function RichStructuredContentRenderer({
  content,
  renderText,
}: {
  content: StructuredContent;
  renderText?: StructuredTextRenderer | undefined;
}) {
  const document = documentFromStructuredContent(content) as RichTextDocument;
  return <div className={CONTENT_CLASS_NAME}>{renderNodes(document.content, "content", renderText)}</div>;
});
