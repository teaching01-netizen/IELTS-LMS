import {
  fetchAnswerHistoryExport,
  fetchAnswerHistoryOverviewByAttempt,
  fetchAnswerHistoryOverviewBySubmission,
  fetchAnswerHistoryTargetDetail,
  fetchAnswerHistoryTargetDetailByAttempt,
} from '@services/answerHistoryService';

export const answerHistoryGateway = {
  fetchOverviewBySubmission: fetchAnswerHistoryOverviewBySubmission,
  fetchOverviewByAttempt: fetchAnswerHistoryOverviewByAttempt,
  fetchTargetDetail: fetchAnswerHistoryTargetDetail,
  fetchTargetDetailByAttempt: fetchAnswerHistoryTargetDetailByAttempt,
  fetchExport: fetchAnswerHistoryExport,
};
