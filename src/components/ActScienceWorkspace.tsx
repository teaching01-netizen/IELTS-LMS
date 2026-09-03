import React, { useEffect, useMemo } from 'react';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { ActScienceStimulus, ExamState } from '../types';
import { createId } from '../utils/idUtils';
import { getBlockQuestionCount } from '../utils/examUtils';
import { StimulusPane } from './StimulusPane';
import {
  ActScienceQuestionBuilderPane,
  createActScienceBlock,
} from './ActScienceQuestionBuilderPane';

type ExamStateUpdate = ExamState | ((previous: ExamState) => ExamState);

export interface ActScienceWorkspaceProps {
  state: ExamState;
  setState: (next: ExamStateUpdate) => void | Promise<void>;
}

function createActScienceStimulus(index: number): ActScienceStimulus {
  return {
    id: createId('act_stimulus'),
    title: `Stimulus ${index}`,
    content: '',
    blocks: [createActScienceBlock()],
    images: [],
    wordCount: 0,
  };
}

export function ActScienceWorkspace({ state, setState }: ActScienceWorkspaceProps) {
  const stimuli = state.science.stimuli;
  const activeStimulus = stimuli.find((stimulus) => stimulus.id === state.activeScienceStimulusId);

  useEffect(() => {
    if (stimuli.length === 0 || activeStimulus) {
      return;
    }

    const firstStimulus = stimuli[0];
    if (firstStimulus) {
      void setState((previous) => ({
        ...previous,
        activeScienceStimulusId: firstStimulus.id,
      }));
    }
  }, [activeStimulus, setState, stimuli]);

  const totalQuestions = useMemo(
    () => stimuli.reduce(
      (total, stimulus) => total + stimulus.blocks.reduce(
        (blockTotal, block) => blockTotal + getBlockQuestionCount(block),
        0,
      ),
      0,
    ),
    [stimuli],
  );

  const activeStartNumber = activeStimulus
    ? stimuli.slice(0, stimuli.findIndex((stimulus) => stimulus.id === activeStimulus.id)).reduce(
      (total, stimulus) => total + stimulus.blocks.reduce(
        (blockTotal, block) => blockTotal + getBlockQuestionCount(block),
        0,
      ),
      1,
    )
    : 1;

  const addStimulus = () => {
    void setState((previous) => {
      const nextStimulus = createActScienceStimulus(previous.science.stimuli.length + 1);
      return {
        ...previous,
        science: {
          ...previous.science,
          stimuli: [...previous.science.stimuli, nextStimulus],
        },
        activeScienceStimulusId: nextStimulus.id,
      };
    });
  };

  const selectStimulus = (stimulusId: string) => {
    void setState((previous) => ({
      ...previous,
      activeScienceStimulusId: stimulusId,
    }));
  };

  const deleteStimulus = (stimulusId: string) => {
    void setState((previous) => {
      const nextStimuli = previous.science.stimuli.filter((stimulus) => stimulus.id !== stimulusId);
      const nextActiveId = previous.activeScienceStimulusId === stimulusId
        ? nextStimuli[0]?.id ?? ''
        : previous.activeScienceStimulusId;
      return {
        ...previous,
        science: { ...previous.science, stimuli: nextStimuli },
        activeScienceStimulusId: nextActiveId,
      };
    });
  };

  const updateStimulus = (nextStimulus: ActScienceStimulus) => {
    void setState((previous) => ({
      ...previous,
      science: {
        ...previous.science,
        stimuli: previous.science.stimuli.map((stimulus) =>
          stimulus.id === nextStimulus.id ? nextStimulus : stimulus,
        ),
      },
    }));
  };

  if (!activeStimulus) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-50 p-8">
        <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 text-center shadow-sm">
          <FlaskConical className="mx-auto mb-3 text-blue-600" size={30} />
          <h2 className="text-lg font-bold text-gray-900">ACT Science</h2>
          <p className="mt-2 text-sm text-gray-600">No ACT Science stimuli yet.</p>
          <button
            type="button"
            onClick={addStimulus}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            aria-label="Add Stimulus"
          >
            <Plus size={16} /> Add Stimulus
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden bg-gray-50">
      <aside className="w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3">
        <div className="mb-3 flex items-center justify-between px-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">ACT Science</p>
            <h2 className="text-sm font-bold text-gray-900">Stimuli ({stimuli.length})</h2>
          </div>
          <button
            type="button"
            onClick={addStimulus}
            className="rounded-md p-1.5 text-blue-600 hover:bg-blue-50"
            aria-label="Add Stimulus"
            title="Add Stimulus"
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="space-y-2">
          {stimuli.map((stimulus, index) => (
            <div
              key={stimulus.id}
              className={`flex items-center gap-2 rounded-lg border p-2 ${
                stimulus.id === activeStimulus.id
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <button
                type="button"
                onClick={() => selectStimulus(stimulus.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-semibold text-gray-900">
                  {index + 1}. {stimulus.title || `Stimulus ${index + 1}`}
                </span>
                <span className="block text-xs text-gray-500">
                  {stimulus.blocks.reduce((total, block) => total + getBlockQuestionCount(block), 0)} questions
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteStimulus(stimulus.id)}
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                aria-label={`Delete ${stimulus.title || `Stimulus ${index + 1}`}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-5 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
          <p className="font-semibold text-gray-800">Total questions: {totalQuestions}/40</p>
          <p className="mt-1">Drafts may be incomplete. Publish will show a warning when the count is not 40.</p>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col border-r border-gray-200">
        <div className="border-b border-gray-200 bg-white px-5 py-3">
          <label className="mb-1 block text-xs font-semibold text-gray-600" htmlFor="act-stimulus-title">
            Stimulus title
          </label>
          <input
            id="act-stimulus-title"
            type="text"
            value={activeStimulus.title}
            onChange={(event) => updateStimulus({ ...activeStimulus, title: event.target.value })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="min-h-0 flex-1">
          <StimulusPane
            passage={activeStimulus}
            state={state}
            setState={setState}
            section="science"
          />
        </div>
      </section>

      <aside className="w-[480px] min-w-[400px] shrink-0">
        <ActScienceQuestionBuilderPane
          stimulus={activeStimulus}
          startNumber={activeStartNumber}
          onChange={updateStimulus}
        />
      </aside>
    </div>
  );
}
