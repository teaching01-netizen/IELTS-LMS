import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import "../../../index.css";
import type { SatActivityPolicy } from "../../../shared/sat/learningPolicy";
import { SatFormDialog } from "../ui/ConfirmDialog";
import { SatButton } from "../ui/SatPage";
import {
  SatLearningSettings,
  SatSettingsScopeNote,
  defaultSatClassroomLearningPolicy,
} from "./SatLearningSettings";

function Harness({ examDefaults = false, initial }: {
  examDefaults?: boolean;
  initial?: Partial<SatActivityPolicy>;
}) {
  const [value, setValue] = useState<SatActivityPolicy>({
    ...defaultSatClassroomLearningPolicy(true),
    unlimitedRetakes: true,
    pauseOnLeave: true,
    ...initial,
  });
  return (
    <div className="sat-product min-h-dvh bg-[var(--sat-background,#f5f5f7)] p-6">
      <div className="mx-auto max-w-[520px]">
        <SatLearningSettings examDefaults={examDefaults} value={value} onChange={setValue} />
      </div>
    </div>
  );
}

/** The real room dialog body: scope banner, grouped settings, and footer. */
function DialogHarness({ initial }: { initial?: Partial<SatActivityPolicy> }) {
  const [value, setValue] = useState<SatActivityPolicy>({
    ...defaultSatClassroomLearningPolicy(true),
    unlimitedRetakes: true,
    pauseOnLeave: true,
    ...initial,
  });
  return (
    <SatFormDialog
      open
      bodyScroll
      eyebrow="SAT room"
      title="Results and retakes"
      onClose={() => undefined}
      footer={
        <div className="flex w-full flex-wrap-reverse items-center justify-end gap-2 px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <SatButton variant="quiet">Cancel</SatButton>
          <SatButton variant="primary">Save changes</SatButton>
        </div>
      }
    >
      <div className="grid gap-4 px-5 pb-5">
        <SatSettingsScopeNote scope="room" title="Applies to this room only">
          Students already in this room see changes within a few seconds. An exam-wide save can update
          these fields later.
        </SatSettingsScopeNote>
        <SatLearningSettings heading={false} value={value} onChange={setValue} />
      </div>
    </SatFormDialog>
  );
}

const meta = {
  title: "SAT/Classrooms/Learning settings",
  component: SatLearningSettings,
  parameters: { layout: "fullscreen" },
  args: {
    value: defaultSatClassroomLearningPolicy(true),
    onChange: () => undefined,
  },
} satisfies Meta<typeof SatLearningSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoomDialog: Story = {
  render: () => <DialogHarness />,
};

export const RoomDialogResultsOff: Story = {
  render: () => <DialogHarness initial={{ reportVisible: false, includeAnswerKeyInPdf: false }} />,
};

export const ExamDefaults: Story = {
  render: () => <Harness examDefaults />,
};
