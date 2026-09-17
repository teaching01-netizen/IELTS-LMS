import { useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { ObjectControls } from "./ObjectControls";
import { SelectionControls } from "./SelectionControls";
import { EditorFeedback } from "./EditorFeedback";
import {
  bubbleAppendTarget,
  hasLiveEditorView,
  objectAnchorFor,
  supportsHoverAnchoredBubbles,
} from "./anchoredSurfaces";
import {
  resolveObjectBubble,
  resolveTextBubble,
  type ComposerContext,
  type ImageDialogMode,
} from "./composerContext";
import { downloadImageOriginal } from "./imageObjectActions";
import { IMAGE_OBJECT_HINT_KEY, type OneTimeHintStore } from "./oneTimeHints";
import type { EditorFeedbackItem, EditorFeedbackPublisher } from "./editorFeedbackCopy";
import type { RichComposerCapabilities } from "./RichQuestionComposer";
import type { getAssessmentMediaAsset } from "../api/assessmentMediaApi";

type ImageContext = Extract<ComposerContext, { kind: "image" }>;
type EquationContext = Extract<ComposerContext, { kind: "equation" }>;

export interface EditorContextualSurfacesProps {
  editor: Editor;
  capabilities: Readonly<RichComposerCapabilities>;
  feedback: EditorFeedbackItem | null;
  onDismissFeedback: () => void;
  hintStore: OneTimeHintStore;
  onOpenImageDialog: (context: ImageContext, mode: ImageDialogMode) => void;
  onEditEquation: (context: EquationContext) => void;
  onFeedback: EditorFeedbackPublisher;
  /** Injected so the download path is testable without touching the network. */
  resolveAsset?: typeof getAssessmentMediaAsset | undefined;
}

/**
 * Everything the editor adds *around* its content:
 *
 *   - text formatting, anchored to the selection;
 *   - object controls, anchored to the image or equation the author selected;
 *   - the acknowledgement surface at the foot of the field.
 *
 * It lives beside the composer rather than inside it so the interaction model
 * can be exercised against a real editor in tests, and so the composer stays
 * what it is: the document, its plugins, and its persistence.
 */
export function EditorContextualSurfaces({
  editor,
  capabilities,
  feedback,
  onDismissFeedback,
  hintStore,
  onOpenImageDialog,
  onEditEquation,
  onFeedback,
  resolveAsset,
}: EditorContextualSurfacesProps) {
  const [hintSeen, setHintSeen] = useState(() => hintStore.seen(IMAGE_OBJECT_HINT_KEY));
  const markHintSeen = () => {
    if (hintStore.seen(IMAGE_OBJECT_HINT_KEY)) return;
    hintStore.markSeen(IMAGE_OBJECT_HINT_KEY);
    setHintSeen(true);
  };
  return (
    <>
      <BubbleMenu
        editor={editor}
        pluginKey="satSelectionBubble"
        updateDelay={0}
        shouldShow={({ state }) =>
          supportsHoverAnchoredBubbles() &&
          hasLiveEditorView(editor) &&
          resolveTextBubble({ state, editable: editor.isEditable })
        }
        options={{ placement: "top", offset: 10 }}
        appendTo={() => bubbleAppendTarget(editor) ?? document.body}
        className="sat-rich-editor__bubble"
      >
        <SelectionControls editor={editor} capabilities={capabilities} />
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="satObjectBubble"
        updateDelay={0}
        shouldShow={({ state }) => hasLiveEditorView(editor) && resolveObjectBubble(state) !== null}
        getReferencedVirtualElement={() => objectAnchorFor(editor)}
        options={{ placement: "top", offset: 12 }}
        appendTo={() => bubbleAppendTarget(editor) ?? document.body}
        className="sat-rich-editor__bubble"
      >
        <ObjectControls
          editor={editor}
          onReplace={(context) => onOpenImageDialog(context, "replace")}
          onAltText={(context) => onOpenImageDialog(context, "alt")}
          onDownload={(context) => void downloadImageOriginal(context.attrs, resolveAsset ?? unavailableAssetResolver)}
          onEditEquation={onEditEquation}
          onHintSeen={markHintSeen}
          showHint={!hintSeen}
          onFeedback={onFeedback}
        />
      </BubbleMenu>
      <EditorFeedback feedback={feedback} onDismiss={onDismissFeedback} />
    </>
  );
}

/** Used when no resolver is supplied: an unmanaged visual has nothing to fetch. */
function unavailableAssetResolver(): Promise<{ downloadUrl: string | null }> {
  return Promise.resolve({ downloadUrl: null });
}
