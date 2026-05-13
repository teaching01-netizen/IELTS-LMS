import React from 'react';
import { RichTextHighlighter } from '../../components/student/RichTextHighlighter';

export function HighlightSelectionDebugRoute() {
  const content =
    'Select any part of this text. The selection should remain stable after you release the mouse, and the toolbar should appear without clearing the highlight. ' +
    'This route exists to regression-test selection/highlight behavior in dev and e2e.\n\n' +
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ' +
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-bold text-gray-900">Highlight Selection Debug</h1>
      <p className="mt-2 text-sm text-gray-600">
        Path: <code>/__dev/highlight-selection</code>
      </p>
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <RichTextHighlighter
          content={content}
          contentType="text"
          enabled
          as="div"
          className="whitespace-pre-wrap font-serif text-lg leading-relaxed text-gray-900"
          highlightSurfaceId="__dev:highlight-selection"
        />
      </div>
    </div>
  );
}

