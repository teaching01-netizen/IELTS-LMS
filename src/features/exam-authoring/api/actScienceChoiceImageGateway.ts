import * as implementation from '../infrastructure/actScienceChoiceImageGateway';

export const ACT_SCIENCE_CHOICE_IMAGE_TYPES = implementation.ACT_SCIENCE_CHOICE_IMAGE_TYPES;

export const rotateImageFileGateway = (
  ...args: Parameters<typeof implementation.rotateImageFileGateway>
) => implementation.rotateImageFileGateway(...args);

export const uploadAssessmentPassageImageGateway = (
  ...args: Parameters<typeof implementation.uploadAssessmentPassageImageGateway>
) => implementation.uploadAssessmentPassageImageGateway(...args);

export const uploadActScienceChoiceImageGateway = (
  ...args: Parameters<typeof implementation.uploadActScienceChoiceImageGateway>
) => implementation.uploadActScienceChoiceImageGateway(...args);

export const uploadActScienceQuestionImageGateway = (
  ...args: Parameters<typeof implementation.uploadActScienceQuestionImageGateway>
) => implementation.uploadActScienceQuestionImageGateway(...args);

export const uploadActScienceStimulusImageGateway = (
  ...args: Parameters<typeof implementation.uploadActScienceStimulusImageGateway>
) => implementation.uploadActScienceStimulusImageGateway(...args);
