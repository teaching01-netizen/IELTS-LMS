import { normalizeExamConfig } from '../constants/examDefaults';
import type {
  ClozeBlock,
  ExamState,
  ListeningPart,
  MatchingBlock,
  MatchingFeaturesBlock,
  MultiMCQBlock,
  NoteCompletionBlock,
  Passage,
  SentenceCompletionBlock,
  ShortAnswerBlock,
  SingleMCQBlock,
  TFNGBlock,
  WritingChartData,
  WritingTaskContent,
} from '../types';
import { buildWritingRubric, countWords, OFFICIAL_WRITING_RUBRIC } from './builderEnhancements';

type IdParts = {
  prefix: string;
  segment: string;
  index: number;
};

function makeId({ prefix, segment, index }: IdParts) {
  return `${prefix}-${segment}-${index}`;
}

function buildAcademicReadingPassages(): Passage[] {
  const passage1Content = `
<h2>Cool Roofs and Hot Cities</h2>
<p><strong>A</strong> Cities concentrate people, buildings, and roads in a relatively small area. The same compactness that supports efficient transport and commerce also changes the local climate. Compared with nearby rural land, urban districts often remain several degrees warmer at night, a pattern known as the urban heat island effect. The main driver is not simply the amount of sunshine cities receive, but what happens to that energy after it arrives.</p>
<p><strong>B</strong> Dark surfaces such as asphalt absorb solar radiation and store it as heat. During the day, that heat accumulates in roofs and pavements; at night it is released slowly, keeping air temperatures elevated. Tall buildings add another influence by reducing airflow and trapping warm air between streets. Meanwhile, vegetation that would normally cool the air through evaporation is replaced with materials that do not transpire.</p>
<p><strong>C</strong> Heat islands carry practical consequences. In hot periods, households and businesses increase air-conditioning use, raising electricity demand precisely when grids are under stress. Higher demand can increase costs and, if power generation relies on fossil fuels, can raise emissions. Heat also influences health: prolonged warm nights can reduce the body’s ability to recover from daytime heat, and the burden falls disproportionately on older adults and people without access to cooled indoor space.</p>
<p><strong>D</strong> One widely discussed response is the “cool roof”: a roof surface designed to reflect more sunlight and emit heat more efficiently. This can be achieved by using light-coloured materials, reflective coatings, or membranes with high solar reflectance. By limiting the amount of energy absorbed, a cool roof lowers the roof temperature, which in turn can reduce the heat transmitted into the building below.</p>
<p><strong>E</strong> However, the benefits are not identical across all climates. In regions with cold winters, a roof that reflects heat in summer may also reduce beneficial solar warming in winter, potentially increasing heating demand. The balance depends on building insulation, energy prices, and whether the roof is part of a broader strategy that includes shading, ventilation, and urban greenery. For this reason, some planners consider adjustable or “seasonal” approaches, while others focus on high-impact zones such as schools and clinics.</p>
<p><strong>F</strong> Researchers increasingly evaluate cool roofs alongside other measures like street trees, permeable pavements, and reflective roads. Each option has trade-offs: trees provide shade and improve air quality but require water and maintenance; reflective roads can reduce surface temperatures but may increase glare. The most effective urban plans tend to combine interventions, targeting neighbourhoods where heat risk and social vulnerability overlap.</p>
<p><strong>G</strong> Cool roofs are therefore less a single technology than a design principle: in hot periods, send more incoming energy back to the sky and release stored heat more quickly. When applied thoughtfully—with attention to climate, housing quality, and equity—they can reduce indoor temperatures, smooth electricity demand, and help cities remain safer as heat waves become more frequent.</p>
`.trim();

  const passage1Matching: MatchingBlock = {
    id: 'r1-matching-1',
    type: 'MATCHING',
    instruction: 'Choose the correct heading for paragraphs A-E from the list of headings below.',
    headings: [
      { id: 'r1-h-1', text: 'Why urban areas stay warm after sunset' },
      { id: 'r1-h-2', text: 'Health and energy consequences of higher night temperatures' },
      { id: 'r1-h-3', text: 'A roof design that reflects and releases heat' },
      { id: 'r1-h-4', text: 'Why the same solution performs differently by climate' },
      { id: 'r1-h-5', text: 'Combining multiple cooling measures in one plan' },
      { id: 'r1-h-6', text: 'A definition of air-conditioning efficiency standards' },
      { id: 'r1-h-7', text: 'How to measure rainfall in dense neighbourhoods' },
    ],
    questions: [
      { id: 'r1-mq-1', paragraphLabel: 'A', correctHeading: 'i' },
      { id: 'r1-mq-2', paragraphLabel: 'B', correctHeading: 'i' },
      { id: 'r1-mq-3', paragraphLabel: 'C', correctHeading: 'ii' },
      { id: 'r1-mq-4', paragraphLabel: 'D', correctHeading: 'iii' },
      { id: 'r1-mq-5', paragraphLabel: 'E', correctHeading: 'iv' },
    ],
  };

  const passage1Tfng: TFNGBlock = {
    id: 'r1-tfng-1',
    type: 'TFNG',
    instruction: 'Do the following statements agree with the information in the passage? Write TRUE, FALSE or NOT GIVEN.',
    mode: 'TFNG',
    questions: [
      {
        id: 'r1-t-1',
        statement: 'Urban heat islands are mainly caused by cities receiving more sunlight than rural areas.',
        correctAnswer: 'NG',
      },
      {
        id: 'r1-t-2',
        statement: 'Reduced airflow between tall buildings can contribute to higher temperatures in cities.',
        correctAnswer: 'T',
      },
      {
        id: 'r1-t-3',
        statement: 'Cool roofs always reduce a building’s total annual energy use in every climate.',
        correctAnswer: 'F',
      },
      {
        id: 'r1-t-4',
        statement: 'Some heat-mitigation strategies may need extra maintenance or resources.',
        correctAnswer: 'T',
      },
    ],
  };

  const passage1Sentence: SentenceCompletionBlock = {
    id: 'r1-sent-1',
    type: 'SENTENCE_COMPLETION',
    instruction: 'Complete the sentences below. Write NO MORE THAN TWO WORDS for each answer.',
    questions: [
      {
        id: 'r1-sq-1',
        sentence: 'Heat stored in roofs and pavements is released more ____ at night.',
        blanks: [{ id: 'b1', correctAnswer: 'slowly', position: 0 }],
        answerRule: 'TWO_WORDS',
      },
      {
        id: 'r1-sq-2',
        sentence: 'Cool roofs use materials with high solar ____ to reduce heat absorption.',
        blanks: [{ id: 'b1', correctAnswer: 'reflectance', position: 0 }],
        answerRule: 'TWO_WORDS',
      },
      {
        id: 'r1-sq-3',
        sentence: 'In cold regions, a reflective roof may increase ____ demand.',
        blanks: [{ id: 'b1', correctAnswer: 'heating', position: 0 }],
        answerRule: 'TWO_WORDS',
      },
      {
        id: 'r1-sq-4',
        sentence: 'Effective urban plans often target areas with both heat risk and social ____.',
        blanks: [{ id: 'b1', correctAnswer: 'vulnerability', position: 0 }],
        answerRule: 'TWO_WORDS',
      },
    ],
  };

  const passage1: Passage = {
    id: 'r-p1',
    title: 'Passage 1',
    content: passage1Content,
    blocks: [passage1Matching, passage1Tfng, passage1Sentence],
    images: [],
    wordCount: countWords(passage1Content),
    metadata: {
      id: 'r-p1-meta',
      difficulty: 'medium',
      source: 'Original IELTS-style sample (generated)',
      topic: 'Climate & cities',
      tags: ['urban heat', 'energy', 'design'],
      wordCount: countWords(passage1Content),
      estimatedTimeMinutes: 20,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      author: 'System',
    },
  };

  const passage2Content = `
<h2>Citizen Science and the Biodiversity Map</h2>
<p><strong>A</strong> Ecologists often describe biodiversity as a moving target. Species distributions shift with land use, invasive organisms, and climate. Yet many conservation decisions rely on maps that quickly become outdated. Traditional field surveys, carried out by trained experts, remain the gold standard, but they are costly and cannot cover every region frequently.</p>
<p><strong>B</strong> Citizen science projects attempt to narrow this gap by recruiting non-professionals to collect observations. Smartphone cameras and GPS make it possible to record when and where a plant or animal was seen. Participants upload photos to platforms that combine human review with automated image recognition. Over time, these records create a detailed picture of local species.</p>
<p><strong>C</strong> The main strength of citizen science is scale. Thousands of volunteers can sample parks, gardens, shorelines, and roadside verges that would otherwise be ignored. This broad coverage is particularly valuable for detecting sudden changes, such as the arrival of an insect pest or the first flowering date of a seasonal plant.</p>
<p><strong>D</strong> However, the data are uneven. Observations cluster around cities, tourist sites, and accessible paths. Rare species may be under-reported because they are difficult to find, while charismatic species may be over-reported because people enjoy photographing them. In addition, participants vary in skill; a blurred photo may capture a silhouette but not a diagnostic feature.</p>
<p><strong>E</strong> To reduce errors, many projects introduce structured protocols. They provide short training modules and request specific types of evidence: multiple photos, a note about habitat, or a recording of bird song. Some platforms also assign a confidence score to each identification. Scientists can filter records by confidence and by the experience level of the observer.</p>
<p><strong>F</strong> When integrated carefully, citizen science can complement professional surveys. For example, a national park might use volunteer data to identify possible “hotspots” and then send experts to confirm the findings. This hybrid approach keeps costs manageable while improving the timeliness of biodiversity monitoring.</p>
<p><strong>G</strong> The value of citizen science is therefore not only the volume of data, but the feedback loop it creates. Participants learn to notice species and habitats, and scientists gain a broader, faster view of ecological change. The challenge is to design systems that encourage participation while maintaining data quality.</p>
`.trim();

  const passage2Cloze: ClozeBlock = {
    id: 'r2-cloze-1',
    type: 'CLOZE',
    instruction: 'Answer questions 14-19. Write NO MORE THAN TWO WORDS for each answer.',
    answerRule: 'TWO_WORDS',
    questions: [
      { id: 'r2-c-1', prompt: 'Traditional expert surveys are accurate but can be ____ and limited in coverage.', correctAnswer: 'costly' },
      { id: 'r2-c-2', prompt: 'Citizen science records often include photos and ____ data to locate observations.', correctAnswer: 'GPS' },
      { id: 'r2-c-3', prompt: 'Volunteer observations can help detect sudden changes such as the arrival of an insect ____.', correctAnswer: 'pest' },
      { id: 'r2-c-4', prompt: 'Observations may cluster near cities and other ____ places.', correctAnswer: 'accessible' },
      { id: 'r2-c-5', prompt: 'Some platforms use a ____ score to help scientists filter identifications.', correctAnswer: 'confidence' },
      { id: 'r2-c-6', prompt: 'A hybrid approach uses volunteer data to find hotspots before sending ____ to confirm.', correctAnswer: 'experts' },
    ],
  };

  const passage2Multi: MultiMCQBlock = {
    id: 'r2-mmcq-1',
    type: 'MULTI_MCQ',
    instruction: 'Choose TWO letters, A-E.',
    stem: 'Which TWO issues are described as sources of bias in citizen science datasets?',
    requiredSelections: 2,
    options: [
      { id: 'r2-m1-a', text: 'Observations tend to be concentrated in certain locations.', isCorrect: true },
      { id: 'r2-m1-b', text: 'All smartphone GPS sensors report identical accuracy.', isCorrect: false },
      { id: 'r2-m1-c', text: 'Charismatic species may be reported more frequently.', isCorrect: true },
      { id: 'r2-m1-d', text: 'Experts refuse to use any volunteer-collected data.', isCorrect: false },
      { id: 'r2-m1-e', text: 'Citizen science cannot detect seasonal patterns.', isCorrect: false },
    ],
  };

  const passage2Features: MatchingFeaturesBlock = {
    id: 'r2-feat-1',
    type: 'MATCHING_FEATURES',
    instruction: 'Match each feature (20-24) with the correct benefit or limitation (A-D).',
    options: ['A', 'B', 'C', 'D'],
    features: [
      { id: 'r2-f-1', text: 'Smartphone cameras and GPS', correctMatch: 'A' },
      { id: 'r2-f-2', text: 'Large volunteer participation', correctMatch: 'B' },
      { id: 'r2-f-3', text: 'Clustering near accessible locations', correctMatch: 'C' },
      { id: 'r2-f-4', text: 'Training modules and protocols', correctMatch: 'D' },
      { id: 'r2-f-5', text: 'Expert follow-up surveys', correctMatch: 'D' },
    ],
  };

  const passage2: Passage = {
    id: 'r-p2',
    title: 'Passage 2',
    content: passage2Content,
    blocks: [passage2Cloze, passage2Multi, passage2Features],
    images: [],
    wordCount: countWords(passage2Content),
    metadata: {
      id: 'r-p2-meta',
      difficulty: 'medium',
      source: 'Original IELTS-style sample (generated)',
      topic: 'Ecology & data',
      tags: ['citizen science', 'biodiversity', 'data quality'],
      wordCount: countWords(passage2Content),
      estimatedTimeMinutes: 20,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      author: 'System',
    },
  };

  const passage3Content = `
<h2>Sleep, Memory, and the “Offline” Brain</h2>
<p><strong>A</strong> It is tempting to think of sleep as a period when the brain simply shuts down. In reality, many regions remain active, and this activity appears to support learning. People who sleep after studying often recall material better than those who stay awake for the same amount of time. The improvement is not only about rest; it reflects biological processes that stabilise new memories.</p>
<p><strong>B</strong> One influential idea is that the brain “replays” patterns of neural activity during sleep. In laboratory studies, animals that run through a maze show similar firing patterns later while they sleep, as if the brain is practising the route again. This replay is thought to strengthen connections between neurons, making the memory easier to retrieve later.</p>
<p><strong>C</strong> Sleep is not uniform. It cycles through stages, including rapid eye movement (REM) sleep and non-REM sleep. Some research suggests that different stages support different kinds of learning. For example, factual information may benefit more from slow-wave sleep, whereas integrating emotional experiences may rely more on REM sleep. The exact boundary is debated, but few scientists now doubt that stage matters.</p>
<p><strong>D</strong> A second theory focuses on “synaptic homeostasis”. During waking hours, the brain forms countless small changes in synapses as it responds to the world. If all of these changes accumulated without restraint, the brain would become inefficient and energetically costly. According to the homeostasis view, sleep downscales weaker connections and preserves stronger ones, effectively reducing noise and keeping the system flexible.</p>
<p><strong>E</strong> Both theories point to an important practical implication: learning does not end when study stops. Yet in daily life, sleep is frequently shortened. Shift work, late-night screen use, and long commutes can reduce time in deep sleep. Over days and weeks, this loss may lead to slower learning, poorer attention, and reduced emotional regulation.</p>
<p><strong>F</strong> Researchers have tested whether short daytime naps can compensate. Even naps as brief as 20 minutes can improve alertness, though their effects on long-term memory depend on whether the nap includes deeper stages. In education and high-pressure workplaces, controlled nap opportunities have been proposed as a performance tool, but cultural attitudes toward napping vary widely.</p>
<p><strong>G</strong> Sleep therefore acts as an “offline” period in which the brain reorganises itself. The most effective learning strategies may be those that combine well-timed practice with sufficient sleep. Although the details of replay and synaptic homeostasis are still being refined, the overall message is clear: sleep is not the enemy of productivity but an active partner in memory.</p>
`.trim();

  const passage3Tfng: TFNGBlock = {
    id: 'r3-tfng-1',
    type: 'TFNG',
    instruction: 'Do the following statements agree with the information in the passage? Write TRUE, FALSE or NOT GIVEN.',
    mode: 'TFNG',
    questions: [
      { id: 'r3-t-1', statement: 'During sleep, the brain is completely inactive.', correctAnswer: 'F' },
      { id: 'r3-t-2', statement: 'Neural replay has been observed in animals in controlled studies.', correctAnswer: 'T' },
      { id: 'r3-t-3', statement: 'Scientists universally agree which sleep stage benefits every type of learning most.', correctAnswer: 'F' },
      { id: 'r3-t-4', statement: 'The synaptic homeostasis theory proposes that sleep may reduce weaker connections.', correctAnswer: 'T' },
      { id: 'r3-t-5', statement: 'All 20-minute naps include deep sleep stages.', correctAnswer: 'F' },
    ],
  };

  const passage3Matching: MatchingBlock = {
    id: 'r3-matching-1',
    type: 'MATCHING',
    instruction: 'Choose the correct heading for paragraphs C-F from the list of headings below.',
    headings: [
      { id: 'r3-h-1', text: 'Why sleep stages could matter' },
      { id: 'r3-h-2', text: 'A theory about balancing synaptic change' },
      { id: 'r3-h-3', text: 'Social causes of reduced sleep' },
      { id: 'r3-h-4', text: 'Whether naps can replace night sleep' },
      { id: 'r3-h-5', text: 'How to design a maze experiment' },
      { id: 'r3-h-6', text: 'The chemistry of caffeine metabolism' },
    ],
    questions: [
      { id: 'r3-mq-1', paragraphLabel: 'C', correctHeading: 'i' },
      { id: 'r3-mq-2', paragraphLabel: 'D', correctHeading: 'ii' },
      { id: 'r3-mq-3', paragraphLabel: 'E', correctHeading: 'iii' },
      { id: 'r3-mq-4', paragraphLabel: 'F', correctHeading: 'iv' },
    ],
  };

  const passage3Notes: NoteCompletionBlock = {
    id: 'r3-note-1',
    type: 'NOTE_COMPLETION',
    instruction: 'Complete the notes below. Write NO MORE THAN TWO WORDS for each answer.',
    questions: [
      {
        id: 'r3-nq-1',
        noteText:
          'Two sleep theories:\n' +
          '- Replay: the brain may repeat patterns from learning (observed in animals running a ____).\n' +
          '- Synaptic homeostasis: sleep may reduce ____ connections to prevent inefficiency.\n' +
          'Practical issues:\n' +
          '- Modern life can shorten ____ sleep.\n' +
          '- Short naps can improve ____ but may not always support long-term memory.\n' +
          '- Sleep supports memory and is a partner in ____.\n',
        blanks: [
          { id: 'b1', correctAnswer: 'maze', position: 0 },
          { id: 'b2', correctAnswer: 'weaker', position: 1 },
          { id: 'b3', correctAnswer: 'deep', position: 2 },
          { id: 'b4', correctAnswer: 'alertness', position: 3 },
          { id: 'b5', correctAnswer: 'learning', position: 4 },
        ],
        answerRule: 'TWO_WORDS',
      },
    ],
  };

  const passage3: Passage = {
    id: 'r-p3',
    title: 'Passage 3',
    content: passage3Content,
    blocks: [passage3Tfng, passage3Matching, passage3Notes],
    images: [],
    wordCount: countWords(passage3Content),
    metadata: {
      id: 'r-p3-meta',
      difficulty: 'hard',
      source: 'Original IELTS-style sample (generated)',
      topic: 'Neuroscience & learning',
      tags: ['sleep', 'memory', 'learning'],
      wordCount: countWords(passage3Content),
      estimatedTimeMinutes: 20,
      usageCount: 0,
      createdAt: new Date().toISOString(),
      author: 'System',
    },
  };

  return [passage1, passage2, passage3];
}

