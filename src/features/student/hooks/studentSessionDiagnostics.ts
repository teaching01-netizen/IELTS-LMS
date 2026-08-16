export type DiagramSnapshotIssue = {
  blockId: string;
  section: 'reading' | 'listening';
  containerId: string;
  hasImageSrc: boolean;
  hasAssetUrl: boolean;
  hasUsableFallback: boolean;
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function collectPublishedDiagramSnapshotIssues(contentSnapshot: unknown): {
  totalDiagramBlocks: number;
  missingImageUrlCount: number;
  missingUsableImageCount: number;
  missingBlocks: DiagramSnapshotIssue[];
} {
  const snapshot = contentSnapshot as {
    reading?: {
      passages?: Array<{ id?: unknown; blocks?: unknown }>;
    };
    listening?: {
      parts?: Array<{ id?: unknown; blocks?: unknown }>;
    };
  };

  const missingBlocks: DiagramSnapshotIssue[] = [];
  let totalDiagramBlocks = 0;
  let missingImageUrlCount = 0;
  let missingUsableImageCount = 0;

  const collectFromBlocks = (
    section: DiagramSnapshotIssue['section'],
    containerId: string,
    blocks: unknown,
  ) => {
    if (!Array.isArray(blocks)) {
      return;
    }

    blocks.forEach((block) => {
      if (!block || typeof block !== 'object') {
        return;
      }

      const blockRecord = block as Record<string, unknown>;
      if (blockRecord['type'] !== 'DIAGRAM_LABELING') {
        return;
      }

      totalDiagramBlocks += 1;

      const imageUrl = readNonEmptyString(blockRecord['imageUrl']);
      if (imageUrl) {
        return;
      }

      const imageSrc = readNonEmptyString(blockRecord['imageSrc']);
      const assetUrl = readNonEmptyString(blockRecord['assetUrl']);
      const hasUsableFallback = Boolean(imageSrc || assetUrl);
      if (!hasUsableFallback) {
        missingUsableImageCount += 1;
      }

      missingImageUrlCount += 1;
      missingBlocks.push({
        blockId: readNonEmptyString(blockRecord['id']) ?? '(unknown-block-id)',
        section,
        containerId,
        hasImageSrc: Boolean(imageSrc),
        hasAssetUrl: Boolean(assetUrl),
        hasUsableFallback,
      });
    });
  };

  if (Array.isArray(snapshot.reading?.passages)) {
    snapshot.reading.passages.forEach((passage, index) => {
      const passageId = readNonEmptyString(passage?.id) ?? `reading-passage-${index + 1}`;
      collectFromBlocks('reading', passageId, passage?.blocks);
    });
  }

  if (Array.isArray(snapshot.listening?.parts)) {
    snapshot.listening.parts.forEach((part, index) => {
      const partId = readNonEmptyString(part?.id) ?? `listening-part-${index + 1}`;
      collectFromBlocks('listening', partId, part?.blocks);
    });
  }

  return {
    totalDiagramBlocks,
    missingImageUrlCount,
    missingUsableImageCount,
    missingBlocks,
  };
}
