import type {
  AnswerDefinition,
  AssessmentAuthoringShell,
  BatchQuestionDraft,
  Difficulty,
  LoadSampleExamRequest,
  QuestionMetadata,
  StructuredContent,
} from "../../contracts/assessment";
import { plainContentFromText, structuredContentFromDocument } from "../../editor/richContent";
import { validateSatQuestion } from "./satProvider";

const RW_SKILLS = [
  ["information-and-ideas", "Central Ideas and Details"],
  ["information-and-ideas", "Command of Evidence — Textual"],
  ["information-and-ideas", "Command of Evidence — Quantitative"],
  ["information-and-ideas", "Inferences"],
  ["craft-and-structure", "Words in Context"],
  ["craft-and-structure", "Text Structure and Purpose"],
  ["craft-and-structure", "Cross-Text Connections"],
  ["expression-of-ideas", "Rhetorical Synthesis"],
  ["expression-of-ideas", "Transitions"],
  ["standard-english-conventions", "Boundaries"],
  ["standard-english-conventions", "Form, Structure, and Sense"],
] as const;

const MATH_SKILLS = [
  ["algebra", "Linear Equations in One Variable"],
  ["algebra", "Linear Functions"],
  ["algebra", "Linear Equations in Two Variables"],
  ["algebra", "Systems of Two Linear Equations"],
  ["algebra", "Linear Inequalities"],
  ["advanced-math", "Equivalent Expressions"],
  ["advanced-math", "Nonlinear Equations in One Variable"],
  ["advanced-math", "Systems of Equations in Two Variables"],
  ["advanced-math", "Nonlinear Functions"],
  ["problem-solving-and-data-analysis", "Ratios, Rates, Proportional Relationships, and Units"],
  ["problem-solving-and-data-analysis", "Percentages"],
  ["problem-solving-and-data-analysis", "One-Variable Data"],
  ["problem-solving-and-data-analysis", "Two-Variable Data"],
  ["problem-solving-and-data-analysis", "Probability and Conditional Probability"],
  ["problem-solving-and-data-analysis", "Inference from Sample Statistics and Margin of Error"],
  ["problem-solving-and-data-analysis", "Evaluating Statistical Claims"],
  ["geometry-and-trigonometry", "Area and Volume"],
  ["geometry-and-trigonometry", "Lines, Angles, and Triangles"],
  ["geometry-and-trigonometry", "Right Triangles and Trigonometry"],
  ["geometry-and-trigonometry", "Circles"],
  ["algebra", "Linear Functions"],
  ["problem-solving-and-data-analysis", "Percentages"],
] as const;

const text = (value: string): StructuredContent => plainContentFromText(value);
const empty = (): StructuredContent => ({
  version: 2,
  nodes: [],
  document: { type: "doc", content: [{ type: "paragraph" }] },
});
const table = (rows: string[][]): StructuredContent => ({
  version: 1,
  nodes: [{ type: "table", id: "sample-table", rows }],
});
const rich = (document: NonNullable<StructuredContent["document"]>): StructuredContent =>
  structuredContentFromDocument(document);

function branchVariant(moduleKey: string): number {
  return moduleKey.includes("lower") ? 1 : moduleKey.includes("higher") ? 2 : 0;
}

function difficulty(moduleKey: string, index: number): Difficulty {
  if (moduleKey.includes("lower")) return index % 3 === 0 ? "easy" : "medium";
  if (moduleKey.includes("higher")) return index % 3 === 0 ? "hard" : "medium";
  return (["easy", "medium", "hard"] as const)[index % 3]!;
}

function metadata(
  sectionKey: string,
  domain: string,
  skill: string,
  moduleKey: string,
  index: number
): QuestionMetadata {
  return {
    sectionKey,
    domain,
    skill,
    difficulty: difficulty(moduleKey, index),
    tags: ["sample-sat", "original-item", moduleKey],
  };
}

function choiceAnswer(
  correct: string,
  distractors: [string, string, string],
  seed: number
): AnswerDefinition {
  const choices = [correct, ...distractors];
  const shift = seed % choices.length;
  const rotated = [...choices.slice(shift), ...choices.slice(0, shift)];
  const correctIndex = rotated.indexOf(correct);
  return {
    kind: "single_choice",
    options: rotated.map((value, index) => ({
      id: String.fromCharCode(65 + index),
      content: text(value),
    })),
    correctOptionId: String.fromCharCode(65 + correctIndex),
  };
}

