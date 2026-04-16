import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataTable } from '../components/ui/DataTable';
import type { Column } from '../components/ui/DataTable';

interface ExamData {
  id: string;
  title: string;
  type: string;
  status: string;
  author: string;
  lastModified: string;
}

const meta = {
  title: 'UI/DataTable',
  component: DataTable,
  parameters: {
    layout: 'padded',
  },
  tags: ['autodocs'],
  argTypes: {
    isLoading: {
      control: 'boolean',
      description: 'Show loading state',
    },
    emptyMessage: {
      control: 'text',
      description: 'Message to show when no data',
    },
  },
} satisfies Meta<typeof DataTable<ExamData>>;

export default meta;
type Story = StoryObj<typeof DataTable<ExamData>>;

const sampleData: ExamData[] = [
  { id: '1', title: 'IELTS Academic Practice Test 1', type: 'Academic', status: 'Published', author: 'Sarah Chen', lastModified: '2024-01-15' },
  { id: '2', title: 'IELTS General Training Mock', type: 'General Training', status: 'Draft', author: 'John Smith', lastModified: '2024-01-14' },
  { id: '3', title: 'Speaking Practice Set A', type: 'Academic', status: 'Published', author: 'Sarah Chen', lastModified: '2024-01-13' },
  { id: '4', title: 'Writing Task 2 Collection', type: 'Academic', status: 'Archived', author: 'Mike Johnson', lastModified: '2024-01-10' },
  { id: '5', title: 'Listening Section 1 Practice', type: 'General Training', status: 'Published', author: 'Emily Brown', lastModified: '2024-01-08' },
];

const columns: Column<ExamData>[] = [
  { key: 'title', header: 'Title' },
  { key: 'type', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'author', header: 'Author' },
  { key: 'lastModified', header: 'Last Modified' },
];

const columnsWithRender: Column<ExamData>[] = [
  { key: 'title', header: 'Title' },
  { key: 'type', header: 'Type' },
  {
    key: 'status',
    header: 'Status',
    render: (value: string) => {
      const colors: Record<string, string> = {
        Published: 'text-green-700',
        Draft: 'text-blue-700',
        Archived: 'text-gray-500',
      };
      return <span className={`font-medium ${colors[value] || ''}`}>{value}</span>;
    },
  },
  { key: 'author', header: 'Author' },
  { key: 'lastModified', header: 'Last Modified' },
];

export const Default: Story = {
  args: {
    columns,
    data: sampleData,
  },
};

export const WithRowClick: Story = {
  args: {
    columns,
    data: sampleData,
    onRowClick: (row) => alert(`Clicked: ${row.title}`),
  },
};

export const WithCustomRender: Story = {
  args: {
    columns: columnsWithRender,
    data: sampleData,
  },
};

export const Empty: Story = {
  args: {
    columns,
    data: [],
    emptyMessage: 'No exams found',
  },
};

export const Loading: Story = {
  args: {
    columns,
    data: [],
    isLoading: true,
  },
};

export const SingleRow: Story = {
  args: {
    columns,
    data: [sampleData[0]],
  },
};

export const ManyRows: Story = {
  args: {
    columns,
    data: Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      title: `Exam ${i + 1}`,
      type: i % 2 === 0 ? 'Academic' : 'General Training',
      status: i % 3 === 0 ? 'Published' : i % 3 === 1 ? 'Draft' : 'Archived',
      author: `Author ${i}`,
      lastModified: `2024-01-${String((i % 30) + 1).padStart(2, '0')}`,
    })),
  },
};
