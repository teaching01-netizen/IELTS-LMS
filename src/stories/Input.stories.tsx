import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search, Mail, Lock, AlertCircle } from 'lucide-react';
import { Input } from '../components/ui/Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['text', 'email', 'password', 'number', 'tel', 'url'],
    },
    placeholder: {
      control: 'text',
    },
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
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    placeholder: 'Enter text...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Email Address',
    type: 'email',
    placeholder: 'you@example.com',
  },
};

export const WithError: Story = {
  args: {
    label: 'Password',
    type: 'password',
    error: 'Password must be at least 8 characters',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'Username',
    helperText: 'Choose a unique username for your account',
    placeholder: 'Enter username',
  },
};

export const WithLeftIcon: Story = {
  args: {
    label: 'Search',
    placeholder: 'Search exams...',
    leftIcon: <Search size={16} />,
  },
};

export const WithRightIcon: Story = {
  args: {
    label: 'Email',
    type: 'email',
    placeholder: 'you@example.com',
    rightIcon: <Mail size={16} />,
  },
};

export const WithBothIcons: Story = {
  args: {
    label: 'Password',
    type: 'password',
    placeholder: 'Enter password',
    leftIcon: <Lock size={16} />,
    rightIcon: <AlertCircle size={16} />,
  },
};

export const FullWidth: Story = {
  args: {
    label: 'Full Name',
    placeholder: 'Enter your full name',
    fullWidth: true,
  },
};

export const Disabled: Story = {
  args: {
    label: 'Email',
    type: 'email',
    value: 'disabled@example.com',
    disabled: true,
  },
};

export const Required: Story = {
  args: {
    label: 'Phone Number',
    type: 'tel',
    placeholder: '(555) 123-4567',
    required: true,
  },
};

export const AllStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6 max-w-md">
      <Input label="Default" placeholder="Default input" />
      <Input label="With Error" error="This field is required" />
      <Input label="With Helper" helperText="This is helper text" />
      <Input label="Disabled" disabled />
      <Input label="Required" required />
    </div>
  ),
};
