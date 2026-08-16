import { examDeliveryService } from '../../../services/examDeliveryService';
import { examRepository } from '../../../services/examRepository';

export const schedulingGateway = {
  repository: {
    getAllSchedules: () => examRepository.getAllSchedules(),
    getVersionById: (versionId: string) => examRepository.getVersionById(versionId),
    saveSchedule: (schedule: Parameters<typeof examRepository.saveSchedule>[0]) =>
      examRepository.saveSchedule(schedule),
    deleteSchedule: (scheduleId: string) => examRepository.deleteSchedule(scheduleId),
  },
  delivery: {
    resolveScheduleWindow: (options: Parameters<typeof examDeliveryService.resolveProctorStartScheduleWindow>[0]) =>
      examDeliveryService.resolveProctorStartScheduleWindow(options),
    getPlannedDuration: (config: Parameters<typeof examDeliveryService.buildSectionPlan>[0]) =>
      examDeliveryService.buildSectionPlan(config).plannedDurationMinutes,
    startRuntime: (scheduleId: string, actor: string) =>
      examDeliveryService.startRuntime(scheduleId, actor),
  },
};
