import React from 'react';
import type { QuestionBlock } from '../../types';
import { getInsertedImages, supportsInsertedImages } from '../../utils/insertedImages';
import { getImageUrlCandidates } from '../../utils/imageUrl';
import { StudentZoomableMedia } from './StudentZoomableMedia';

/** The slice of a block this renderer needs; keeps callers from widening types. */
export type InsertedImageBlock = Pick<QuestionBlock, 'type' | 'insertedImages'>;

export interface ResolvedInsertedImage {
  id: string;
  /**
   * Drive-tolerant candidate list, not a single src: a share link is rewritten
   * to thumbnail/lh3/uc sources and a failed load advances to the next one, so
   * a private-but-shared Drive file still renders.
   */
  sources: string[];
  caption: string;
}

/**
 * Rows without a usable source are dropped rather than rendered as a broken
 * frame or an empty placeholder: an authoring row that was never filled in
 * (or holds an unsafe scheme, which `getImageUrlCandidates` refuses) must not
 * leave a gap between the instruction and the questions.
 */
export function resolveInsertedImageRows(
  block: InsertedImageBlock,
): ResolvedInsertedImage[] {
  if (!supportsInsertedImages(block)) {
    return [];
  }

  return getInsertedImages(block)
    .map((image, index) => ({
      id: image.id || `inserted-image-${index + 1}`,
      sources: getImageUrlCandidates(image.url ?? ''),
      caption: image.caption?.trim() ?? '',
    }))
    .filter((row) => row.sources.length > 0);
}

interface StudentInsertedImagesProps {
  block: InsertedImageBlock;
  compact?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Delivery counterpart to `InsertedImagesEditor`: renders the block's inserted
 * images after the instruction and before the question content, the slot the
 * authoring editor promises. Returns null when the block has none (or has none
 * that can load), so unchanged blocks keep their exact previous markup.
 */
export function StudentInsertedImages({
  block,
  compact = false,
  className,
}: StudentInsertedImagesProps) {
  const rows = resolveInsertedImageRows(block);
  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      className={[compact ? 'space-y-2' : 'space-y-3', className ?? ''].join(' ').trim()}
      data-testid="student-inserted-images"
    >
      {rows.map((row, index) => {
        const accessibleName = row.caption || `Inserted image ${index + 1}`;
        return (
          // Key carries the row's position as well as its id: an imported
          // payload can repeat an authoring id, and an id-only key would make
          // two siblings collide on reconciliation.
          <figure key={`${row.id}::${index}`} className="m-0">
            <StudentZoomableMedia
              sources={row.sources}
              alt={accessibleName}
              label={accessibleName}
              hint="Tap to zoom the image"
              className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
              imageClassName={compact ? 'max-h-[40dvh]' : 'max-h-[56dvh]'}
            />
            {row.caption ? (
              <figcaption
                className={`mt-1 text-center text-gray-600 ${
                  compact ? 'text-xs md:text-sm' : 'text-sm'
                }`}
              >
                {row.caption}
              </figcaption>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
}
