import {
  ACT_SCIENCE_CHOICE_IMAGE_TYPES,
  rotateImageFile,
  uploadAssessmentPassageImage,
  uploadActScienceChoiceImage,
  uploadActScienceQuestionImage,
  uploadActScienceStimulusImage,
} from "../../../services/actScienceChoiceImageService";

export { ACT_SCIENCE_CHOICE_IMAGE_TYPES };
export const rotateImageFileGateway = rotateImageFile;
export const uploadAssessmentPassageImageGateway = uploadAssessmentPassageImage;
export const uploadActScienceChoiceImageGateway = uploadActScienceChoiceImage;
export const uploadActScienceQuestionImageGateway = uploadActScienceQuestionImage;
export const uploadActScienceStimulusImageGateway = uploadActScienceStimulusImage;