function buildAcademicListeningParts(): ListeningPart[] {
  const part1Notes: NoteCompletionBlock = {
    id: 'l1-note-1',
    type: 'NOTE_COMPLETION',
    instruction: 'Complete the form below. Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.',
    questions: [
      {
        id: 'l1-nq-1',
        noteText:
          'Student Services Appointment\n' +
          'Name: Lina ____\n' +
          'Student ID: ____\n' +
          'Reason for visit: guidance on course ____\n' +
          'Preferred contact: ____\n' +
          'Appointment day: ____\n' +
          'Office number: ____\n',
        blanks: [
          { id: 'b1', correctAnswer: 'Marin', position: 0 },
          { id: 'b2', correctAnswer: '482716', position: 1 },
          { id: 'b3', correctAnswer: 'selection', position: 2 },
          { id: 'b4', correctAnswer: 'email', position: 3 },
          { id: 'b5', correctAnswer: 'Thursday', position: 4 },
          { id: 'b6', correctAnswer: 'B14', position: 5 },
        ],
        answerRule: 'TWO_WORDS',
      },
    ],
  };

  const part1Single: SingleMCQBlock = {
    id: 'l1-smcq-1',
    type: 'SINGLE_MCQ',
    instruction: 'Choose the correct letter, A, B or C.',
    stem: 'Lina first contacted Student Services because she wanted',
    options: [
      { id: 'l1-s-a', text: 'help finding accommodation.', isCorrect: false },
      { id: 'l1-s-b', text: 'advice about choosing modules.', isCorrect: true },
      { id: 'l1-s-c', text: 'to change her ID card.', isCorrect: false },
    ],
  };

  const part1Tfng: TFNGBlock = {
    id: 'l1-tfng-1',
    type: 'TFNG',
    instruction: 'Do the following statements agree with the information? Write TRUE, FALSE or NOT GIVEN.',
    mode: 'TFNG',
    questions: [
      { id: 'l1-t-1', statement: 'The appointment will take place in the afternoon.', correctAnswer: 'NG' },
      { id: 'l1-t-2', statement: 'Lina prefers to be contacted by email.', correctAnswer: 'T' },
      { id: 'l1-t-3', statement: 'The office number contains a letter and a number.', correctAnswer: 'T' },
    ],
  };

  const part1: ListeningPart = {
    id: 'l-part-1',
    title: 'Part 1: Student Services conversation',
    audioUrl: undefined,
    pins: [
      { id: makeId({ prefix: 'l1', segment: 'pin', index: 1 }), time: '00:20', label: 'Form details' },
      { id: makeId({ prefix: 'l1', segment: 'pin', index: 2 }), time: '01:40', label: 'Multiple choice' },
    ],
    blocks: [part1Notes, part1Single, part1Tfng],
  };

  const part2Sentence: SentenceCompletionBlock = {
    id: 'l2-sent-1',
    type: 'SENTENCE_COMPLETION',
    instruction: 'Complete the sentences below. Write NO MORE THAN TWO WORDS for each answer.',
    questions: [
      { id: 'l2-sq-1', sentence: 'The tour begins at the main ____ near the fountain.', blanks: [{ id: 'b1', correctAnswer: 'entrance', position: 0 }], answerRule: 'TWO_WORDS' },
      { id: 'l2-sq-2', sentence: 'Visitors should avoid feeding the ____ in the lake.', blanks: [{ id: 'b1', correctAnswer: 'wildlife', position: 0 }], answerRule: 'TWO_WORDS' },
      { id: 'l2-sq-3', sentence: 'The oldest trees on the route are ____ years old.', blanks: [{ id: 'b1', correctAnswer: '200', position: 0 }], answerRule: 'TWO_WORDS' },
      { id: 'l2-sq-4', sentence: 'The glasshouse is kept warm using a ____ system.', blanks: [{ id: 'b1', correctAnswer: 'geothermal', position: 0 }], answerRule: 'TWO_WORDS' },
      { id: 'l2-sq-5', sentence: 'The café offers a discount to students with a valid ____.', blanks: [{ id: 'b1', correctAnswer: 'card', position: 0 }], answerRule: 'TWO_WORDS' },
      { id: 'l2-sq-6', sentence: 'The talk ends with a short ____ session.', blanks: [{ id: 'b1', correctAnswer: 'question', position: 0 }], answerRule: 'TWO_WORDS' },
    ],
  };

  const part2Multi: MultiMCQBlock = {
    id: 'l2-mmcq-1',
    type: 'MULTI_MCQ',
    instruction: 'Choose TWO letters, A-E.',
    stem: 'Which TWO facilities are mentioned as newly renovated?',
    requiredSelections: 2,
    options: [
      { id: 'l2-m-a', text: 'The visitor centre', isCorrect: true },
      { id: 'l2-m-b', text: 'The children’s playground', isCorrect: false },
      { id: 'l2-m-c', text: 'The glasshouse', isCorrect: true },
      { id: 'l2-m-d', text: 'The lake bridge', isCorrect: false },
      { id: 'l2-m-e', text: 'The parking lot', isCorrect: false },
    ],
  };

  const part2Short: ShortAnswerBlock = {
    id: 'l2-short-1',
    type: 'SHORT_ANSWER',
    instruction: 'Answer the questions below. Write NO MORE THAN TWO WORDS for each answer.',
    questions: [
      { id: 'l2-sa-1', prompt: 'What should visitors bring if the weather changes?', correctAnswer: 'raincoat', answerRule: 'TWO_WORDS' },
      { id: 'l2-sa-2', prompt: 'Where can visitors find the route map?', correctAnswer: 'website', answerRule: 'TWO_WORDS' },
    ],
  };

  const part2: ListeningPart = {
    id: 'l-part-2',
    title: 'Part 2: Guided garden tour',
    audioUrl: undefined,
    pins: [
      { id: makeId({ prefix: 'l2', segment: 'pin', index: 1 }), time: '00:10', label: 'Tour route' },
      { id: makeId({ prefix: 'l2', segment: 'pin', index: 2 }), time: '02:05', label: 'Facilities' },
    ],
    blocks: [part2Sentence, part2Multi, part2Short],
  };

  const part3Features: MatchingFeaturesBlock = {
    id: 'l3-feat-1',
    type: 'MATCHING_FEATURES',
    instruction: 'Match each speaker (21-25) with the opinion (A-D).',
    options: ['A', 'B', 'C', 'D'],
    features: [
      { id: 'l3-f-1', text: 'Speaker 1', correctMatch: 'A' },
      { id: 'l3-f-2', text: 'Speaker 2', correctMatch: 'C' },
      { id: 'l3-f-3', text: 'Speaker 3', correctMatch: 'B' },
      { id: 'l3-f-4', text: 'Speaker 4', correctMatch: 'D' },
      { id: 'l3-f-5', text: 'Speaker 5', correctMatch: 'C' },
    ],
  };

  const part3Single: SingleMCQBlock = {
    id: 'l3-smcq-1',
    type: 'SINGLE_MCQ',
    instruction: 'Choose the correct letter, A, B or C.',
    stem: 'The group agrees that the presentation should include',
    options: [
      { id: 'l3-s-a', text: 'a short video clip.', isCorrect: true },
      { id: 'l3-s-b', text: 'a live interview.', isCorrect: false },
      { id: 'l3-s-c', text: 'a long historical timeline.', isCorrect: false },
    ],
  };

  const part3Cloze: ClozeBlock = {
    id: 'l3-cloze-1',
    type: 'CLOZE',
    instruction: 'Complete the sentences below. Write NO MORE THAN TWO WORDS for each answer.',
    answerRule: 'TWO_WORDS',
    questions: [
      { id: 'l3-c-1', prompt: 'They will meet again on ____ morning.', correctAnswer: 'Monday' },
      { id: 'l3-c-2', prompt: 'The introduction should be kept under ____ minutes.', correctAnswer: 'two' },
      { id: 'l3-c-3', prompt: 'One member will handle the ____ section.', correctAnswer: 'conclusion' },
      { id: 'l3-c-4', prompt: 'They will share files using a ____ folder.', correctAnswer: 'shared' },
    ],
  };

  const part3: ListeningPart = {
    id: 'l-part-3',
    title: 'Part 3: Students planning a presentation',
    audioUrl: undefined,
    pins: [
      { id: makeId({ prefix: 'l3', segment: 'pin', index: 1 }), time: '00:35', label: 'Opinions' },
      { id: makeId({ prefix: 'l3', segment: 'pin', index: 2 }), time: '03:10', label: 'Plan details' },
    ],
    blocks: [part3Features, part3Single, part3Cloze],
  };

  const part4Cloze: ClozeBlock = {
    id: 'l4-cloze-1',
    type: 'CLOZE',
    instruction: 'Complete the notes below. Write NO MORE THAN TWO WORDS for each answer.',
    answerRule: 'TWO_WORDS',
    questions: [
      { id: 'l4-c-1', prompt: 'The study focused on reducing plastic ____ in rivers.', correctAnswer: 'waste' },
      { id: 'l4-c-2', prompt: 'Samples were collected monthly for ____ years.', correctAnswer: 'three' },
      { id: 'l4-c-3', prompt: 'Microplastics were most common near ____ zones.', correctAnswer: 'industrial' },
      { id: 'l4-c-4', prompt: 'A key method involved filtering water through ____ nets.', correctAnswer: 'fine' },
      { id: 'l4-c-5', prompt: 'The team recommends improving ____ infrastructure.', correctAnswer: 'recycling' },
      { id: 'l4-c-6', prompt: 'Future work will test community ____ programmes.', correctAnswer: 'education' },
    ],
  };

  const part4Tfng: TFNGBlock = {
    id: 'l4-tfng-1',
    type: 'TFNG',
    instruction: 'Do the following statements agree with the lecture? Write TRUE, FALSE or NOT GIVEN.',
    mode: 'TFNG',
    questions: [
      { id: 'l4-t-1', statement: 'The research team collected samples only once per year.', correctAnswer: 'F' },
      { id: 'l4-t-2', statement: 'Microplastics were found in every location sampled.', correctAnswer: 'NG' },
      { id: 'l4-t-3', statement: 'Industrial zones were associated with higher microplastic levels.', correctAnswer: 'T' },
      { id: 'l4-t-4', statement: 'The lecture suggests education programmes may reduce plastic pollution.', correctAnswer: 'T' },
    ],
  };

  const part4: ListeningPart = {
    id: 'l-part-4',
    title: 'Part 4: Lecture on plastic pollution research',
    audioUrl: undefined,
    pins: [
      { id: makeId({ prefix: 'l4', segment: 'pin', index: 1 }), time: '00:50', label: 'Methods' },
      { id: makeId({ prefix: 'l4', segment: 'pin', index: 2 }), time: '04:15', label: 'Findings' },
    ],
    blocks: [part4Cloze, part4Tfng],
  };

  return [part1, part2, part3, part4];
}

