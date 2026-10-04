import React, { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  RotateCcw,
  RotateCw,
  Trash2,
  Underline,
} from 'lucide-react';
import { ActScienceStimulus, Passage, ExamState, StimulusImageAsset } from '../types';
import { StimulusImageEditor } from './StimulusImageEditor';
import { getPassageMetrics } from '../utils/builderEnhancements';
import { advanceImageSourceCandidate, normalizeImageUrl } from '../utils/imageUrl';
import { sanitizeHtml } from '../utils/sanitizeHtml';
import {
  rotateImageFileGateway as rotateImageFile,
  uploadActScienceStimulusImageGateway as uploadActScienceStimulusImage,
  uploadAssessmentPassageImageGateway as uploadAssessmentPassageImage,
} from '../features/exam-authoring/api/actScienceChoiceImageGateway';

const metricTone = {
  green: 'text-emerald-700 bg-emerald-50 border-emerald-100',
  yellow: 'text-amber-700 bg-amber-50 border-amber-100',
  red: 'text-red-700 bg-red-50 border-red-100',
};

const ACT_STIMULUS_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const IMAGE_DISPLAY_WIDTH_PRESETS = [25, 50, 75, 100] as const;

interface InlineImageGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface InlineImageResizeStart {
  direction: -1 | 1;
  image: HTMLImageElement;
  maxWidth: number;
  pointerId: number;
  startWidth: number;
  startX: number;
}

function getImageDisplayName(rawName: string): { extension: string; name: string } {
  const fileName = rawName.trim().split(/[\\/]/).pop() || 'Passage image';
  const extensionMatch = fileName.match(/\.([a-z0-9]{1,5})$/i);
  const name = fileName
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    extension: extensionMatch?.[1]?.toUpperCase() ?? 'IMAGE',
    name: name || 'Passage image',
  };
}

async function dataUrlToImageFile(dataUrl: string, name = "act-science-passage-image"): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  if (!ACT_STIMULUS_IMAGE_TYPES.includes(blob.type)) {
    throw new Error("Passage images must be JPG, PNG, or WebP.");
  }
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.split("/")[1];
  return new File([blob], name.includes(".") ? name : `${name}.${extension}`, { type: blob.type });
}

function imageSourcesInPassage(passage: Passage | ActScienceStimulus): string[] {
  const sources = new Set<string>();
  const doc = new DOMParser().parseFromString(passage.content, "text/html");
  doc.querySelectorAll("img[src]").forEach((image) => {
    const src = image.getAttribute("src");
    if (src?.startsWith("data:image/")) sources.add(src);
  });
  (passage.images ?? []).forEach((image) => {
    if (image.src.startsWith("data:image/")) sources.add(image.src);
  });
  return Array.from(sources);
}