interface ChoiceItem {
  stimulus: StructuredContent;
  prompt: string;
  correct: string;
  distractors: [string, string, string];
  rationale: string;
}

function rwItem(skill: string, serial: number, variant: number): ChoiceItem {
  switch (skill) {
    case "Central Ideas and Details":
      return {
        stimulus: text(
          `A city ecology team monitored two blocks during summer ${serial}. One block received native shade trees. By late afternoon, pavement on the planted block was consistently cooler, while morning temperatures differed little.`
        ),
        prompt: "Which choice best states the main idea of the text?",
        correct: "Native shade trees were associated with lower afternoon pavement temperatures.",
        distractors: [
          "Morning temperatures were much lower on the planted block.",
          "All native trees grew at the same rate.",
          "The unplanted block received more rainfall.",
        ],
        rationale:
          "The passage emphasizes the repeated afternoon temperature difference associated with the planted trees.",
      };
    case "Command of Evidence — Textual":
      return {
        stimulus: text(
          `Biologist Mara Chen proposed that a coastal beetle becomes more active after brief periods of fog. In trial ${serial}, researchers recorded beetle movement before and after naturally occurring fog events.`
        ),
        prompt: "Which finding, if true, would most directly support Chen's proposal?",
        correct:
          "Beetles moved farther in the thirty minutes after fog than in the thirty minutes before it.",
        distractors: [
          "The study site contained three species of coastal grass.",
          "Fog occurred more often in spring than in late summer.",
          "Some beetles were larger than others.",
        ],
        rationale:
          "A direct before-and-after increase in movement is the evidence most relevant to the proposed effect of fog.",
      };
    case "Command of Evidence — Quantitative":
      return {
        stimulus: table([
          [`Treatment — trial ${serial}`, "Mean germination (%)"],
          ["No soak", String(62 + variant)],
          ["2-hour soak", String(74 + variant)],
          ["6-hour soak", String(81 + variant)],
        ]),
        prompt:
          "Which choice most accurately uses the table to support the claim that longer soaking was associated with greater germination?",
        correct: "The 6-hour treatment had the highest mean germination percentage.",
        distractors: [
          "The no-soak treatment had more seeds than the other treatments.",
          "Every seed in the 6-hour treatment germinated.",
          "The 2-hour treatment had a lower mean than the no-soak treatment.",
        ],
        rationale:
          "The table shows the highest reported mean for the 6-hour soak; the other claims are unsupported or contradicted.",
      };
    case "Inferences":
      return {
        stimulus: text(
          `A museum archive contains dozens of letters from painter Lila Okafor to her suppliers but almost none from winter ${2000 + serial}. Purchase ledgers from that winter nevertheless show unusually large orders of blue pigment.`
        ),
        prompt: "Which inference is best supported by the text?",
        correct:
          "Okafor probably continued painting during the winter even though few letters from that period survive.",
        distractors: [
          "Okafor stopped using blue pigment after the winter.",
          "The museum destroyed all correspondence from the winter.",
          "Blue pigment was cheaper than every other pigment that winter.",
        ],
        rationale:
          "The purchase records support continued artistic activity despite the gap in correspondence.",
      };
    case "Words in Context":
      return {
        stimulus: text(
          `To protect the fragile wetland while allowing research, the council reserved a narrow boardwalk for scientific teams during survey week ${serial}.`
        ),
        prompt: "As used in the text, what does “reserved” most nearly mean?",
        correct: "set aside",
        distractors: ["expressed doubt about", "remembered", "made less noticeable"],
        rationale: "In context, the boardwalk was set aside for a particular use.",
      };
    case "Text Structure and Purpose":
      return {
        stimulus: rich({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `A robotics team tested a new gripping material in trial ${serial}. `,
                },
                {
                  type: "text",
                  text: "The material held smooth glass securely but slipped on surfaces covered with fine dust.",
                  marks: [{ type: "underline" }],
                },
                {
                  type: "text",
                  text: " The team therefore added a textured outer layer before the next trial.",
                },
              ],
            },
          ],
        }),
        prompt:
          "Which choice best describes the function of the underlined sentence in the text as a whole?",
        correct: "It identifies a limitation that motivated a design change.",
        distractors: [
          "It presents the team's final conclusion about all gripping materials.",
          "It explains why glass was removed from the experiment.",
          "It introduces an unrelated alternative design.",
        ],
        rationale:
          "The underlined result identifies the slipping problem, which directly motivates the modification described next.",
      };
    case "Cross-Text Connections":
      return {
        stimulus: rich({
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Text 1" }] },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `A survey of lake sediment in region ${serial} suggests that a major drought lasted roughly thirty years.`,
                },
              ],
            },
            { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "Text 2" }] },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "A second team agrees that a drought occurred but notes that sediment accumulation rates vary across the lake, making the exact duration uncertain.",
                },
              ],
            },
          ],
        }),
        prompt:
          "Based on the texts, how would the author of Text 2 most likely respond to the estimate in Text 1?",
        correct: "The estimate is plausible, but its precision should be treated cautiously.",
        distractors: [
          "The estimate is impossible because no drought occurred.",
          "The estimate must be exact because both teams studied sediment.",
          "The estimate should be replaced with a claim about increasing rainfall.",
        ],
        rationale:
          "Text 2 accepts the drought but explicitly cautions against treating its duration as exact.",
      };
    case "Rhetorical Synthesis":
      return {
        stimulus: rich({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A student has taken the following notes:" }],
            },
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: `The North Pier library opened in ${1980 + serial}.`,
                        },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "A renovation added study rooms and solar panels." },
                      ],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "The renovation was completed without increasing the building's footprint.",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        prompt:
          "The student wants to emphasize that the renovation added features while preserving the building's size. Which choice most effectively uses relevant information from the notes?",
        correct:
          "The renovation added study rooms and solar panels without increasing the library's footprint.",
        distractors: [
          "The North Pier library opened many years before its renovation.",
          "Libraries often contain study rooms for visitors.",
          "Solar panels can be installed on many kinds of buildings.",
        ],
        rationale:
          "The correct choice directly combines the added features with the unchanged footprint, matching the rhetorical goal.",
      };
    case "Transitions":
      return {
        stimulus: text(
          `The first prototype used a rigid hinge and was difficult to fold. The second prototype used a flexible joint. _____, it could be packed into a much smaller case during field test ${serial}.`
        ),
        prompt: "Which choice completes the text with the most logical transition?",
        correct: "As a result",
        distractors: ["Nevertheless", "For example", "Meanwhile"],
        rationale:
          "The smaller packed size is a result of the flexible joint, so a cause-and-effect transition is required.",
      };
    case "Boundaries":
      return {
        stimulus: text(
          `During observation ${serial}, the astronomers recorded a faint signal _____ they repeated the measurement with a second instrument.`
        ),
        prompt:
          "Which choice completes the text so that it conforms to the conventions of Standard English?",
        correct: "; afterward,",
        distractors: [", afterward,", " afterward", ": and afterward"],
        rationale:
          "A semicolon joins the independent clauses, and the introductory adverb in the second clause is followed by a comma.",
      };
    default:
      return {
        stimulus: text(
          `The collection of field sketches from expedition ${serial}, together with the accompanying notes, _____ stored in a climate-controlled cabinet.`
        ),
        prompt:
          "Which choice completes the text so that it conforms to the conventions of Standard English?",
        correct: "is",
        distractors: ["are", "have been", "were being"],
        rationale:
          "The subject is the singular noun “collection”; the intervening phrase does not change the required singular verb.",
      };
  }
}

