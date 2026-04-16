import type { Meta, StoryObj } from '@storybook/react-vite';
import { Textarea } from '../components/ui/Textarea';

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
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
    resize: {
      control: 'select',
      options: ['none', 'both', 'horizontal', 'vertical'],
    },
    rows: {
      control: 'number',
    },
  },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    placeholder: 'Enter your text here...',
    rows: 4,
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    rows: 4,
  },
};

export const WithError: Story = {
  args: {
    label: 'Description',
    error: 'Description must be at least 10 characters',
    value: 'Short',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'Description',
    helperText: 'Provide a detailed description of the exam',
    placeholder: 'Enter a description...',
    rows: 4,
  },
};

export const FullWidth: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    fullWidth: true,
    rows: 4,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Description',
    value: 'This is a disabled textarea',
    disabled: true,
    rows: 4,
  },
};

export const Required: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    required: true,
    rows: 4,
  },
};

export const NoResize: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    resize: 'none',
    rows: 4,
  },
};

export const HorizontalResize: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    resize: 'horizontal',
    rows: 4,
  },
};

export const VerticalResize: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    resize: 'vertical',
    rows: 4,
  },
};

export const BothResize: Story = {
  args: {
    label: 'Description',
    placeholder: 'Enter a description...',
    resize: 'both',
    rows: 4,
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 max-w-md">
      <Textarea label="Default" placeholder="Default textarea" rows={3} />
      <Textarea label="With Error" error="This field is required" rows={3} />
      <Textarea label="With Helper" helperText="This is helper text" rows={3} />
      <Textarea label="Disabled" disabled rows={3} />
      <Textarea label="Required" required rows={3} />
    </div>
  ),
};