function getClipboardImageFile(clipboard: DataTransfer): File | null {
  const itemFiles = Array.from(clipboard.items ?? []).flatMap((item) => {
    if (item.kind !== 'file') return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
  const files = [...itemFiles, ...Array.from(clipboard.files ?? [])];
  return files.find((file) => ACT_STIMULUS_IMAGE_TYPES.includes(file.type.toLowerCase())) ?? null;
}

function replacePassageDataImages(content: string, replacements: Map<string, string>): string {
  const doc = new DOMParser().parseFromString(content, "text/html");
  doc.querySelectorAll("img[src]").forEach((image) => {
    const src = image.getAttribute("src");
    const replacement = src ? replacements.get(src) : undefined;
    if (replacement) image.setAttribute("src", replacement);
  });
  return doc.body.innerHTML;
}

function toParagraphLabel(index: number): string {
  let label = "";
  let n = index;
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

interface StimulusPaneProps {
  passage: Passage | ActScienceStimulus;
  state: ExamState;
  setState: (next: ExamState | ((previous: ExamState) => ExamState)) => void | Promise<void>;
  section?: 'reading' | 'science';
  examId?: string | undefined;
}

function areStimulusPanePropsEqual(previous: StimulusPaneProps, next: StimulusPaneProps) {
  return (
    previous.passage.id === next.passage.id
    && previous.passage.content === next.passage.content
    && previous.passage.images === next.passage.images
    && previous.passage.wordCount === next.passage.wordCount
    && previous.section === next.section
    && previous.examId === next.examId
    && previous.state.config.standards.passageWordCount === next.state.config.standards.passageWordCount
    && previous.setState === next.setState
  );
}

export const StimulusPane = React.memo(function StimulusPane({
  passage,
  state,
  setState,
  examId,
  section = 'reading',
}: StimulusPaneProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<InlineImageResizeStart | null>(null);
  const [selectedInlineImage, setSelectedInlineImage] = useState<HTMLImageElement | null>(null);
  const [inlineImageGeometry, setInlineImageGeometry] = useState<InlineImageGeometry | null>(null);
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkError, setLinkError] = useState('');
  const [imageUploadStatus, setImageUploadStatus] = useState("");
  const [imageUploadError, setImageUploadError] = useState("");
  const [imageMigrationAttempt, setImageMigrationAttempt] = useState(0);
  const uploadCacheRef = useRef(new Map<string, Promise<string>>());
  const passageWordCount = state.config.standards.passageWordCount;
  const metrics = useMemo(
    () => getPassageMetrics(passage.content, passageWordCount),
    [passage.content, passageWordCount],
  );

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== passage.content) {
      editorRef.current.innerHTML = passage.content;
    }
  }, [passage.content]);

  const updateInlineImageGeometry = useCallback(() => {
    const image = selectedInlineImage;
    const editor = editorRef.current;
    const container = editorScrollRef.current;
    if (!image || !image.isConnected || !editor?.contains(image) || !container) {
      setInlineImageGeometry(null);
      return;
    }

    const imageRect = image.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    setInlineImageGeometry({
      left: imageRect.left - containerRect.left + container.scrollLeft,
      top: imageRect.top - containerRect.top + container.scrollTop,
      width: imageRect.width,
      height: imageRect.height,
    });
  }, [selectedInlineImage]);

  useEffect(() => {
    if (!selectedInlineImage) {
      setInlineImageGeometry(null);
      return;
    }

    const update = () => updateInlineImageGeometry();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    if (editorScrollRef.current) observer?.observe(editorScrollRef.current);
    observer?.observe(selectedInlineImage);
    window.addEventListener('resize', update);
    update();

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [selectedInlineImage, updateInlineImageGeometry]);

  useEffect(() => {
    setSelectedInlineImage(null);
    setInlineImageGeometry(null);
  }, [passage.id, section]);

  const updatePassage = useCallback(
    (
      updater: (current: Passage | ActScienceStimulus) => Passage | ActScienceStimulus,
    ) => {
      void setState((previous) => {
        const currentPassage = section === 'science'
          ? previous.science.stimuli.find((item) => item.id === passage.id)
          : previous.reading.passages.find((item) => item.id === passage.id);
        if (!currentPassage) {
          return previous;
        }

        const nextPassage = updater(currentPassage);
        const nextMetrics = getPassageMetrics(nextPassage.content, passageWordCount);
        const updatedPassage = { ...nextPassage, wordCount: nextMetrics.words };

        if (section === 'science') {
          return {
            ...previous,
            science: {
              ...previous.science,
              stimuli: previous.science.stimuli.map((item) =>
                item.id === currentPassage.id ? updatedPassage as ActScienceStimulus : item,
              ),
            },
          };
        }

        const newPassages = previous.reading.passages.map((item) =>
          item.id === currentPassage.id ? updatedPassage as Passage : item,
        );

        return { ...previous, reading: { ...previous.reading, passages: newPassages } };
      });
    },
    [passage.id, passageWordCount, section, setState],
  );

  const resolvePassageImage = useCallback(async (src: string): Promise<string> => {
    const cached = uploadCacheRef.current.get(src);
    if (cached) return cached;

    const upload = (async () => {
      if (!examId) {
        throw new Error(
          section === 'science'
            ? 'Open this ACT exam from its builder before adding passage images.'
            : 'Open this exam from its builder before adding passage images.',
        );
      }
      const file = await dataUrlToImageFile(
        src,
        section === 'science' ? 'act-science-passage-image' : 'passage-image',
      );
      return section === 'science'
        ? uploadActScienceStimulusImage(file, examId)
        : uploadAssessmentPassageImage(file, examId);
    })();

    uploadCacheRef.current.set(src, upload);
    return upload;
  }, [examId, section]);

  useEffect(() => {
    if (section !== 'science' && section !== 'reading') return;

    const sources = imageSourcesInPassage(passage);
    if (sources.length === 0) return;

    let cancelled = false;
    setImageUploadError('');
    setImageUploadStatus(
      section === 'science'
        ? 'Moving ACT Science images to managed storage…'
        : 'Moving passage images to managed storage…',
    );

    void Promise.all(
      sources.map(async (source) => [source, await resolvePassageImage(source)] as const),
    )
      .then((entries) => {
        if (cancelled) return;

        const replacements = new Map(entries);
        updatePassage((current) => ({
          ...current,
          content: replacePassageDataImages(current.content, replacements),
          images: current.images?.map((image) => {
            const src = replacements.get(image.src);
            return src ? { ...image, src } : image;
          }),
        }));
        setImageUploadStatus('');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setImageUploadStatus('');
        setImageUploadError(
          error instanceof Error
            ? error.message
            : 'Unable to move passage images to managed storage.',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [imageMigrationAttempt, examId, passage, section, resolvePassageImage, updatePassage]);

  const syncEditor = () => {
    updatePassage((current) => ({
      ...current,
      content: editorRef.current?.innerHTML ?? '',
    }));
    if (selectedInlineImage && !editorRef.current?.contains(selectedInlineImage)) {
      setSelectedInlineImage(null);
      setInlineImageGeometry(null);
    }
  };

  const setInlineImageDisplayWidth = (percent: (typeof IMAGE_DISPLAY_WIDTH_PRESETS)[number]) => {
    if (!selectedInlineImage || !editorRef.current?.contains(selectedInlineImage)) return;
    selectedInlineImage.style.width = `${percent}%`;
    selectedInlineImage.style.height = 'auto';
    syncEditor();
    updateInlineImageGeometry();
  };

  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    const image = target instanceof Element ? target.closest('img') : null;
    if (image instanceof HTMLImageElement && editorRef.current?.contains(image)) {
      setSelectedInlineImage(image);
      return;
    }
    setSelectedInlineImage(null);
  };

  const startInlineImageResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    direction: -1 | 1,
  ) => {
    if (!selectedInlineImage || !editorRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const editor = editorRef.current;
    const style = window.getComputedStyle(editor);
    const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
    const maxWidth = Math.max(80, editor.clientWidth - (Number.isFinite(padding) ? padding : 0));
    resizeStartRef.current = {
      direction,
      image: selectedInlineImage,
      maxWidth,
      pointerId: event.pointerId,
      startWidth: selectedInlineImage.getBoundingClientRect().width,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveInlineImageResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
    event.preventDefault();
    const requestedWidth = resizeStart.startWidth
      + (event.clientX - resizeStart.startX) * resizeStart.direction;
    const width = Math.min(resizeStart.maxWidth, Math.max(80, requestedWidth));
    resizeStart.image.style.width = `${width}px`;
    resizeStart.image.style.height = 'auto';
    updateInlineImageGeometry();
  };

  const finishInlineImageResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    const resizeStart = resizeStartRef.current;
    if (!resizeStart || resizeStart.pointerId !== event.pointerId) return;
    const width = resizeStart.image.getBoundingClientRect().width;
    const percent = Math.max(25, Math.min(100, Math.round((width / resizeStart.maxWidth) * 100)));
    resizeStart.image.style.width = `${percent}%`;
    resizeStart.image.style.height = 'auto';
    resizeStartRef.current = null;
    syncEditor();
    updateInlineImageGeometry();
  };

  const removeSelectedInlineImage = () => {
    if (!selectedInlineImage || !editorRef.current?.contains(selectedInlineImage)) return;
    selectedInlineImage.remove();
    setSelectedInlineImage(null);
    setInlineImageGeometry(null);
    syncEditor();
  };

  const createRotatedPassageImage = async (
    src: string,
    alt: string,
    direction: 'left' | 'right',
  ): Promise<string> => {
    if (!examId) throw new Error('Open this exam from its builder before rotating images.');
    const response = await fetch(src);
    if (!response.ok) throw new Error('Unable to read this image for rotation.');
    const sourceBlob = await response.blob();
    const file = new File([sourceBlob], alt || 'act-passage-image.jpg', {
      type: sourceBlob.type,
    });
    const rotatedFile = await rotateImageFile(file, direction);
    return section === 'science'
      ? uploadActScienceStimulusImage(rotatedFile, examId)
      : uploadAssessmentPassageImage(rotatedFile, examId);
  };

  const rotateSelectedPassageImage = async (direction: 'left' | 'right') => {
    const image = selectedInlineImage;
    if (!image || !editorRef.current?.contains(image)) return;

    setImageUploadError('');
    setImageUploadStatus('Rotating and saving image…');
    try {
      const src = await createRotatedPassageImage(image.src, image.alt, direction);
      if (!image.isConnected || !editorRef.current?.contains(image)) return;
      image.src = src;
      syncEditor();
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : 'Unable to rotate this image.');
    } finally {
      setImageUploadStatus('');
    }
  };

  const rotateAttachedPassageImage = async (imageId: string, direction: 'left' | 'right') => {
    const image = passage.images?.find((item) => item.id === imageId);
    if (!image) return;

    setImageUploadError('');
    setImageUploadStatus('Rotating and saving image…');
    try {
      const src = await createRotatedPassageImage(image.src, image.alt, direction);
      updatePassage((current) => ({
        ...current,
        images: (current.images ?? []).map((attachedImage) =>
          attachedImage.id === imageId
            ? {
                ...attachedImage,
                src,
                annotations: attachedImage.annotations.map((annotation) => ({
                  ...annotation,
                  ...(direction === 'right'
                    ? { x: 100 - annotation.y, y: annotation.x }
                    : { x: annotation.y, y: 100 - annotation.x }),
                  width: annotation.height,
                  height: annotation.width,
                })),
              }
            : attachedImage,
        ),
      }));
    } catch (error) {
      setImageUploadError(error instanceof Error ? error.message : 'Unable to rotate this image.');
    } finally {
      setImageUploadStatus('');
    }
  };

  const updateAttachedImageDisplayWidth = (
    imageId: string,
    percent: (typeof IMAGE_DISPLAY_WIDTH_PRESETS)[number],
  ) => {
    updatePassage((current) => ({
      ...current,
      images: (current.images ?? []).map((image) =>
        image.id === imageId ? { ...image, displayWidthPercent: percent } : image,
      ),
    }));
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;

    if (section === "science") {
      const imageItem = Array.from(clipboard.items).find((item) => item.kind === "file" && ACT_STIMULUS_IMAGE_TYPES.includes(item.type));
      const imageFile = imageItem?.getAsFile() ?? null;
      if (imageFile) {
        event.preventDefault();
        const editor = editorRef.current;
        if (!editor) return;
        const selection = window.getSelection();
        const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const savedRange = currentRange && editor.contains(currentRange.commonAncestorContainer) ? currentRange.cloneRange() : null;
        setImageUploadError("");
        setImageUploadStatus("Uploading passage image…");
        try {
          if (!examId) throw new Error("Open this ACT exam from its builder before adding passage images.");
          const src = await uploadActScienceStimulusImage(imageFile, examId);
          const currentEditor = editorRef.current;
          if (!currentEditor) return;
          currentEditor.focus();
          const activeSelection = window.getSelection();
          const range = savedRange?.cloneRange() ?? document.createRange();
          if (!savedRange || !currentEditor.contains(range.commonAncestorContainer)) {
            range.selectNodeContents(currentEditor);
            range.collapse(false);
          }
          range.deleteContents();
          const image = document.createElement("img");
          image.src = src;
          image.alt = imageFile.name || "ACT Science passage image";
          range.insertNode(image);
          range.setStartAfter(image);
          range.collapse(true);
          activeSelection?.removeAllRanges();
          activeSelection?.addRange(range);
          syncEditor();
          setSelectedInlineImage(image);
          setImageUploadStatus("");
        } catch (error) {
          setImageUploadStatus("");
          setImageUploadError(error instanceof Error ? error.message : "Unable to upload passage image.");
        }
        return;
      }
    }

    if (section === 'reading') {
      const imageFile = getClipboardImageFile(clipboard);
      if (imageFile) {
        event.preventDefault();
        const editor = editorRef.current;
        if (!editor) return;

        const selection = window.getSelection();
        const currentRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const savedRange = currentRange && editor.contains(currentRange.commonAncestorContainer)
          ? currentRange.cloneRange()
          : null;

        setImageUploadError('');
        setImageUploadStatus('Uploading passage image…');
        try {
          if (!examId) throw new Error('Open this exam from its builder before adding passage images.');
          const src = await uploadAssessmentPassageImage(imageFile, examId);
          const currentEditor = editorRef.current;
          if (!currentEditor) {
            setImageUploadStatus('');
            return;
          }

          currentEditor.focus();
          const activeSelection = window.getSelection();
          const range = savedRange?.cloneRange() ?? document.createRange();
          if (!savedRange || !currentEditor.contains(range.commonAncestorContainer)) {
            range.selectNodeContents(currentEditor);
            range.collapse(false);
          }
          range.deleteContents();
          const image = document.createElement('img');
          image.src = src;
          image.alt = imageFile.name || 'Passage image';
          range.insertNode(image);
          range.setStartAfter(image);
          range.collapse(true);
          activeSelection?.removeAllRanges();
          activeSelection?.addRange(range);
          syncEditor();
          setSelectedInlineImage(image);
          setImageUploadStatus('');
        } catch (error) {
          setImageUploadStatus('');
          setImageUploadError(error instanceof Error ? error.message : 'Unable to upload passage image.');
        }
        return;
      }
    }

    event.preventDefault();
    editorRef.current?.focus();
    const html = clipboard.getData("text/html");
    if (html) {
      document.execCommand("insertHTML", false, sanitizeHtml(html));
      syncEditor();
      return;
    }
    const text = clipboard.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      syncEditor();
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return;
    }

    const html = transfer.getData('text/html');
    if (html) {
      event.preventDefault();
      editorRef.current?.focus();
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      syncEditor();
    }
  };

  const applyCommand = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    syncEditor();
  };

  const addParagraphLabels = () => {
    const source = editorRef.current?.innerHTML ?? passage.content;
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${source}</div>`, 'text/html');
    const root = doc.body.firstElementChild;

    if (!root) {
      return;
    }

    let index = 0;
    Array.from(root.children).forEach((element) => {
      const text = element.textContent?.trim();
      if (!text) {
        return;
      }

      const label = toParagraphLabel(index);
      if (!text.match(/^[A-Z]\s/)) {
        element.innerHTML = `<strong>${label}</strong> ${element.innerHTML}`;
      }
      index += 1;
    });

    updatePassage((current) => ({
      ...current,
      content: root.innerHTML,
    }));
  };

  const handleInsertLink = () => {
    setLinkUrl('');
    setLinkError('');
    setIsLinkDialogOpen(true);
  };

  const confirmInsertLink = () => {
    const url = linkUrl.trim();
    if (!url) {
      setLinkError('Enter a link URL.');
      return;
    }
    if (!/^(?:https?:|mailto:|tel:|\/|#)/i.test(url)) {
      setLinkError('Use a valid http(s), mailto, tel, site-relative, or anchor link.');
      return;
    }
    setIsLinkDialogOpen(false);
    applyCommand('createLink', url);
  };

  const handleSaveImage = (image: StimulusImageAsset) => {
    if (section === "science" && image.src.startsWith("data:image/")) {
      setImageUploadError("");
      setImageUploadStatus("Uploading passage image…");
      void (async () => {
        try {
          if (!examId) throw new Error("Open this ACT exam from its builder before adding passage images.");
          const file = await dataUrlToImageFile(image.src, image.alt || "act-science-passage-image");
          const src = await uploadActScienceStimulusImage(file, examId);
          updatePassage((current) => ({ ...current, images: [...(current.images ?? []), { ...image, src }] }));
          setIsImageEditorOpen(false);
          setImageUploadStatus("");
        } catch (error) {
          setImageUploadStatus("");
          setImageUploadError(error instanceof Error ? error.message : "Unable to upload passage image.");
        }
      })();
      return;
    }
    if (section === 'reading' && image.src.startsWith('data:image/')) {
      setImageUploadError('');
      setImageUploadStatus('Uploading passage image…');
      void (async () => {
        try {
          if (!examId) throw new Error('Open this exam from its builder before adding passage images.');
          const file = await dataUrlToImageFile(image.src, image.alt || 'passage-image');
          const src = await uploadAssessmentPassageImage(file, examId);
          updatePassage((current) => ({ ...current, images: [...(current.images ?? []), { ...image, src }] }));
          setIsImageEditorOpen(false);
          setImageUploadStatus('');
        } catch (error) {
          setImageUploadStatus('');
          setImageUploadError(error instanceof Error ? error.message : 'Unable to upload passage image.');
        }
      })();
      return;
    }
    updatePassage((current) => ({ ...current, images: [...(current.images ?? []), image] }));
    setIsImageEditorOpen(false);
  };

  return (
    <>
      <div className="flex-1 flex flex-col bg-white overflow-hidden h-full min-h-0">
        <div className="border-b border-gray-100 bg-white px-4 py-3 flex items-center gap-1 flex-wrap" role="toolbar" aria-label="Passage formatting">
          <button type="button" aria-label="Bold" title="Bold" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('bold')}><Bold size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Italic" title="Italic" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('italic')}><Italic size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Underline" title="Underline" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('underline')}><Underline size={16} aria-hidden="true" /></button>
          <div className="w-px h-6 bg-gray-200 mx-1" aria-hidden="true" />
          <button type="button" aria-label="Heading 1" title="Heading 1" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('formatBlock', 'h1')}><Heading1 size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Heading 2" title="Heading 2" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('formatBlock', 'h2')}><Heading2 size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Heading 3" title="Heading 3" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('formatBlock', 'h3')}><Heading3 size={16} aria-hidden="true" /></button>
          <div className="w-px h-6 bg-gray-200 mx-1" aria-hidden="true" />
          <button type="button" aria-label="Bulleted list" title="Bulleted list" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('insertUnorderedList')}><List size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Numbered list" title="Numbered list" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => applyCommand('insertOrderedList')}><ListOrdered size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Insert link" title="Insert link" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={handleInsertLink}><LinkIcon size={16} aria-hidden="true" /></button>
          <button type="button" aria-label="Insert image" title="Insert image" className="p-2 min-w-6 min-h-6 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-1" onClick={() => setIsImageEditorOpen(true)}><ImageIcon size={16} aria-hidden="true" /></button>
          <button
            onClick={addParagraphLabels}
            className="ml-auto text-xs font-semibold text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg border border-transparent hover:border-blue-200 transition-all"
          >
            ¶ Add Paragraph Labels
          </button>
        </div>

        <div
          ref={editorScrollRef}
          onScroll={updateInlineImageGeometry}
          onErrorCapture={(event) => {
            if (section === 'science' && event.target instanceof HTMLImageElement) {
              advanceImageSourceCandidate(event.target);
            }
          }}
          className="relative flex-1 overflow-y-auto p-8 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.08),_transparent_34%)]"
        >
            {imageUploadStatus ? (
              <p role='status' className='mb-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800'>
                {imageUploadStatus}
              </p>
            ) : null}
            {imageUploadError ? (
              <div role='alert' className='mb-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800'>
                <span>{imageUploadError}</span>
                {(section === 'science' || section === 'reading') && imageSourcesInPassage(passage).length > 0 ? (
                  <button
                    type='button'
                    className='shrink-0 font-semibold underline'
                    onClick={() => {
                      uploadCacheRef.current.clear();
                      setImageMigrationAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry image upload
                  </button>
                ) : null}
              </div>
            ) : null}
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onInput={syncEditor}
              onClick={handleEditorClick}
              onPaste={handlePaste}
              onDrop={handleDrop}
              role="textbox"
              aria-label={section === 'science' ? 'ACT Science stimulus editor' : 'Reading passage editor'}
              aria-multiline="true"
              tabIndex={0}
              className="min-h-[420px] rounded-[28px] border border-gray-100 bg-white px-8 py-8 outline-none text-gray-900 leading-relaxed font-sans text-sm md:text-base shadow-sm focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 focus-visible:border-blue-600 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:mb-4 [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:mb-3 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:mb-2 [&_img]:max-w-full [&_img]:rounded-2xl [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-4"
              data-placeholder={section === 'science'
              ? 'Enter ACT Science stimulus text here...'
              : 'Enter reading passage text here...'}
            />

          {selectedInlineImage && inlineImageGeometry ? (
            <>
              <div
                className="pointer-events-none absolute z-30 border-2 border-blue-500"
                style={{
                  left: inlineImageGeometry.left,
                  top: inlineImageGeometry.top,
                  width: inlineImageGeometry.width,
                  height: inlineImageGeometry.height,
                }}
              >
                {[
                  { corner: 'top-left', direction: -1 as const, position: '-left-1.5 -top-1.5', cursor: 'cursor-nwse-resize' },
                  { corner: 'top-right', direction: 1 as const, position: '-right-1.5 -top-1.5', cursor: 'cursor-nesw-resize' },
                  { corner: 'bottom-left', direction: -1 as const, position: '-left-1.5 -bottom-1.5', cursor: 'cursor-nesw-resize' },
                  { corner: 'bottom-right', direction: 1 as const, position: '-right-1.5 -bottom-1.5', cursor: 'cursor-nwse-resize' },
                ].map((handle) => (
                  <button
                    key={handle.corner}
                    type="button"
                    aria-label={`Resize passage image ${handle.corner}`}
                    title="Drag to resize image"
                    className={`pointer-events-auto absolute z-10 h-3.5 w-3.5 rounded-sm border-2 border-white bg-blue-600 shadow ${handle.position} ${handle.cursor}`}
                    onPointerDown={(event) => startInlineImageResize(event, handle.direction)}
                    onPointerMove={moveInlineImageResize}
                    onPointerUp={finishInlineImageResize}
                    onPointerCancel={finishInlineImageResize}
                  />
                ))}
              </div>
              <div
                role="toolbar"
                aria-label="Selected passage image controls"
                className="absolute z-40 flex items-center gap-2 rounded-xl border border-blue-200 bg-white p-2 shadow-lg"
                style={{
                  left: Math.max(8, Math.min(
                    inlineImageGeometry.left,
                    (editorScrollRef.current?.clientWidth ?? 320) - 360,
                  )),
                  top: Math.max(8, inlineImageGeometry.top - 52),
                }}
              >
                <span className="px-1 text-[11px] font-semibold text-gray-500">Size</span>
                <div role="group" aria-label="Image display width" className="flex items-center gap-1">
                  {IMAGE_DISPLAY_WIDTH_PRESETS.map((percent) => (
                    <button
                      key={percent}
                      type="button"
                      aria-label={`Set image width to ${percent}%`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setInlineImageDisplayWidth(percent)}
                      className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-semibold text-gray-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
                <div role="group" aria-label="Rotate selected passage image" className="flex items-center gap-1 border-l border-gray-200 pl-2">
                  <button
                    type="button"
                    aria-label="Rotate selected passage image left 90 degrees"
                    title="Rotate left 90°"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void rotateSelectedPassageImage('left')}
                    className="rounded-lg border border-gray-200 p-1.5 text-gray-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Rotate selected passage image right 90 degrees"
                    title="Rotate right 90°"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void rotateSelectedPassageImage('right')}
                    className="rounded-lg border border-gray-200 p-1.5 text-gray-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    <RotateCw size={15} aria-hidden="true" />
                  </button>
                </div>
                <button
                  type="button"
                  aria-label="Remove selected passage image"
                  title="Remove image"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={removeSelectedInlineImage}
                  className="rounded-lg border border-gray-200 p-1.5 text-red-700 hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : null}

          {(passage.images ?? []).length > 0 && (
            <div
              data-testid="passage-attached-images-grid"
              className="mt-6 grid gap-4"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22.5rem), 1fr))' }}
            >
              {(passage.images ?? []).map((image) => {
                const displayName = getImageDisplayName(image.alt || 'Passage image');
                const displayWidthPercent = image.displayWidthPercent ?? 100;
                return (
                <div key={image.id} data-testid="passage-image-card" className="min-w-0 overflow-hidden rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-gray-100 bg-gray-50">
                    <div
                      className="absolute inset-y-0 left-1/2 max-w-full -translate-x-1/2"
                      style={{ width: `${displayWidthPercent}%` }}
                    >
                      <img
                        src={normalizeImageUrl(image.src)}
                        data-image-original-src={image.src}
                        alt={image.alt}
                        title={image.alt}
                        onError={(event) => {
                          if (section === 'science') {
                            advanceImageSourceCandidate(event.currentTarget);
                          }
                        }}
                        className="h-full w-full object-contain"
                      />
                      {image.annotations.map((annotation) => (
                        <span
                          key={annotation.id}
                          className="absolute"
                          style={{
                            left: `${annotation.x}%`,
                            top: `${annotation.y}%`,
                            width: annotation.width ? `${annotation.width}%` : undefined,
                            height: annotation.height ? `${annotation.height}%` : undefined,
                            transform: 'translate(-50%, -50%)',
                          }}
                        >
                          {annotation.type === 'hotspot' && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow-md">
                              •
                            </span>
                          )}
                          {annotation.type === 'text' && (
                            <span className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-gray-800 border border-gray-200">
                              {annotation.text}
                            </span>
                          )}
                          {annotation.type === 'box' && (
                            <span className="block h-full w-full rounded-lg border-2 border-blue-600 bg-blue-100/10" />
                          )}
                          {annotation.type === 'arrow' && (
                            <span className="rounded-full bg-blue-600 px-2 py-1 text-[10px] font-bold text-white">
                              Arrow
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3 rounded-2xl border border-gray-100 bg-gray-50 p-3">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 basis-40">
                        <p title={image.alt} className="truncate text-sm font-semibold text-gray-800">
                          {displayName.name}
                        </p>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-500">
                          <span className="whitespace-nowrap rounded-full bg-white px-2 py-0.5 font-bold tracking-wide text-gray-500">
                            {displayName.extension}
                          </span>
                          <span className="whitespace-nowrap">{image.annotations.length} annotations</span>
                        </div>
                      </div>
                      <div role="group" aria-label={`Rotate ${displayName.name}`} className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          aria-label={`Rotate ${displayName.name} left 90 degrees`}
                          title="Rotate left 90°"
                          className="rounded-lg border border-gray-200 bg-white p-2 text-gray-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          onClick={() => void rotateAttachedPassageImage(image.id, 'left')}
                        >
                          <RotateCcw size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Rotate ${displayName.name} right 90 degrees`}
                          title="Rotate right 90°"
                          className="rounded-lg border border-gray-200 bg-white p-2 text-gray-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                          onClick={() => void rotateAttachedPassageImage(image.id, 'right')}
                        >
                          <RotateCw size={14} aria-hidden="true" />
                        </button>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove image: ${image.alt || 'Passage image'}`}
                        title="Remove image from Passage"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                        onClick={() => updatePassage((current) => ({
                          ...current,
                          images: (current.images ?? []).filter((attachedImage) => attachedImage.id !== image.id),
                        }))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-2 border-t border-gray-200 pt-2">
                      <span className="text-[11px] font-medium text-gray-500">Display size</span>
                      <div role="group" aria-label={`Image display width for ${displayName.name}`} className="grid grid-cols-4 gap-1">
                        {IMAGE_DISPLAY_WIDTH_PRESETS.map((percent) => (
                          <button
                            key={percent}
                            type="button"
                            aria-label={`Set ${displayName.name} width to ${percent}%`}
                            aria-pressed={displayWidthPercent === percent}
                            onClick={() => updateAttachedImageDisplayWidth(image.id, percent)}
                            className={`min-w-0 whitespace-nowrap rounded-md border px-1.5 py-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                              displayWidthPercent === percent
                                ? 'border-blue-300 bg-blue-50 text-blue-700'
                                : 'border-gray-200 bg-white text-gray-600 hover:bg-blue-50'
                            }`}
                          >
                            {percent}%
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 text-xs text-gray-500 font-semibold">
            <span>Words: {metrics.words}</span>
            <span>Chars: {metrics.characters}</span>
            <span>Attached Images: {(passage.images ?? []).length}</span>
          </div>
          <div
            title={metrics.tooltip}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] ${metricTone[metrics.tone]}`}
          >
            {metrics.status === 'optimal'
              ? `${passageWordCount.optimalMin}-${passageWordCount.optimalMax} optimal`
              : metrics.status === 'warning'
                ? `${passageWordCount.warningMin}-${passageWordCount.warningMax} warning`
                : 'Outside range'}
          </div>
        </div>
      </div>

      {isLinkDialogOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="stimulus-link-title">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={() => setIsLinkDialogOpen(false)} />
          <div className="relative w-full max-w-sm bg-white rounded-xl shadow-xl p-6 space-y-4">
            <h2 id="stimulus-link-title" className="text-base font-semibold text-gray-900">Insert link</h2>
            <div>
              <label htmlFor="stimulus-link-url" className="block text-sm font-medium text-gray-700 mb-1">Link URL</label>
              <input
                id="stimulus-link-url"
                value={linkUrl}
                onChange={(event) => { setLinkUrl(event.target.value); if (linkError) setLinkError(''); }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); confirmInsertLink(); } if (event.key === 'Escape') setIsLinkDialogOpen(false); }}
                placeholder="https://example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:border-blue-600"
                aria-invalid={Boolean(linkError)}
                aria-describedby={linkError ? 'stimulus-link-error' : undefined}
              />
              {linkError ? <p id="stimulus-link-error" role="alert" className="mt-1 text-sm text-red-700">{linkError}</p> : null}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsLinkDialogOpen(false)} className="px-4 py-2 min-h-11 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">Cancel</button>
              <button type="button" onClick={confirmInsertLink} className="px-4 py-2 min-h-11 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Insert link</button>
            </div>
          </div>
        </div>
      ) : null}

      <StimulusImageEditor
        isOpen={isImageEditorOpen}
        allowRotation
        onClose={() => setIsImageEditorOpen(false)}
        onSave={handleSaveImage}
      />
    </>
  );
}, areStimulusPanePropsEqual);