function buildAcademicWritingTasks(): {
  task1Prompt: string;
  task2Prompt: string;
  task1Chart: WritingChartData;
  tasks: WritingTaskContent[];
} {
  const task1Prompt =
    'The chart below shows the percentage of household electricity used for five purposes in two different years.\n\nSummarise the information by selecting and reporting the main features, and make comparisons where relevant.';
  const task1Chart: WritingChartData = {
    id: 'w-chart-1',
    title: 'Household electricity use (%)',
    type: 'bar',
    labels: ['Heating', 'Cooling', 'Lighting', 'Cooking', 'Electronics'],
    values: [42, 5, 12, 10, 31],
  };

  const task2Prompt =
    'Some people think that governments should spend more money on public transport, while others believe that building more roads is the best way to reduce traffic congestion.\n\nDiscuss both views and give your own opinion.';

  return {
    task1Prompt,
    task2Prompt,
    task1Chart,
    tasks: [
      { taskId: 'task1', prompt: task1Prompt, chart: task1Chart },
      { taskId: 'task2', prompt: task2Prompt },
    ],
  };
}

export function createAcademicSampleExamState(baseState: ExamState): ExamState {
  const baseConfig = normalizeExamConfig(baseState.config);
  const config = normalizeExamConfig({
    ...baseConfig,
    general: {
      ...baseConfig.general,
      type: 'Academic',
      title: 'IELTS Academic Sample Exam (IELTS-style)',
      summary: 'Original IELTS-style Academic seed exam (Listening, Reading, Writing).',
    },
    sections: {
      ...baseConfig.sections,
      listening: {
        ...baseConfig.sections.listening,
        enabled: true,
        partCount: 4,
        order: 0,
      },
      reading: {
        ...baseConfig.sections.reading,
        enabled: true,
        passageCount: 3,
        order: 1,
      },
      writing: {
        ...baseConfig.sections.writing,
        enabled: true,
        order: 2,
      },
      speaking: {
        ...baseConfig.sections.speaking,
        enabled: false,
        order: 3,
      },
    },
  });

  const passages = buildAcademicReadingPassages();
  const listeningParts = buildAcademicListeningParts();
  const writing = buildAcademicWritingTasks();

  return {
    ...baseState,
    title: config.general.title,
    type: 'Academic',
    activeModule: 'listening',
    activePassageId: passages[0]?.id ?? baseState.activePassageId,
    activeListeningPartId: listeningParts[0]?.id ?? baseState.activeListeningPartId,
    config,
    reading: {
      passages,
    },
    listening: {
      parts: listeningParts,
    },
    writing: {
      task1Prompt: writing.task1Prompt,
      task2Prompt: writing.task2Prompt,
      task1Chart: writing.task1Chart,
      tasks: writing.tasks,
      customPromptTemplates: [],
      rubric: buildWritingRubric(config, structuredClone(OFFICIAL_WRITING_RUBRIC)),
      gradeHistory: [],
    },
    speaking: {
      ...baseState.speaking,
      part1Topics: baseState.speaking.part1Topics ?? [],
      cueCard: baseState.speaking.cueCard ?? '',
      part3Discussion: baseState.speaking.part3Discussion ?? [],
      evaluatorNotes: baseState.speaking.evaluatorNotes ?? '',
      gradeHistory: [],
    },
  };
}
