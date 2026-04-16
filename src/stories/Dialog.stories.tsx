import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';

const meta = {
  title: 'UI/Dialog',
  component: Dialog,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    isOpen: {
      control: 'boolean',
      description: 'Controls dialog visibility',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl', 'full'],
      description: 'Dialog size',
    },
    showCloseButton: {
      control: 'boolean',
      description: 'Show X button in header',
    },
    preventCloseOnOverlayClick: {
      control: 'boolean',
      description: 'Prevent closing when clicking overlay',
    },
    closeOnEscape: {
      control: 'boolean',
      description: 'Close on Escape key press',
    },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Open Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)}>
          <p>This is a default dialog with no title.</p>
        </Dialog>
      </>
    );
  },
};

export const WithTitle: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Open Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Dialog Title">
          <p>This dialog has a title and close button.</p>
        </Dialog>
      </>
    );
  },
};

export const WithFooter: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Open Dialog</Button>
        <Dialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Confirm Action"
          footer={
            <>
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => setIsOpen(false)}>
                Confirm
              </Button>
            </>
          }
        >
          <p>Are you sure you want to proceed with this action?</p>
        </Dialog>
      </>
    );
  },
};

export const Small: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Small Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Small" size="sm">
          <p>This is a small dialog.</p>
        </Dialog>
      </>
    );
  },
};

export const Large: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Large Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Large" size="lg">
          <p>This is a large dialog with more space for content.</p>
          <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit.</p>
        </Dialog>
      </>
    );
  },
};

export const FullWidth: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Full Width Dialog</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Full Width" size="full">
          <p>This is a full-width dialog that takes up maximum space.</p>
        </Dialog>
      </>
    );
  },
};

export const NoCloseButton: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>No Close Button</Button>
        <Dialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="No X Button"
          showCloseButton={false}
          footer={
            <Button variant="primary" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          }
        >
          <p>This dialog has no close button in the header.</p>
        </Dialog>
      </>
    );
  },
};

export const PreventOverlayClose: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Prevent Overlay Close</Button>
        <Dialog
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Must Use Button"
          preventCloseOnOverlayClick
          footer={
            <Button variant="primary" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          }
        >
          <p>Clicking the overlay won't close this dialog. Use the button instead.</p>
        </Dialog>
      </>
    );
  },
};

export const LongContent: Story = {
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setIsOpen(true)}>Long Content</Button>
        <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Scrollable Content">
          {Array.from({ length: 30 }).map((_, i) => (
            <p key={i}>Line {i + 1}: Lorem ipsum dolor sit amet.</p>
          ))}
        </Dialog>
      </>
    );
  },
};