function readingWritingQuestion(moduleKey: string, index: number): BatchQuestionDraft {
  const [domain, skill] = RW_SKILLS[index % RW_SKILLS.length]!;
  const variant = branchVariant(moduleKey);
  const serial = index + 1 + variant * 40;
  const item = rwItem(skill, serial, variant);
  return {
    questionType: "single_choice",
    stimulus: item.stimulus,
    prompt: text(item.prompt),
    answer: choiceAnswer(item.correct, item.distractors, index + variant),
    rationale: text(item.rationale),
    metadata: metadata("reading-writing", domain, skill, moduleKey, index),
    accessibility: { longDescription: null },
    isPretest: index === 5 || index === 20,
  };
}

interface MathItem {
  stimulus: StructuredContent;
  prompt: string;
  correct: string;
  distractors: [string, string, string];
  rationale: string;
  studentResponse?: string;
}

function mathItem(skill: string, index: number, variant: number): MathItem {
  const k = index + variant + 2;
  switch (skill) {
    case "Linear Equations in One Variable": {
      const x = 3 + variant;
      return {
        stimulus: empty(),
        prompt: `If 4x + ${k} = ${4 * x + k}, what is the value of x?`,
        correct: String(x),
        distractors: ["1", "2", String(x + 2)],
        rationale: `Subtract ${k} from both sides and divide by 4 to obtain x = ${x}.`,
        studentResponse: String(x),
      };
    }
    case "Linear Functions": {
      const slope = 2 + (index % 5);
      const intercept = 2 + variant;
      return {
        stimulus: text(
          `For a linear function f, f(0) = ${intercept} and f(3) = ${intercept + 3 * slope}.`
        ),
        prompt: "What is the slope of the graph of y = f(x)?",
        correct: String(slope),
        distractors: [String(slope - 1), String(slope + 1), String(slope + 3)],
        rationale: `The slope is ${3 * slope}/3 = ${slope}.`,
      };
    }
    case "Linear Equations in Two Variables":
      return {
        stimulus: empty(),
        prompt: `Which ordered pair is a solution to 2x + y = ${10 + variant}?`,
        correct: `(2, ${6 + variant})`,
        distractors: [`(3, ${2 + variant})`, `(4, ${4 + variant})`, `(5, ${5 + variant})`],
        rationale:
          "Substituting the coordinates in the correct choice makes the left side equal the stated constant.",
      };
    case "Systems of Two Linear Equations": {
      const sum = 11 + 2 * variant;
      const difference = 3;
      const x = (sum + difference) / 2;
      return {
        stimulus: empty(),
        prompt: `The equations x + y = ${sum} and x − y = ${difference} form a system. What is the value of x?`,
        correct: String(x),
        distractors: [String(x - 3), String(x + 1), String(x * 2)],
        rationale: `Adding the equations gives 2x = ${sum + difference}, so x = ${x}.`,
      };
    }
    case "Linear Inequalities": {
      const bound = 5 + variant;
      return {
        stimulus: empty(),
        prompt: `Which inequality is equivalent to 3x − 5 > ${3 * bound - 5}?`,
        correct: `x > ${bound}`,
        distractors: [`x < ${bound}`, `x > ${3 * bound}`, `x < ${3 * bound}`],
        rationale: `Add 5 to both sides and divide by 3 to get x > ${bound}.`,
      };
    }
    case "Equivalent Expressions": {
      const a = 3 + variant;
      const b = 4 + variant;
      return {
        stimulus: empty(),
        prompt: `Which expression is equivalent to (x + ${a})(x − ${b})?`,
        correct: `x² − x − ${a * b}`,
        distractors: [
          `x² + ${a + b}x − ${a * b}`,
          `x² − ${a + b}x + ${a * b}`,
          `x² − x + ${a * b}`,
        ],
        rationale: `Expanding combines the middle terms to −x and gives constant term −${a * b}.`,
      };
    }
    case "Nonlinear Equations in One Variable": {
      const x = 4 + variant;
      return {
        stimulus: empty(),
        prompt: `If x² = ${x * x}, and x is positive, what is x?`,
        correct: String(x),
        distractors: [String(x - 2), String(x - 1), String(x + 2)],
        rationale: "Take the positive square root of both sides.",
        studentResponse: String(x),
      };
    }
    case "Systems of Equations in Two Variables": {
      const coefficient = 2 + variant;
      return {
        stimulus: empty(),
        prompt: `The graphs of y = x² and y = ${coefficient}x intersect at (0, 0) and at which other point?`,
        correct: `(${coefficient}, ${coefficient * coefficient})`,
        distractors: [
          `(1, ${coefficient})`,
          `(${coefficient + 1}, ${coefficient * (coefficient + 1)})`,
          `(${coefficient * 2}, ${coefficient * 4})`,
        ],
        rationale: `Setting x² = ${coefficient}x gives the nonzero solution x = ${coefficient}.`,
      };
    }
    case "Nonlinear Functions": {
      const h = 5 + variant;
      const y = 2 + variant;
      return {
        stimulus: empty(),
        prompt: `The graph of g(x) = (x − ${h})² + ${y} has its minimum at which point?`,
        correct: `(${h}, ${y})`,
        distractors: [`(−${h}, ${y})`, `(${y}, ${h})`, `(${h}, −${y})`],
        rationale: `Vertex form gives the minimum at (${h}, ${y}).`,
      };
    }
    case "Ratios, Rates, Proportional Relationships, and Units": {
      const rate = 3 + variant;
      return {
        stimulus: empty(),
        prompt: `A machine packages ${rate * 6} boxes in 6 minutes at a constant rate. At this rate, how many boxes does it package in 15 minutes?`,
        correct: String(rate * 15),
        distractors: [String(rate * 10), String(rate * 12), String(rate * 18)],
        rationale: `The rate is ${rate} boxes per minute, so in 15 minutes it packages ${rate * 15} boxes.`,
      };
    }
    case "Percentages": {
      const price = index < 20 ? 80 : 120;
      const discount = 25 - variant * 5;
      const sale = (price * (100 - discount)) / 100;
      return {
        stimulus: empty(),
        prompt: `A jacket priced at $${price} is discounted by ${discount}%. What is the sale price, in dollars?`,
        correct: String(sale),
        distractors: [String(price - sale), String(sale - 5), String(sale + 5)],
        rationale: `The discount leaves ${100 - discount}% of $${price}, which is $${sale}.`,
        studentResponse: String(sale),
      };
    }
    case "One-Variable Data": {
      const values = [2, 4, 7, 9, 13].map((value) => value + variant);
      return {
        stimulus: table([["Value", ...values.map(String)]]),
        prompt: "What is the median of the data shown?",
        correct: String(values[2]),
        distractors: [String(values[1]), String(values[2]! + 1), String(values[3])],
        rationale: `The middle of the five ordered values is ${values[2]}.`,
      };
    }
    case "Two-Variable Data": {
      const contexts = [
        "study time and quiz score",
        "practice time and free-throw percentage",
        "daily temperature and electricity use",
      ] as const;
      const context = contexts[variant]!;
      return {
        stimulus: text(
          `A scatterplot of ${context} shows points clustered around an upward-sloping line.`
        ),
        prompt: "Which statement best describes the association?",
        correct: `There is a positive association between ${context}.`,
        distractors: [
          "There is a negative association.",
          "There is no association.",
          "The graph proves an exact causal relationship.",
        ],
        rationale:
          "An upward trend indicates a positive association, but it does not establish exact causation.",
      };
    }
    case "Probability and Conditional Probability": {
      const blue = 5 + variant;
      const total = blue + 5;
      const probability = variant === 2 ? "1/4" : `3/${total}`;
      return {
        stimulus: text(`A bag contains ${blue} blue, 3 green, and 2 gold tiles.`),
        prompt: "If one tile is selected at random, what is the probability that it is green?",
        correct: probability,
        distractors: ["1/5", "1/3", "3/5"],
        rationale: `There are 3 green tiles out of ${total} total tiles.`,
      };
    }
    case "Inference from Sample Statistics and Margin of Error": {
      const estimate = 48 + variant * 3;
      const margin = 4 + variant;
      return {
        stimulus: text(
          `A random sample estimates that ${estimate}% of voters support a proposal, with a margin of error of ${margin} percentage points.`
        ),
        prompt: "Which interval is consistent with the reported estimate and margin of error?",
        correct: `${estimate - margin}% to ${estimate + margin}%`,
        distractors: [
          `${estimate - 2}% to ${estimate + 2}%`,
          `${estimate}% to ${estimate + margin * 2}%`,
          `${estimate - margin * 2}% to ${estimate - margin}%`,
        ],
        rationale: `Subtracting and adding ${margin} points gives ${estimate - margin}% to ${estimate + margin}%.`,
      };
    }
    case "Evaluating Statistical Claims": {
      const populations = [
        "all students at a school",
        "all households in a city",
        "all patients at a clinic",
      ] as const;
      const population = populations[variant]!;
      return {
        stimulus: empty(),
        prompt: `A researcher wants an estimate that generalizes to ${population}. Which sampling method is best?`,
        correct: `Select a random sample from ${population}.`,
        distractors: [
          "Survey the first convenient group available.",
          "Survey only volunteers from one subgroup.",
          "Survey a small group selected for easy access.",
        ],
        rationale: "A random sample from the full target population best supports generalization.",
      };
    }
    case "Area and Volume": {
      const length = 5 + variant;
      const volume = length * 3 * 4;
      return {
        stimulus: empty(),
        prompt: `A rectangular prism has length ${length}, width 3, and height 4. What is its volume?`,
        correct: String(volume),
        distractors: [String(length + 7), String(length * 4), String(volume - 13)],
        rationale: `Volume is ${length} × 3 × 4 = ${volume}.`,
        studentResponse: String(volume),
      };
    }
    case "Lines, Angles, and Triangles": {
      const first = 35 + variant * 5;
      const third = 180 - first - 65;
      return {
        stimulus: empty(),
        prompt: `Two angles of a triangle measure ${first}° and 65°. What is the measure of the third angle?`,
        correct: `${third}°`,
        distractors: [`${third - 10}°`, `${third - 5}°`, `${third + 20}°`],
        rationale: `Triangle angles sum to 180°, so the third angle is ${third}°.`,
      };
    }
    case "Right Triangles and Trigonometry": {
      const triples = [
        [3, 4, 5],
        [5, 12, 13],
        [8, 15, 17],
      ] as const;
      const [a, b, c] = triples[variant]!;
      return {
        stimulus: empty(),
        prompt: `A right triangle has legs of length ${a} and ${b}. What is the length of its hypotenuse?`,
        correct: String(c),
        distractors: [String(c - 1), String(c + 1), String(a + b)],
        rationale: `By the Pythagorean theorem, the hypotenuse is ${c}.`,
        studentResponse: String(c),
      };
    }
    default: {
      const radius = 6 + variant;
      return {
        stimulus: empty(),
        prompt: `A circle has radius ${radius}. Which expression gives its area?`,
        correct: `${radius * radius}π`,
        distractors: [`${radius}π`, `${radius * 2}π`, `${radius * radius * 2}π`],
        rationale: `Area is πr², so the area is ${radius * radius}π.`,
      };
    }
  }
}

