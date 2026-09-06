import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LISTENING_BAND_TABLE,
  DEFAULT_READING_ACADEMIC_BAND_TABLE,
  DEFAULT_READING_GT_BAND_TABLE,
  createDefaultConfig,
} from '../../../../constants/examDefaults';
import type { ExamConfig } from '../../../../types';
import { StandardsTab } from '../StandardsTab';

// BandScoreMatrix pulls in jspdf and renders 41 editable rows per table.
// Stub it so these tests focus on StandardsTab wiring, while still
// exercising the onChange callback each matrix receives.
vi.mock('../../../../components/scoring/BandScoreMatrix', () => ({
  BandScoreMatrix: ({
    moduleLabel,
    table,
    onChange,
  }: {
    moduleLabel: string;
    table: Record<number, number>;
    onChange: (table: Record<number, number>) => void;
  }) => (
    <div data-testid={'band-matrix-' + moduleLabel}>
      <span>{moduleLabel} Conversion</span>
      <button type="button" onClick={() => onChange({ ...table, 39: 5 })}>
        Change {moduleLabel}
      </button>
    </div>
  ),
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

const setup = (mutate?: (config: ExamConfig) => void) => {
  const config = createDefaultConfig('Academic', 'Academic');
  mutate?.(config);
  const onChange = vi.fn();
  const rendered = render(<StandardsTab config={config} onChange={onChange} />);
  return { config, onChange, ...rendered };
};

const getFileInput = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]');
  if (!input) throw new Error('band table file input not found');
  return input as HTMLInputElement;
};

const setInputFiles = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

// jsdom File lacks .text(), so stub it per-file for deterministic imports.
const makeJsonFile = (name: string, content: string, type = 'application/json') => {
  const file = new File([content], name, { type });
  Object.defineProperty(file, 'text', {
    value: () => Promise.resolve(content),
    configurable: true,
  });
  return file;
};

const validBandTablesJson = () =>
  JSON.stringify({
    listening: DEFAULT_LISTENING_BAND_TABLE,
    readingAcademic: DEFAULT_READING_ACADEMIC_BAND_TABLE,
    readingGeneralTraining: DEFAULT_READING_GT_BAND_TABLE,
  });

describe('StandardsTab', () => {
  it('renders all key section headings and controls', () => {
    setup();

    expect(screen.getByText(/passage word count validation/i)).toBeInTheDocument();
    expect(screen.getByText(/writing task requirements/i)).toBeInTheDocument();
    expect(screen.getByText(/rubric settings/i)).toBeInTheDocument();
    expect(screen.getByText(/band score conversion tables/i)).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /reset to official ielts standards/i }),
    ).toBeInTheDocument();

    expect(screen.getByTestId('band-matrix-Listening')).toBeInTheDocument();
    expect(screen.getByTestId('band-matrix-Reading Academic')).toBeInTheDocument();
    expect(screen.getByTestId('band-matrix-Reading General Training')).toBeInTheDocument();
  });

  it('renders passage word count inputs with current config values', () => {
    setup();

    expect(screen.getByLabelText('Optimal Min')).toHaveValue(700);
    expect(screen.getByLabelText('Optimal Max')).toHaveValue(1000);
    expect(screen.getByLabelText('Warning Min')).toHaveValue(500);
    expect(screen.getByLabelText('Warning Max')).toHaveValue(1200);
  });

  it('renders writing task requirement inputs with current config values', () => {
    setup();

    expect(screen.getByLabelText('Task 1 minimum words')).toHaveValue(150);
    expect(screen.getByLabelText('Task 1 recommended time')).toHaveValue(20);
    expect(screen.getByLabelText('Task 2 minimum words')).toHaveValue(250);
    expect(screen.getByLabelText('Task 2 recommended time')).toHaveValue(40);
  });

  it('renders rubric threshold and weight inputs with current config values', () => {
    setup();

    expect(screen.getByLabelText('Rubric deviation threshold')).toHaveValue(10);
    expect(screen.getByLabelText('Writing taskResponse weight')).toHaveValue(25);
    expect(screen.getByLabelText('Writing coherence weight')).toHaveValue(25);
    expect(screen.getByLabelText('Speaking fluency weight')).toHaveValue(25);
    expect(screen.getByLabelText('Speaking pronunciation weight')).toHaveValue(25);
  });

  it('renders the color preview with the warning range', () => {
    setup();

    expect(screen.getByText('Color Preview')).toBeInTheDocument();
    expect(screen.getByText('500-1200 words')).toBeInTheDocument();
  });

  it('updates passage word count via onChange', () => {
    const { onChange } = setup();

    fireEvent.change(screen.getByLabelText('Optimal Min'), { target: { value: '800' } });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          passageWordCount: expect.objectContaining({ optimalMin: 800 }),
        }),
      }),
    );
  });

  it('updates writing task standards via onChange', () => {
    const { onChange } = setup();

    fireEvent.change(screen.getByLabelText('Task 1 minimum words'), {
      target: { value: '160' },
    });
    fireEvent.change(screen.getByLabelText('Task 2 recommended time'), {
      target: { value: '45' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          writingTasks: expect.objectContaining({
            task1: expect.objectContaining({ minWords: 160 }),
          }),
        }),
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          writingTasks: expect.objectContaining({
            task2: expect.objectContaining({ recommendedTime: 45 }),
          }),
        }),
      }),
    );
  });

  it('updates the rubric deviation threshold via onChange', () => {
    const { onChange } = setup();

    fireEvent.change(screen.getByLabelText('Rubric deviation threshold'), {
      target: { value: '15' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({ rubricDeviationThreshold: 15 }),
      }),
    );
  });

  it('updates writing and speaking rubric weights via onChange', () => {
    const { onChange } = setup();

    fireEvent.change(screen.getByLabelText('Writing taskResponse weight'), {
      target: { value: '30' },
    });
    fireEvent.change(screen.getByLabelText('Speaking fluency weight'), {
      target: { value: '40' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          rubricWeights: expect.objectContaining({
            writing: expect.objectContaining({ taskResponse: 30 }),
          }),
        }),
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          rubricWeights: expect.objectContaining({
            speaking: expect.objectContaining({ fluency: 40 }),
          }),
        }),
      }),
    );
  });

  it('propagates band matrix changes via onChange', () => {
    const { onChange } = setup();

    fireEvent.click(screen.getByRole('button', { name: 'Change Listening' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change Reading Academic' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          bandScoreTables: expect.objectContaining({
            listening: expect.objectContaining({ 39: 5 }),
          }),
        }),
      }),
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          bandScoreTables: expect.objectContaining({
            readingAcademic: expect.objectContaining({ 39: 5 }),
          }),
        }),
      }),
    );
  });

  it('exports band tables to a JSON download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const anchors: HTMLAnchorElement[] = [];
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = vi.spyOn(document, 'createElement');
    createElementSpy.mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName === 'a') anchors.push(element as HTMLAnchorElement);
      return element;
    }) as typeof document.createElement);
    setup();

    fireEvent.click(screen.getByRole('button', { name: /export/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const exportedText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('blob read failed'));
      reader.readAsText(blob);
    });
    const exported = JSON.parse(exportedText);
    expect(exported.listening).toBeDefined();
    expect(exported.readingAcademic).toBeDefined();
    expect(exported.readingGeneralTraining).toBeDefined();
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe('blob:mock-url');
    expect(anchors[0].download.endsWith('band-tables.json')).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('resets band tables to official IELTS standards and clears import errors', async () => {
    const { container, onChange } = setup();
    setInputFiles(getFileInput(container), []);
    expect(await screen.findByText('Select a band table JSON file to import.')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /reset to official ielts standards/i }),
    );

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          bandScoreTables: {
            listening: DEFAULT_LISTENING_BAND_TABLE,
            readingAcademic: DEFAULT_READING_ACADEMIC_BAND_TABLE,
            readingGeneralTraining: DEFAULT_READING_GT_BAND_TABLE,
          },
        }),
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByText('Select a band table JSON file to import.'),
      ).not.toBeInTheDocument(),
    );
  });

  it('shows passage word count validation errors for invalid ranges', () => {
    setup((config) => {
      config.standards.passageWordCount = {
        optimalMin: 1000,
        optimalMax: 700,
        warningMin: 500,
        warningMax: 1200,
      };
    });

    expect(
      screen.getByText('Optimal minimum must be less than optimal maximum.'),
    ).toBeInTheDocument();
  });

  it('shows rubric weight validation errors when weights do not sum to 100', () => {
    setup((config) => {
      config.standards.rubricWeights.writing = {
        taskResponse: 50,
        coherence: 25,
        lexical: 25,
        grammar: 25,
      };
    });

    expect(screen.getByText('Rubric weights must sum to 100.')).toBeInTheDocument();
  });

  it('shows band score table validation errors for invalid tables', () => {
    setup((config) => {
      config.standards.bandScoreTables.listening = { 39: 15 };
    });

    expect(
      screen.getByText(/band scores must be between 0 and 9 in 0.5 increments./i),
    ).toBeInTheDocument();
  });

  it('shows above-threshold badges only when rubric deviation is high', () => {
    const first = setup();
    expect(first.queryByText('Above threshold')).not.toBeInTheDocument();
    first.unmount();

    setup((config) => {
      config.standards.rubricWeights.writing = {
        taskResponse: 50,
        coherence: 25,
        lexical: 25,
        grammar: 25,
      };
    });

    expect(screen.getAllByText('Above threshold')).toHaveLength(1);
  });

  it('shows an error when no file is selected for import', async () => {
    const { container, onChange } = setup();

    setInputFiles(getFileInput(container), []);

    expect(
      await screen.findByText('Select a band table JSON file to import.'),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects non-JSON file imports', async () => {
    const { container, onChange } = setup();
    const file = new File(['{}'], 'bands.txt', { type: 'text/plain' });

    setInputFiles(getFileInput(container), [file]);

    expect(
      await screen.findByText('Band table import must be a .json file.'),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON imports', async () => {
    const { container, onChange } = setup();
    const file = makeJsonFile('bands.json', '{not valid json');

    setInputFiles(getFileInput(container), [file]);

    expect(await screen.findByText('Invalid band table JSON file.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects imports that fail band table validation', async () => {
    const { container, onChange } = setup();
    const payload = JSON.stringify({
      listening: { 39: 15 },
      readingAcademic: DEFAULT_READING_ACADEMIC_BAND_TABLE,
      readingGeneralTraining: DEFAULT_READING_GT_BAND_TABLE,
    });
    const file = makeJsonFile('bands.json', payload);

    setInputFiles(getFileInput(container), [file]);

    expect(
      await screen.findByText('Band scores must be between 0 and 9 in 0.5 increments.'),
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('imports valid band tables and calls onChange', async () => {
    const { container, onChange } = setup();
    const file = makeJsonFile('bands.json', validBandTablesJson());

    setInputFiles(getFileInput(container), [file]);

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        standards: expect.objectContaining({
          bandScoreTables: expect.objectContaining({
            listening: expect.objectContaining({ 39: 9 }),
            readingAcademic: expect.objectContaining({ 39: 9 }),
            readingGeneralTraining: expect.objectContaining({ 40: 9 }),
          }),
        }),
      }),
    );
    expect(screen.queryByText('Invalid band table JSON file.')).not.toBeInTheDocument();
  });
});
