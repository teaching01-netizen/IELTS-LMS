import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookOpen, ChevronRight, Plus, RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';
import { MotionConfig } from 'motion/react';
import { SatMenu } from '../products/sat/ui/Menu';
import {
  SatButton,
  SatContainer,
  SatEmptyState,
  SatField,
  SatIconButton,
  SatInlineError,
  SatList,
  SatListRow,
  SatListSkeleton,
  SatListToolbar,
  SatPageHeader,
  SatResultCount,
  SatSearchField,
  SatSectionCard,
  SatSectionHeader,
  SatStatusPill,
  SatToolbarSelect,
} from '../products/sat/ui/SatPage';
import { SatSegmentedControl } from '../products/sat/ui/SegmentedControl';
import '../index.css';

const meta = {
  title: 'SAT/Staff design system',
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <MotionConfig reducedMotion="user">
        <div className="sat-product sat-staff-root min-h-screen bg-[var(--sat-staff-canvas)]">
          <Story />
        </div>
      </MotionConfig>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const ROOMS = [
  { id: 'morning', name: 'Morning practice', exam: 'Practice Test 06', status: 'live', label: 'Running' },
  { id: 'afternoon', name: 'Afternoon practice', exam: 'Practice Test 06', status: 'ready', label: 'Ready' },
] as const;

const ROOM_FILTERS = [
  { value: 'all', label: 'All rooms', count: ROOMS.length },
  { value: 'live', label: 'Live', count: 1 },
  { value: 'ready', label: 'Ready', count: 1 },
] as const;

const ROOM_SORTS = [
  { value: 'earliest', label: 'Earliest first' },
  { value: 'latest', label: 'Latest first' },
] as const;

function WorkspacePreview() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof ROOM_FILTERS)[number]['value']>('all');
  const [sort, setSort] = useState<(typeof ROOM_SORTS)[number]['value']>('earliest');
  const [currentRoom, setCurrentRoom] = useState<string>();
  const rooms = ROOMS.filter((room) =>
    (filter === 'all' || room.status === filter) &&
    `${room.name} ${room.exam}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  if (sort === 'latest') rooms.reverse();

  return (
    <SatContainer measure="settings">
      <SatPageHeader title="Rooms" description="Find a room and check its exam status." />
      <SatListToolbar tabs={<SatSegmentedControl label="Room status" value={filter} options={ROOM_FILTERS} onChange={setFilter} />}>
        <SatSearchField id="preview-room-search" label="Search rooms" placeholder="Search rooms or exams" value={query} onChange={setQuery} />
        <SatToolbarSelect id="preview-room-sort" label="Sort" value={sort} options={ROOM_SORTS} onChange={setSort} />
      </SatListToolbar>
      {rooms.length > 0 ? (
        <>
          <SatResultCount total={ROOMS.length} visible={rooms.length} itemLabel="rooms" />
          <SatList>
            {rooms.map((room) => (
              <SatListRow key={room.id} onOpen={() => setCurrentRoom(room.id)} current={currentRoom === room.id}>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold">{room.name}</span>
                    <span className="block text-[14px] text-[var(--sat-staff-text-secondary)]">{room.exam}</span>
                  </span>
                  <SatStatusPill tone={room.status}>{room.label}</SatStatusPill>
                  <ChevronRight size={16} className="sat-row-chevron text-slate-400" aria-hidden="true" />
                </span>
              </SatListRow>
            ))}
          </SatList>
        </>
      ) : (
        <SatEmptyState
          icon={<BookOpen size={20} aria-hidden="true" />}
          title="No matching rooms"
          hint="Try a different search or show all rooms."
          action={<SatButton onClick={() => { setQuery(''); setFilter('all'); }}>Clear filters</SatButton>}
        />
      )}
    </SatContainer>
  );
}

export const Workspace: Story = { render: () => <WorkspacePreview /> };

function ControlsPreview() {
  const [layout, setLayout] = useState<'Standard' | 'Compact'>('Standard');

  return (
    <SatContainer measure="settings">
      <SatPageHeader title="Controls" />
      <SatSectionCard labelledBy="preview-actions" className="mt-6 space-y-4">
        <SatSectionHeader id="preview-actions" title="Actions" />
        <div className="flex flex-wrap gap-2">
          <SatButton variant="primary" icon={<Plus size={16} aria-hidden="true" />}>Create room</SatButton>
          <SatButton>Duplicate</SatButton>
          <SatButton variant="quiet">Cancel</SatButton>
          <SatButton variant="danger-secondary">End exam</SatButton>
          <SatButton variant="danger">Confirm end</SatButton>
          <SatButton pending icon={<Save size={16} aria-hidden="true" />}>Saving</SatButton>
          <SatButton disabled>Unavailable</SatButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div>
            <SatMenu label={`Layout: ${layout}`} items={[
              { id: 'standard', label: 'Standard', current: layout === 'Standard', onSelect: () => setLayout('Standard') },
              { id: 'compact', label: 'Compact', current: layout === 'Compact', onSelect: () => setLayout('Compact') },
            ]} />
          </div>
          <SatIconButton label="Reset layout" icon={<RotateCcw size={16} aria-hidden="true" />} onClick={() => setLayout('Standard')} />
        </div>
      </SatSectionCard>
      <SatSectionCard labelledBy="preview-fields" className="mt-4 space-y-4">
        <SatSectionHeader id="preview-fields" title="Fields" />
        <div className="grid gap-4 sm:grid-cols-2">
          <SatField label="Room name" help="Staff see this name in the room list.">
            {(control) => <input {...control} className="sat-input" defaultValue="Morning practice" />}
          </SatField>
          <SatField label="Access code" error="Enter six digits.">
            {(control) => <input {...control} className="sat-input" inputMode="numeric" defaultValue="1234" />}
          </SatField>
        </div>
      </SatSectionCard>
    </SatContainer>
  );
}

export const Controls: Story = { render: () => <ControlsPreview /> };

function FeedbackPreview() {
  const [retrying, setRetrying] = useState(false);

  return (
    <SatContainer measure="settings">
      <SatPageHeader title="Feedback" />
      {retrying ? (
        <SatListSkeleton rows={3} label="Loading rooms" />
      ) : (
        <SatInlineError title="Rooms could not load" description="Try again to refresh the room list." onRetry={() => setRetrying(true)} />
      )}
      <SatEmptyState
        icon={<BookOpen size={20} aria-hidden="true" />}
        title="No exams yet"
        hint="Exams appear here when they are ready to schedule."
      />
    </SatContainer>
  );
}

export const Feedback: Story = { render: () => <FeedbackPreview /> };
