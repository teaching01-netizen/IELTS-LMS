export type BoldSegment = {
  text: string;
  bold: boolean;
};

export function parseBoldMarkdown(text: string): BoldSegment[] {
  const segments: BoldSegment[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const open = text.indexOf('**', cursor);
    if (open === -1) {
      segments.push({ text: text.slice(cursor), bold: false });
      break;
    }

    const close = text.indexOf('**', open + 2);
    if (close === -1) {
      // Unmatched opening markers: treat the rest as plain text.
      segments.push({ text: text.slice(cursor), bold: false });
      break;
    }

    if (open > cursor) {
      segments.push({ text: text.slice(cursor, open), bold: false });
    }

    segments.push({ text: text.slice(open + 2, close), bold: true });
    cursor = close + 2;
  }

  if (segments.length === 0) {
    return [{ text: '', bold: false }];
  }

  // Merge adjacent segments with the same style to keep rendering stable.
  const merged: BoldSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.bold === segment.bold) {
      previous.text += segment.text;
      continue;
    }
    merged.push({ ...segment });
  }

  return merged;
}

export function stripBoldMarkdown(text: string): string {
  return text.replaceAll('**', '');
}

export type ToggleBoldResult = {
  nextValue: string;
  nextSelectionStart: number;
  nextSelectionEnd: number;
};

export function toggleBoldMarkers(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): ToggleBoldResult {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(0, Math.min(selectionEnd, value.length));
  const left = Math.min(start, end);
  const right = Math.max(start, end);

  if (left === right) {
    const nextValue = `${value.slice(0, left)}****${value.slice(right)}`;
    const caret = left + 2;
    return { nextValue, nextSelectionStart: caret, nextSelectionEnd: caret };
  }

  const hasWrapping =
    left >= 2 &&
    right + 2 <= value.length &&
    value.slice(left - 2, left) === '**' &&
    value.slice(right, right + 2) === '**';

  if (hasWrapping) {
    const nextValue = `${value.slice(0, left - 2)}${value.slice(left, right)}${value.slice(right + 2)}`;
    return {
      nextValue,
      nextSelectionStart: left - 2,
      nextSelectionEnd: right - 2,
    };
  }

  const nextValue = `${value.slice(0, left)}**${value.slice(left, right)}**${value.slice(right)}`;
  return {
    nextValue,
    nextSelectionStart: left + 2,
    nextSelectionEnd: right + 2,
  };
}

export function isBoldHotkey(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey?: boolean;
}): boolean {
  const key = event.key.toLowerCase();
  if (key !== 'b') return false;
  if (event.altKey) return false;
  return event.metaKey || event.ctrlKey;
}

export function handleBoldHotkey(
  event: {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey?: boolean;
    preventDefault: () => void;
    currentTarget: {
      value: string;
      selectionStart: number | null;
      selectionEnd: number | null;
      setSelectionRange: (start: number, end: number) => void;
    };
  },
  applyValue: (nextValue: string) => void,
): void {
  if (!isBoldHotkey(event)) {
    return;
  }

  const element = event.currentTarget;
  const selectionStart = element.selectionStart;
  const selectionEnd = element.selectionEnd;
  if (selectionStart === null || selectionEnd === null) {
    return;
  }

  event.preventDefault();

  const { nextValue, nextSelectionStart, nextSelectionEnd } = toggleBoldMarkers(
    element.value,
    selectionStart,
    selectionEnd,
  );

  applyValue(nextValue);

  setTimeout(() => {
    try {
      element.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    } catch {
      // Ignore selection restoration failures (element may have been unmounted).
    }
  }, 0);
}