function mathQuestion(moduleKey: string, index: number): BatchQuestionDraft {
  const [domain, skill] = MATH_SKILLS[index % MATH_SKILLS.length]!;
  const variant = branchVariant(moduleKey);
  const item = mathItem(skill, index, variant);
  const answer: AnswerDefinition = item.studentResponse
    ? {
        kind: "student_produced_response",
        acceptedResponses: [item.studentResponse],
        normalizeFraction: true,
        normalizeDecimal: true,
        numericTolerance: null,
      }
    : choiceAnswer(item.correct, item.distractors, index + variant);
  return {
    questionType: item.studentResponse ? "student_produced_response" : "single_choice",
    stimulus: item.stimulus,
    prompt: text(item.prompt),
    answer,
    rationale: text(item.rationale),
    metadata: metadata("math", domain, skill, moduleKey, index),
    accessibility: { longDescription: null },
    isPretest: index === 4 || index === 17,
  };
}

export function buildCompleteSatSample(shell: AssessmentAuthoringShell): LoadSampleExamRequest {
  if (shell.providerKey !== "sat")
    throw new Error("Sample loading is only available for SAT drafts.");
  const modules = shell.sections.flatMap((section) =>
    section.modules.map((module) => {
      const questions = Array.from({ length: module.targetQuestionCount }, (_, index) =>
        section.sectionKey === "reading-writing"
          ? readingWritingQuestion(module.moduleKey, index)
          : mathQuestion(module.moduleKey, index)
      );
      const pretests = questions.filter((question) => question.isPretest).length;
      if (pretests !== 2)
        throw new Error(`${module.title} sample must contain exactly two pretest items.`);
      for (const question of questions) {
        const revision = {
          id: "sample",
          questionId: "sample",
          semanticRevision: 1,
          revision: 0,
          state: "draft" as const,
          questionType: question.questionType,
          stimulus: question.stimulus,
          prompt: question.prompt,
          answer: question.answer,
          rationale: question.rationale,
          metadata: question.metadata,
          accessibility: question.accessibility,
        };
        const issues = validateSatQuestion(section.sectionKey, revision).filter(
          (issue) => issue.blocking
        );
        if (issues.length) throw new Error(`Invalid built-in SAT sample: ${issues[0]!.message}`);
      }
      return { moduleId: module.id, questions };
    })
  );
  const total = modules.reduce((sum, module) => sum + module.questions.length, 0);
  if (total !== 147) throw new Error(`Expected 147 SAT sample questions but generated ${total}.`);
  return {
    expectedVersionId: shell.versionId,
    expectedVersionRevision: shell.versionRevision,
    modules,
  };
}
