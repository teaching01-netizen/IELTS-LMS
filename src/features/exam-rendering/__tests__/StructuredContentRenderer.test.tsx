import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StructuredContent } from "../api/assessmentContracts";
import { StructuredContentRenderer } from "../StructuredContentRenderer";

vi.mock("../../exam-authoring/api/assessmentMediaApi", () => ({
  getAssessmentMediaAsset: vi.fn(),
}));
import { getAssessmentMediaAsset } from "../../exam-authoring/api/assessmentMediaApi";

const content: StructuredContent = {
  version: 2,
  nodes: [],
  document: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Read this" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Important", marks: [{ type: "bold" }] },
          { type: "text", text: " text" },
          { type: "inlineMath", attrs: { latex: "x^2" } },
        ],
      },
      {
        type: "blockMath",
        attrs: { latex: "a^2 + b^2 = c^2" },
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "text", text: "Column" }] },
              { type: "tableCell", content: [{ type: "text", text: "Value" }] },
            ],
          },
        ],
      },
      {
        type: "image",
        attrs: {
          assetId: "https://cdn.example.test/graph.png",
          src: "https://cdn.example.test/graph.png",
          alt: "A plotted graph",
          caption: "Sample graph",
        },
      },
    ],
  },
};

describe("StructuredContentRenderer", () => {
  it("loads delivery images directly by asset id without requesting metadata", async () => {
    const managed: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { assetId: "asset-1", alt: "Graph" } }] },
    };
    const loadMediaUrl = vi.fn().mockResolvedValue("blob:asset-1");
    render(
      <StructuredContentRenderer
        content={managed}
        loadMediaUrl={loadMediaUrl}
      />,
    );

    expect(await screen.findByRole("img", { name: "Graph" })).toHaveAttribute("src", "blob:asset-1");
    expect(loadMediaUrl).toHaveBeenCalledWith("asset-1");
    expect(getAssessmentMediaAsset).not.toHaveBeenCalled();
  });

  it("shows unavailable when direct delivery loading fails", async () => {
    const managed: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { assetId: "asset-1", alt: "Graph" } }] },
    };
    const loadMediaUrl = vi.fn().mockRejectedValue(new Error("missing"));
    render(
      <StructuredContentRenderer
        content={managed}
        loadMediaUrl={loadMediaUrl}
      />,
    );

    await screen.findByRole("status");
    expect(loadMediaUrl).toHaveBeenCalledWith("asset-1");
    expect(getAssessmentMediaAsset).not.toHaveBeenCalled();
  });

  it("does not make another request when the loaded image fails", async () => {
    const managed: StructuredContent = {
      version: 2,
      nodes: [],
      document: { type: "doc", content: [{ type: "image", attrs: { assetId: "asset-1", alt: "Graph" } }] },
    };
    const loadMediaUrl = vi.fn().mockResolvedValue("blob:asset-1");
    const onMediaFailure = vi.fn();
    const { container } = render(
      <StructuredContentRenderer
        content={managed}
        questionId="question-1"
        loadMediaUrl={loadMediaUrl}
        onMediaFailure={onMediaFailure}
      />,
    );

    await screen.findByRole("img", { name: "Graph" });
    fireEvent.error(screen.getByRole("img", { name: "Graph" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Visual could not be loaded");
    expect(loadMediaUrl).toHaveBeenCalledTimes(1);
    expect(onMediaFailure).toHaveBeenCalledWith("asset-1", "question-1");
    expect(getAssessmentMediaAsset).not.toHaveBeenCalled();
  });

  it("decorates text with stable block offsets while retaining authored marks", () => {
    const source: StructuredContent = { version: 2, nodes: [], document: { type: 'doc', content: [
      { type: 'paragraph', attrs: { id: 'evidence' }, content: [
        { type: 'text', text: 'A ' },
        { type: 'text', text: 'tree', marks: [{ type: 'bold' }] },
      ] },
    ] } };
    const { container } = render(<StructuredContentRenderer content={source} renderText={({ text, nodeId, startOffset }) =>
      <span data-node={nodeId} data-offset={startOffset}>{text}</span>
    } />);
    expect(container.querySelector('strong span')).toHaveAttribute('data-node', 'evidence');
    expect(container.querySelector('strong span')).toHaveAttribute('data-offset', '2');
    expect(container.querySelector('[data-content-text-node="evidence"]')).toHaveTextContent('A tree');
  });

  it("anchors stable prose runs on either side of inline math", () => {
    const source: StructuredContent = { version: 2, nodes: [], document: { type: 'doc', content: [
      { type: 'paragraph', attrs: { id: 'mixed-prompt' }, content: [
        { type: 'text', text: 'The graph of ' },
        { type: 'inlineMath', attrs: { latex: 'x^2' } },
        { type: 'text', text: ' has its minimum at which point?' },
      ] },
    ] } };
    const received: Array<{ nodeId: string; blockText: string; text: string; startOffset: number }> = [];
    const { container } = render(<StructuredContentRenderer content={source} renderText={(value) => {
      received.push(value);
      return <span data-rendered-run={`${value.nodeId}:${value.startOffset}`}>{value.text}</span>;
    }} />);

    const runs = [...container.querySelectorAll<HTMLElement>('[data-content-text-node]')];
    expect(runs.map((run) => run.dataset['contentTextNode'])).toEqual([
      'mixed-prompt::text-run-0',
      'mixed-prompt::text-run-2',
    ]);
    expect(runs[0]).toHaveTextContent('The graph of');
    expect(runs[1]).toHaveTextContent('has its minimum at which point?');
    expect(container.querySelector('[role="math"]')?.closest('[data-content-text-node]')).toBeNull();
    expect(received).toEqual([
      { nodeId: 'mixed-prompt::text-run-0', blockText: 'The graph of ', text: 'The graph of ', startOffset: 0 },
      { nodeId: 'mixed-prompt::text-run-2', blockText: ' has its minimum at which point?', text: ' has its minimum at which point?', startOffset: 0 },
    ]);
    expect(container.querySelector('[data-content-text-node="evidence"]')).toBeNull();
  });
  it("renders rich content as semantic static markup without an editor instance", () => {
    const { container } = render(
      <StructuredContentRenderer content={content} className="content-surface" />
    );

    expect(container.querySelector(".content-surface")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Read this" })).toBeInTheDocument();
    expect(screen.getByText("Important").tagName).toBe("STRONG");
    expect(container.querySelector('[role="math"]')).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "A plotted graph" })).toHaveAttribute(
      "decoding",
      "async"
    );
    expect(screen.getByRole("img", { name: "A plotted graph" })).toHaveAttribute(
      "loading",
      "lazy"
    );
    expect(container.querySelector("[contenteditable]")).not.toBeInTheDocument();
  });

  it("renders legacy structured nodes through the same static path", () => {
    const legacy: StructuredContent = {
      version: 1,
      nodes: [
        { type: "paragraph", id: "p-1", text: "Legacy prompt" },
        { type: "equation", id: "e-1", latex: "y = mx + b", display: true },
      ],
    };

    const { container } = render(<StructuredContentRenderer content={legacy} />);

    expect(screen.getByText("Legacy prompt")).toBeInTheDocument();
    expect(container.querySelector('[role="math"]')).toBeInTheDocument();
  });
});
