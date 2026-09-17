import { Selection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";

/**
 * Object operations as single transactions.
 *
 * One transaction means one undo step, and the caret is placed where the author
 * expects it afterwards — in the flow where the object used to be — instead of
 * being left on a dead node selection.
 */

/** Deletes the object at `pos` and lands the caret in the following block. */
export function deleteObjectAt(editor: Editor, pos: number): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const transaction = editor.state.tr.delete(pos, pos + node.nodeSize);
  const caret = Math.max(0, Math.min(pos, transaction.doc.content.size));
  transaction.setSelection(Selection.near(transaction.doc.resolve(caret), 1));
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

/**
 * Moves an equation between inline and display without losing its expression.
 * Placement is a property of the node type, so this replaces the node rather
 * than editing an attribute.
 */
export function convertEquationAt(editor: Editor, pos: number, display: boolean): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "inlineMath" && node.type.name !== "blockMath") return false;
  if ((node.type.name === "blockMath") === display) return false;
  editor
    .chain()
    .focus()
    .insertContentAt(
      { from: pos, to: pos + node.nodeSize },
      { type: display ? "blockMath" : "inlineMath", attrs: { latex: String(node.attrs["latex"] ?? "") } }
    )
    .run();
  return true;
}
