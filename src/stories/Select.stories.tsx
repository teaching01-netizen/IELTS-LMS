import type { Meta, StoryObj } from '@storybook/react-vite';
import { Select } from '../components/ui/Select';

const meta = {
  title: 'UI/Select',
  component: Select,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    disabled: {
      control: 'boolean',
    },
    required: {
      control: 'boolean',
    },
    fullWidth: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof Select>;

const sampleOptions = [
  { value: 'academic', label: 'Academic' },
  { value: 'general', label: 'General Training' },
  { value: 'both', label: 'Both' },
];

export const Default: Story = {
  args: {
    options: sampleOptions,
    placeholder: 'Select an option',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    placeholder: 'Select exam type',
  },
};

export const WithError: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    error: 'Please select an exam type',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    helperText: 'Choose the type of IELTS exam',
  },
};

export const FullWidth: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    fullWidth: true,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    value: 'academic',
    disabled: true,
  },
};

export const Required: Story = {
  args: {
    label: 'Exam Type',
    options: sampleOptions,
    required: true,
  },
};

export const WithDisabledOption: Story = {
  args: {
    label: 'Exam Type',
    options: [
      { value: 'academic', label: 'Academic' },
      { value: 'general', label: 'General Training', disabled: true },
      { value: 'both', label: 'Both' },
    ],
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 max-w-md">
      <Select label="Default" options={sampleOptions} placeholder="Select..." />
      <Select label="With Error" options={sampleOptions} error="This field is required" />
      <Select label="With Helper" options={sampleOptions} helperText="This is helper text" />
      <Select label="Disabled" options={sampleOptions} disabled />
      <Select label="Required" options={sampleOptions} required />
    </div>
  ),
};
