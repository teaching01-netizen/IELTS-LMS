import React from 'react';
import { ExamState, RubricDefinition } from '../../types';
import { Mic, ClipboardList, TimerReset } from 'lucide-react';
import { syncConfigWithStandards } from '../../constants/examDefaults';
import { GradingRubricPanel } from '../scoring/GradingRubricPanel';
import { buildSpeakingRubric, OFFICIAL_SPEAKING_RUBRIC } from '../../utils/builderEnhancements';

const syncSpeakingRubricWeights = (state: ExamState, rubric: RubricDefinition): ExamState => {
  const nextConfig = syncConfigWithStandards({
    ...state.config,
    standards: {
      ...state.config.standards,
      rubricWeights: {
        ...state.config.standards.rubricWeights,
        speaking: {
          fluency:
            rubric.criteria.find((criterion) => criterion.id === 'fluency')?.weight ??
            state.config.standards.rubricWeights.speaking.fluency,
          lexical:
            rubric.criteria.find((criterion) => criterion.id === 'lexical')?.weight ??
            state.config.standards.rubricWeights.speaking.lexical,
          grammar:
            rubric.criteria.find((criterion) => criterion.id === 'grammar')?.weight ??
            state.config.standards.rubricWeights.speaking.grammar,
          pronunciation:
            rubric.criteria.find((criterion) => criterion.id === 'pronunciation')?.weight ??
            state.config.standards.rubricWeights.speaking.pronunciation,
        },
      },
    },
  });

  return {
    ...state,
    config: nextConfig,
    speaking: {
      ...state.speaking,
      rubric: buildSpeakingRubric(nextConfig, rubric),
    },
  };
};

