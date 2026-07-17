import React from 'react';
import { FormattedText } from './FormattedText';

type StudentQuestionTextProps = React.ComponentProps<typeof FormattedText>;

export function StudentQuestionText(props: StudentQuestionTextProps) {
  return <FormattedText {...props} suppressTouchCallout />;
}
