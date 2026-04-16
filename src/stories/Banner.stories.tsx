import type { Meta, StoryObj } from '@storybook/react-vite';
import { Banner } from '../components/ui/Banner';

const meta = {
  title: 'UI/Banner',
  component: Banner,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['success', 'error', 'warning', 'info'],
      description: 'Banner visual style variant',
    },
    showIcon: {
      control: 'boolean',
      description: 'Show icon',
    },
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Success: Story = {
  args: {
    variant: 'success',
    title: 'Success',
    message: 'Your changes have been saved successfully.',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    title: 'Error',
    message: 'Failed to save your changes. Please try again.',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    title: 'Warning',
    message: 'Your session will expire in 5 minutes.',
  },
};

export const Info: Story = {
  args: {
    variant: 'info',
    title: 'Information',
    message: 'New features have been added to the platform.',
  },
};

export const WithoutTitle: Story = {
  args: {
    variant: 'info',
    message: 'Simple message without a title.',
  },
};

export const WithoutIcon: Story = {
  args: {
    variant: 'success',
    title: 'Success',
    message: 'Your changes have been saved successfully.',
    showIcon: false,
  },
};

export const Dismissible: Story = {
  args: {
    variant: 'info',
    title: 'Dismissible',
    message: 'Click the X to dismiss this banner.',
    onDismiss: () => {},
  },
};

export const AllVariants: Story = {
  args: {
    variant: 'info',
    title: 'All Variants',
    message: 'See render for all variants',
  },
  render: () => (
    <div className="flex flex-col gap-4 max-w-2xl">
      <Banner variant="success" title="Success" message="Operation completed successfully" />
      <Banner variant="error" title="Error" message="Something went wrong" />
      <Banner variant="warning" title="Warning" message="Please review your inputs" />
      <Banner variant="info" title="Info" message="Additional information" />
    </div>
  ),
};
