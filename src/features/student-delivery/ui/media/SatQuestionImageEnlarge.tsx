import { SatImageViewer } from "./SatImageViewer";
import type { SatImageEnlargeProps } from "../../../exam-rendering/api/structuredContentEnlarge";

/**
 * Question-image enlarge wiring (student-delivery side of the
 * exam-rendering enlarge slot). exam-rendering owns the image block;
 * this adapter owns the Bluebook lightbox presentation. The feature
 * boundary stays one-directional: student-delivery imports
 * exam-rendering, never the reverse.
 */
export function SatQuestionImageEnlarge(props: SatImageEnlargeProps) {
  return (
    <>
      <div className="flex justify-center">
        <SatImageViewer.EnlargeButton label={props.label} enlargeId={props.enlargeId} onOpen={props.onOpen} />
      </div>
      <SatImageViewer
        src={props.src}
        alt={props.label}
        open={props.open}
        onClose={props.onClose}
        returnFocusSelector={props.returnFocusSelector}
      />
    </>
  );
}

export function renderSatQuestionImageEnlarge(props: SatImageEnlargeProps) {
  return <SatQuestionImageEnlarge {...props} />;
}
