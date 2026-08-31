import { useEffect, useMemo } from "react";
import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mathematics from "@tiptap/extension-mathematics";
import { TableKit } from "@tiptap/extension-table";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import "katex/dist/katex.min.css";
import type { StructuredContent } from "./api/assessmentContracts";
import { SatImage } from "../exam-authoring/api/renderingPublic";
import { documentFromStructuredContent } from "../exam-authoring/api/renderingPublic";

const extensions = [
  StarterKit.configure({
    blockquote: false,
    heading: { levels: [2, 3] },
  }),
  Mathematics.configure({ katexOptions: { throwOnError: false, strict: false } }),
  TableKit.configure({ table: { resizable: false } }),
  Subscript,
  Superscript,
  SatImage.configure({ inline: false, allowBase64: false }),
];

export function RichStructuredContentRenderer({ content }: { content: StructuredContent }) {
  const initial = useMemo(() => documentFromStructuredContent(content), [content]);
  const editor = useEditor({
    extensions,
    content: initial as JSONContent,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          "outline-none text-[inherit] leading-7 [&_p]:my-2 [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-slate-200 [&_td]:p-2.5 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2.5 [&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-slate-50 [&_pre]:p-4 [&_pre]:font-mono [&_pre]:text-[0.92em] [&_pre]:leading-6 [&_pre]:text-slate-900",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = documentFromStructuredContent(content);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.commands.setContent(next as JSONContent, { emitUpdate: false });
    }
  }, [content, editor]);

  if (!editor) return null;
  return <EditorContent editor={editor} />;
}
