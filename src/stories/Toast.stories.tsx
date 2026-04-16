import type { Meta, StoryObj } from '@storybook/react-vite';
import { Toast, ToastContainer } from '../components/ui/Toast';
import { useState } from 'react';

const meta = {
  title: 'UI/Toast',
  component: Toast,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['success', 'error', 'warning', 'info'],
      description: 'Toast visual style variant',
    },
    duration: {
      control: 'number',
      description: 'Auto-dismiss duration in milliseconds (0 for no auto-dismiss)',
    },
    showCloseButton: {
      control: 'boolean',
      description: 'Show close button',
    },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    variant: 'success',
    title: 'Success',
    message: 'Your changes have been saved successfully.',
    onClose: () => {},
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    title: 'Error',
    message: 'Failed to save your changes. Please try again.',
    onClose: () => {},
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    title: 'Warning',
    message: 'Your session will expire in 5 minutes.',
    onClose: () => {},
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    title: 'Information',
    message: 'New features have been added to the platform.',
    onClose: () => {},
  },
};

export const WithoutTitle: Story = {
  args: {
    variant: 'info',
    message: 'Simple message without a title.',
    onClose: () => {},
  },
};

export const NoAutoDismiss: Story = {
  args: {
    variant: 'info',
    title: 'Persistent',
    message: 'This toast will not auto-dismiss.',
    duration: 0,
    onClose: () => {},
  },
};

export const WithoutCloseButton: Story = {
  args: {
    variant: 'success',
    title: 'Auto-dismiss only',
    message: 'This toast will auto-dismiss without close button.',
    showCloseButton: false,
    onClose: () => {},
  },
};

export const MultipleToasts: Story = {
  args: {
    variant: 'info',
    title: 'Multiple',
    message: 'See render for multiple toasts',
    onClose: () => {},
  },
  render: () => {
    const [toasts, setToasts] = useState([
      { id: '1', variant: 'success' as const, title: 'Success', message: 'Item created' },
      { id: '2', variant: 'warning' as const, title: 'Warning', message: 'Check your inputs' },
      { id: '3', variant: 'info' as const, title: 'Info', message: 'New update available' },
    ]);

    return (
      <ToastContainer position="top-right">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            variant={toast.variant}
            title={toast.title}
            message={toast.message}
            onClose={() => setToasts(toasts.filter(t => t.id !== toast.id))}
          />
        ))}
      </ToastContainer>
    );
  },
};
