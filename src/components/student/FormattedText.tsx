import React from 'react';
import { parseBoldMarkdown } from '../../utils/boldMarkdown';

type FormattedTextProps = {
  text: string;
  className?: string | undefined;
  as?: 'span' | 'div' | 'p';
};

export function FormattedText({ text, className, as = 'span' }: FormattedTextProps) {
  const Tag = as;
  const segments = parseBoldMarkdown(text);
  const classes = ['whitespace-pre-wrap', 'break-words', className].filter(Boolean).join(' ');

  return (
    <Tag className={classes}>
      {segments.map((segment, index) =>
        segment.bold ? (
          <strong key={index} className="font-bold">
            {segment.text}
          </strong>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </Tag>
  );
}

