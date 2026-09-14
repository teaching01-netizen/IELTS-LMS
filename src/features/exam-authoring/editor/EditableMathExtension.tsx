import { useEffect, useMemo, useRef, useState } from "react";
import { Selection } from "@tiptap/pm/state";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import katex from "katex";
import type { MathfieldElement } from "mathlive";
import "mathlive/fonts.css";
import { logger } from "../../../utils/logger";
import { BlockMathNode, InlineMathNode, mathOptions } from "./schema/mathNodes";

let mathLiveModule: Promise<typeof import("mathlive")> | null = null;

function loadMathLive() {
  mathLiveModule ??= import("mathlive");
  return mathLiveModule;
}

function renderEquation(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, { ...mathOptions, displayMode });
  } catch {
    return latex;
  }
}

type MathExitDirection = "backward" | "forward";

function EditableMathNode({ editor, getPos, node, updateAttributes, selected }: NodeViewProps) {
  const isBlock = node.type.name === "blockMath";
  const latex = String(node.attrs["latex"] ?? "");
  const [editing, setEditing] = useState(false);
  const hostRef = useRef<HTMLSpanElement | HTMLDivElement>(null);
  const cancelledRef = useRef(false);
  const rendered = useMemo(() => renderEquation(latex, isBlock), [isBlock, latex]);

  useEffect(() => {
    if (!editing || !hostRef.current) return;
    const host = hostRef.current;
    let disposed = false;
    let field: MathfieldElement | null = null;
    let frame: number | null = null;
    let finished = false;

    /**
     * Ends the visual math editing session exactly once. When an exit direction is
     * supplied, focus is transferred back to the surrounding ProseMirror document
     * at the nearest valid selection before or after the atomic math node.
     */
    const finish = (commit: boolean, exitDirection?: MathExitDirection) => {
      if (finished) return;
      finished = true;

      if (commit && field) {
        const nextLatex = field.value.trim();
        if (nextLatex.length > 0 && nextLatex !== latex) {
          updateAttributes({ latex: nextLatex });
        }
      }

      setEditing(false);

      if (!exitDirection) return;
      const nodePosition = getPos();
      const requestedPosition =
        typeof nodePosition === "number"
          ? exitDirection === "backward"
            ? nodePosition
            : nodePosition + node.nodeSize
          : null;
      const bias = exitDirection === "backward" ? -1 : 1;

      window.requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        if (requestedPosition === null) {
          editor.view.focus();
          return;
        }

        const currentDocument = editor.state.doc;
        const clampedPosition = Math.max(0, Math.min(requestedPosition, currentDocument.content.size));
        const resolved = currentDocument.resolve(clampedPosition);
        const selection = Selection.near(resolved, bias);
        const transaction = editor.state.tr.setSelection(selection).scrollIntoView();
        editor.view.dispatch(transaction);
        editor.view.focus();
      });
    };

    void loadMathLive()
      .then(({ MathfieldElement }) => {
        if (disposed) return;
        field = new MathfieldElement();
        cancelledRef.current = false;
        field.value = latex;
        field.className = isBlock ? "sat-block-mathfield" : "sat-inline-mathfield";
        field.setAttribute("aria-label", isBlock ? "Edit display equation" : "Edit inline equation");
        field.setAttribute("math-virtual-keyboard-policy", "manual");
        field.setAttribute("smart-fence", "true");
        field.setAttribute("smart-superscript", "true");

        const onKeyDown = (event: KeyboardEvent) => {
          event.stopPropagation();

          if (event.key === "Escape") {
            event.preventDefault();
            cancelledRef.current = true;
            finish(false, "forward");
            return;
          }

          if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            finish(true, "forward");
          }
        };
        const onMoveOut = (event: CustomEvent<{ direction: "forward" | "backward" | "upward" | "downward" }>) => {
          if (event.detail.direction !== "backward" && event.detail.direction !== "forward") return;
          event.stopPropagation();
          finish(true, event.detail.direction);
        };
        const stop = (event: Event) => event.stopPropagation();
        const commit = () => finish(!cancelledRef.current);

        field.addEventListener("keydown", onKeyDown);
        field.addEventListener("move-out", onMoveOut);
        field.addEventListener("input", stop);
        field.addEventListener("beforeinput", stop);
        field.addEventListener("change", commit);
        field.addEventListener("focusout", commit);
        field.addEventListener("pointerdown", stop);
        host.replaceChildren(field);

        frame = window.requestAnimationFrame(() => {
          if (!field) return;
          field.focus();
          field.position = field.lastOffset;
        });

        const currentField = field;
        const cleanup = () => {
          currentField.removeEventListener("keydown", onKeyDown);
          currentField.removeEventListener("move-out", onMoveOut);
          currentField.removeEventListener("input", stop);
          currentField.removeEventListener("beforeinput", stop);
          currentField.removeEventListener("change", commit);
          currentField.removeEventListener("focusout", commit);
          currentField.removeEventListener("pointerdown", stop);
          if (host.contains(currentField)) host.removeChild(currentField);
        };
        (currentField as MathfieldElement & { __cleanup?: () => void }).__cleanup = cleanup;
      })
      .catch((error: unknown) => {
        logger.error("Failed to load visual equation editor", {
          error,
          equationKind: isBlock ? "block" : "inline",
        });
        if (!disposed) setEditing(false);
      });

    return () => {
      disposed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      const activeField = field as (MathfieldElement & { __cleanup?: () => void }) | null;
      activeField?.__cleanup?.();
    };
  }, [editor, editing, getPos, isBlock, latex, node.nodeSize, updateAttributes]);

  const beginEditing = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    setEditing(true);
  };

  const commonProps = {
    "data-equation-editing": editing ? "true" : undefined,
    "data-equation-selected": selected ? "true" : undefined,
    contentEditable: false,
  } as const;

  if (isBlock) {
    return (
      <NodeViewWrapper as="div" className="sat-editable-block-math" {...commonProps}>
        {editing ? (
          <div
            ref={hostRef as React.RefObject<HTMLDivElement>}
            className="sat-mathfield-host sat-mathfield-host--block"
          />
        ) : (
          <div
            role="button"
            tabIndex={0}
            aria-label={`Edit equation: ${latex}`}
            title="Click to edit equation"
            className="sat-rendered-math sat-rendered-math--block"
            onClick={beginEditing}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") beginEditing(event);
            }}
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" className="sat-editable-inline-math" {...commonProps}>
      {editing ? (
        <span
          ref={hostRef as React.RefObject<HTMLSpanElement>}
          className="sat-mathfield-host sat-mathfield-host--inline"
        />
      ) : (
        <span
          role="button"
          tabIndex={0}
          aria-label={`Edit inline equation: ${latex}`}
          title="Click to edit equation"
          className="sat-rendered-math sat-rendered-math--inline"
          onClick={beginEditing}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") beginEditing(event);
          }}
          dangerouslySetInnerHTML={{ __html: rendered }}
        />
      )}
    </NodeViewWrapper>
  );
}

// The browser extends the SHARED node definitions (see ./schema/mathNodes.ts)
// with a node view. Node name, attributes, and schema rules stay identical to
// what the Hocuspocus co-editing service converts, which is what makes a
// round trip lossless.
export const EditableInlineMath = InlineMathNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditableMathNode, { as: "span" });
  },
});

export const EditableBlockMath = BlockMathNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(EditableMathNode, { as: "div" });
  },
});
