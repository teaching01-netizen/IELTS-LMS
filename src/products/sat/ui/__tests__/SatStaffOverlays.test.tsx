import { useState, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet, SheetContent, SheetTitle } from '../../../../components/ui/sheet';
import { Popover, PopoverContent } from '../../../../components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from '../../../../components/ui/dropdown-menu';
import { SurfaceScopeContext } from '../../../../shared/ui/SurfaceScope';
import { AuthoringDialog, AuthoringConfirmDialog } from '../../../../features/exam-authoring/ui/authoringPrimitives';
import { SatMenu } from '../Menu';

const SCOPE = 'sat-product sat-staff-root';
const scoped = (children: ReactNode) => <SurfaceScopeContext.Provider value={SCOPE}>{children}</SurfaceScopeContext.Provider>;

describe('SAT staff portal interactions', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['sheet', <Sheet open><SheetContent aria-describedby={undefined}><SheetTitle>Settings</SheetTitle></SheetContent></Sheet>, '[data-slot="sheet-content"]', '[data-slot="sheet-overlay"]'],
    ['popover', <Popover open><PopoverContent aria-label="Filters">Filter choices</PopoverContent></Popover>, '[data-slot="popover-content"]', null],
    ['menu', <DropdownMenu open><DropdownMenuContent><DropdownMenuItem>Import</DropdownMenuItem></DropdownMenuContent></DropdownMenu>, '[data-slot="dropdown-menu-content"]', null],
    ['authoring dialog', <AuthoringDialog open title="Preview" onClose={vi.fn()}>Preview content</AuthoringDialog>, '.authoring-dialog-content', '.authoring-dialog-overlay'],
    ['authoring confirmation', <AuthoringConfirmDialog open title="Discard?" description="Unsaved work will be lost." confirmLabel="Discard" onCancel={vi.fn()} onConfirm={vi.fn()} />, '.authoring-confirm-dialog', '.authoring-dialog-overlay'],
  ] as const)('carries staff tokens into a detached %s', (_name, content, selector, overlay) => {
    const { container } = render(scoped(content));
    const surface = document.querySelector(selector);
    expect(surface).toHaveClass('sat-product', 'sat-staff-root');
    expect(container).not.toContainElement(surface as HTMLElement);
    if (overlay) expect(document.querySelector(overlay)).toHaveClass('sat-product', 'sat-staff-root');
  });

  it('does not apply SAT staff styling outside the staff provider', () => {
    render(<Sheet open><SheetContent aria-describedby={undefined}><SheetTitle>General settings</SheetTitle></SheetContent></Sheet>);
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toHaveClass('sat-staff-root');
  });

  it.each(['sheet', 'authoring dialog'] as const)('returns to the menu trigger after closing a %s', async (kind) => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })));
    function Host() {
      const [open, setOpen] = useState(false);
      return scoped(<>
        <SatMenu label="Exam actions" items={[{ id: 'settings', label: 'Settings', onSelect: () => setOpen(true) }]} />
        {kind === 'sheet' ? (
          <Sheet open={open} onOpenChange={setOpen}><SheetContent aria-describedby={undefined}><SheetTitle>Settings</SheetTitle></SheetContent></Sheet>
        ) : <AuthoringDialog open={open} title="Settings" onClose={() => setOpen(false)}><p>Exam settings</p></AuthoringDialog>}
      </>);
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Exam actions' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const item = await screen.findByRole('menuitem', { name: 'Settings' });
    item.focus();
    fireEvent.click(item);
    const dialog = await screen.findByRole('dialog', { name: 'Settings' });
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