export function SpeakingWorkspace({
  state,
  setState,
}: {
  state: ExamState;
  setState: (state: ExamState) => void;
}) {
  const speakingConfig = state.config.sections.speaking;
  const cueCardDetails = state.speaking.cueCardDetails ?? {
    topic: state.speaking.cueCard,
    bullets: ['', '', '', ''],
    timeAllocation: '1 minute preparation + up to 2 minutes speaking',
    evaluatorNotes: state.speaking.evaluatorNotes ?? '',
  };
  const speakingRubric = buildSpeakingRubric(state.config, state.speaking.rubric ?? OFFICIAL_SPEAKING_RUBRIC);

  return (
    <div className="flex-1 flex overflow-hidden bg-[linear-gradient(180deg,_#fef2f2_0%,_#f8fafc_55%)]">
      <div className="flex-1 overflow-y-auto p-8 flex justify-center no-scrollbar">
        <div className="w-full max-w-5xl space-y-8">
          {speakingConfig.parts.map((part, index) => (
            <div key={part.id} className="bg-white border border-gray-200 rounded-[32px] shadow-sm overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
              <div className="bg-red-50/70 border-b border-red-100 px-8 py-5 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center font-black">
                    {index + 1}
                  </div>
                  <h2 className="font-black text-red-900 uppercase tracking-widest">{part.label}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <span className="bg-white px-3 py-1.5 rounded-full text-[10px] font-black text-red-700 border border-red-200 uppercase tracking-widest flex items-center gap-1">
                    <Mic size={10} /> Live Audio
                  </span>
                </div>
              </div>

              <div className="p-8 space-y-8">
                {index === 0 ? (
                  <div>
                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Topic Areas (Intro)</h3>
                    <div className="grid grid-cols-1 gap-3">
                      {state.speaking.part1Topics.map((topic, i) => (
                        <div key={i} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="w-6 h-6 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-[10px] font-black text-gray-400">{i + 1}</span>
                          <input
                            type="text"
                            value={topic}
                            onChange={(e) => {
                              const newTopics = [...state.speaking.part1Topics];
                              newTopics[i] = e.target.value;
                              setState({ ...state, speaking: { ...state.speaking, part1Topics: newTopics } });
                            }}
                            className="bg-transparent font-bold text-gray-700 outline-none flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : index === 1 ? (
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
                    <div className="space-y-4">
                      <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">Cue Card Builder</h3>
                      <input
                        value={cueCardDetails.topic}
                        onChange={(event) =>
                          setState({
                            ...state,
                            speaking: {
                              ...state.speaking,
                              cueCard: event.target.value,
                              cueCardDetails: { ...cueCardDetails, topic: event.target.value },
                            },
                          })
                        }
                        placeholder="Cue card topic"
                        className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-red-500"
                      />
                      {cueCardDetails.bullets.map((bullet, bulletIndex) => (
                        <input
                          key={bulletIndex}
                          value={bullet}
                          onChange={(event) => {
                            const nextBullets = [...cueCardDetails.bullets];
                            nextBullets[bulletIndex] = event.target.value;
                            setState({
                              ...state,
                              speaking: {
                                ...state.speaking,
                                cueCardDetails: {
                                  ...cueCardDetails,
                                  bullets: nextBullets,
                                },
                              },
                            });
                          }}
                          placeholder={`Bullet point ${bulletIndex + 1}`}
                          className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-red-500"
                        />
                      ))}
                      <div className="grid gap-3 md:grid-cols-2">
                        <input
                          value={cueCardDetails.timeAllocation}
                          onChange={(event) =>
                            setState({
                              ...state,
                              speaking: {
                                ...state.speaking,
                                cueCardDetails: {
                                  ...cueCardDetails,
                                  timeAllocation: event.target.value,
                                },
                              },
                            })
                          }
                          placeholder="Time allocation"
                          className="rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-red-500"
                        />
                        <input
                          value={cueCardDetails.evaluatorNotes}
                          onChange={(event) =>
                            setState({
                              ...state,
                              speaking: {
                                ...state.speaking,
                                evaluatorNotes: event.target.value,
                                cueCardDetails: {
                                  ...cueCardDetails,
                                  evaluatorNotes: event.target.value,
                                },
                              },
                            })
                          }
                          placeholder="Evaluator notes"
                          className="rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-red-500"
                        />
                      </div>
                    </div>

                    <div className="rounded-[32px] border-4 border-gray-900 p-8 bg-yellow-50 shadow-inner">
                      <div className="flex items-center gap-2 text-[10px] font-black text-gray-500 uppercase tracking-[0.24em] mb-4">
                        <TimerReset size={14} /> Exam-style cue card preview
                      </div>
                      <h4 className="text-2xl font-black text-gray-900 leading-tight">{cueCardDetails.topic}</h4>
                      <ul className="mt-5 space-y-3">
                        {cueCardDetails.bullets.filter(Boolean).map((bullet) => (
                          <li key={bullet} className="flex gap-3 text-gray-800 font-medium">
                            <span>•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-6 rounded-2xl bg-white/80 border border-gray-200 px-4 py-3 text-sm text-gray-700">
                        {cueCardDetails.timeAllocation}
                      </div>
                    </div>
                  </div>
                ) : index === 2 ? (
                  <div>
                    <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Discussion Prompts</h3>
                    <div className="space-y-3">
                      {state.speaking.part3Discussion.map((q, i) => (
                        <div key={i} className="flex items-center gap-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Q{i + 1}</span>
                          <input
                            type="text"
                            value={q}
                            onChange={(e) => {
                              const newQs = [...state.speaking.part3Discussion];
                              newQs[i] = e.target.value;
                              setState({ ...state, speaking: { ...state.speaking, part3Discussion: newQs } });
                            }}
                            className="bg-transparent font-bold text-gray-700 outline-none flex-1"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-gray-50">
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Prep Time</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        value={part.prepTime}
                        onChange={(e) => {
                          const newParts = [...speakingConfig.parts];
                          newParts[index] = { ...part, prepTime: Number(e.target.value) };
                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                speaking: { ...speakingConfig, parts: newParts },
                              },
                            },
                          });
                        }}
                        className="bg-transparent font-black text-2xl text-gray-900 w-24 outline-none"
                      />
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Seconds</span>
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Speaking Time</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        value={part.speakingTime}
                        onChange={(e) => {
                          const newParts = [...speakingConfig.parts];
                          newParts[index] = { ...part, speakingTime: Number(e.target.value) };
                          setState({
                            ...state,
                            config: {
                              ...state.config,
                              sections: {
                                ...state.config.sections,
                                speaking: { ...speakingConfig, parts: newParts },
                              },
                            },
                          });
                        }}
                        className="bg-transparent font-black text-2xl text-gray-900 w-24 outline-none"
                      />
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Seconds</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <GradingRubricPanel
              rubric={speakingRubric}
              assessment={[]}
              deviationThreshold={state.config.standards.rubricDeviationThreshold}
              onAssessmentChange={() => {}}
              editableWeights
              onRubricChange={(rubric) => setState(syncSpeakingRubricWeights(state, { ...rubric, custom: true }))}
              title="Speaking Rubric Attachment"
            />

            <div className="bg-gray-900 rounded-[32px] shadow-2xl overflow-hidden text-white border border-white/5">
              <div className="bg-white/5 px-8 py-5 border-b border-white/5">
                <h2 className="font-black flex items-center gap-2 uppercase tracking-widest text-sm">
                  <ClipboardList size={18} className="text-blue-400" /> Examiner Private Workspace
                </h2>
              </div>
              <div className="p-8 space-y-4">
                <input
                  value={speakingRubric.title}
                  onChange={(event) =>
                    setState(
                      syncSpeakingRubricWeights(state, {
                        ...speakingRubric,
                        custom: true,
                        title: event.target.value,
                      }),
                    )
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm text-gray-200 outline-none focus:border-blue-500"
                  placeholder="Institution rubric name"
                />
                <textarea
                  value={state.speaking.evaluatorNotes ?? ''}
                  onChange={(event) =>
                    setState({
                      ...state,
                      speaking: {
                        ...state.speaking,
                        evaluatorNotes: event.target.value,
                        cueCardDetails: {
                          ...cueCardDetails,
                          evaluatorNotes: event.target.value,
                        },
                      },
                    })
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-6 text-sm text-gray-200 h-40 outline-none focus:border-blue-500 transition-all placeholder:text-gray-700"
                  placeholder="Candidate strengths, weaknesses, or observations..."
                />
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
                  <p className="text-[10px] font-black text-gray-500 uppercase tracking-[0.22em] mb-2">
                    Active Criteria
                  </p>
                  <div className="space-y-2 text-sm text-gray-300">
                    {speakingRubric.criteria.map((criterion) => (
                      <div key={criterion.id} className="flex items-center justify-between">
                        <span>{criterion.label}</span>
                        <span className="font-black text-white">{criterion.weight}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
