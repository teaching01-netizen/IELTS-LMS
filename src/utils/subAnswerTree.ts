import type { QuestionBlock, SubAnswerTreeNode } from '../types';
import { normalizeAnswerForMatching } from './acceptedAnswers';

export const SUB_ANSWER_TREE_MAX_DEPTH = 10;

export interface SubAnswerTreeValidationIssue {
  field: string;
  message: string;
}

export interface SubAnswerTreeRootDescriptor {
  rootId: string;
  rootNodeId: string;
  rootLabel: string;
  rootNumber: number;
  numberLabel: string;
  leafQuestionIds: string[];
  requiredLeafQuestionIds: string[];
}

export interface SubAnswerTreeLeafDescriptor {
  id: string;
  rootId: string;
  rootNodeId: string;
  rootLabel: string;
  rootNumber: number;
  numberLabel: string;
  nodeId: string;
  prompt: string;
  acceptedAnswers: string[];
  required: boolean;
  depth: number;
}

export interface FlattenSubAnswerTreeResult {
  roots: SubAnswerTreeRootDescriptor[];
  leaves: SubAnswerTreeLeafDescriptor[];
  nextRootNumber: number;
}

function isTreeNode(value: unknown): value is SubAnswerTreeNode {
  return typeof value === 'object' && value !== null && 'id' in value;
}

function isNodeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nextGeneratedNodeId(existingIds: Set<string>): string {
  let counter = 1;
  let candidate = `tree-node-${counter}`;
  while (existingIds.has(candidate)) {
    counter += 1;
    candidate = `tree-node-${counter}`;
  }
  return candidate;
}

function collectExistingIds(nodes: unknown, target: Set<string>): void {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((node) => {
    if (!isNodeObject(node)) return;
    const id = typeof node.id === 'string' ? node.id.trim() : '';
    if (id) {
      target.add(id);
    }
    collectExistingIds(node.children, target);
  });
}

function normalizeNodeTree(
  node: Record<string, unknown>,
  assignedIds: Set<string>,
  forbiddenIds: Set<string>,
): SubAnswerTreeNode {
  let id = typeof node.id === 'string' ? node.id.trim() : '';
  if (!id || assignedIds.has(id)) {
    id = nextGeneratedNodeId(forbiddenIds);
  }
  assignedIds.add(id);
  forbiddenIds.add(id);

  const label = typeof node.label === 'string' ? node.label : '';
  const acceptedAnswers = Array.isArray(node.acceptedAnswers)
    ? node.acceptedAnswers.filter((entry): entry is string => typeof entry === 'string')
    : undefined;
  const required = typeof node.required === 'boolean' ? node.required : undefined;
  const rawChildren = Array.isArray(node.children)
    ? node.children.filter((child): child is Record<string, unknown> => isNodeObject(child))
    : [];

  const children = rawChildren.map((child) => normalizeNodeTree(child, assignedIds, forbiddenIds));

  return {
    id,
    label,
    acceptedAnswers,
    required,
    children,
  };
}

export function normalizeSubAnswerTree(
  answerTree: readonly SubAnswerTreeNode[] | undefined,
): SubAnswerTreeNode[] {
  const forbiddenIds = new Set<string>();
  collectExistingIds(answerTree, forbiddenIds);
  const assignedIds = new Set<string>();

  const roots = Array.isArray(answerTree)
    ? answerTree.filter((entry): entry is Record<string, unknown> => isNodeObject(entry))
    : [];

  return roots.map((root) => normalizeNodeTree(root, assignedIds, forbiddenIds));
}

export function hasSubAnswerTreeMode(block: QuestionBlock): boolean {
  if (!('subAnswerModeEnabled' in block)) {
    return false;
  }
  const enabled = Boolean((block as QuestionBlock & { subAnswerModeEnabled?: boolean }).subAnswerModeEnabled);
  if (!enabled) {
    return false;
  }
  const tree = (block as QuestionBlock & { answerTree?: SubAnswerTreeNode[] }).answerTree;
  return Array.isArray(tree) && tree.length > 0;
}

function normalizeAcceptedAnswers(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = normalizeAnswerForMatching(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function ensureRootId(blockId: string, rootNodeId: string): string {
  return `${blockId}::tree::root::${rootNodeId}`;
}

function ensureLeafQuestionId(blockId: string, rootNodeId: string, nodeId: string): string {
  return `${blockId}::tree::${rootNodeId}::${nodeId}`;
}

function leafNumberLabel(rootNumber: number, pathSegments: number[]): string {
  const suffix = pathSegments.join('.');
  return suffix ? `${rootNumber}.${suffix}` : `${rootNumber}.1`;
}

function walkTree(
  node: SubAnswerTreeNode,
  path: number[],
  depth: number,
  visit: (entry: { node: SubAnswerTreeNode; path: number[]; depth: number; isLeaf: boolean }) => void,
): void {
  const children = Array.isArray(node.children) ? node.children.filter(isTreeNode) : [];
  const isLeaf = children.length === 0;
  visit({ node, path, depth, isLeaf });
  children.forEach((child, index) => {
    walkTree(child, [...path, index + 1], depth + 1, visit);
  });
}

export function validateSubAnswerTree(
  answerTree: readonly SubAnswerTreeNode[] | undefined,
  fieldPrefix = 'answerTree',
): SubAnswerTreeValidationIssue[] {
  const issues: SubAnswerTreeValidationIssue[] = [];
  const roots = Array.isArray(answerTree) ? answerTree.filter(isTreeNode) : [];

  if (roots.length === 0) {
    issues.push({
      field: fieldPrefix,
      message: 'Sub-answer mode requires at least one root node.',
    });
    return issues;
  }

  const seenNodeIds = new Set<string>();
  let leafCount = 0;

  roots.forEach((root, rootIndex) => {
    walkTree(root, [rootIndex + 1], 1, ({ node, depth, isLeaf, path }) => {
      if (!node.id || !node.id.trim()) {
        issues.push({
          field: `${fieldPrefix}[${rootIndex}]`,
          message: `A node is missing an id at path ${path.join('.')}.`,
        });
      } else if (seenNodeIds.has(node.id)) {
        issues.push({
          field: `${fieldPrefix}[${rootIndex}]`,
          message: `Duplicate node id detected: ${node.id}.`,
        });
      } else {
        seenNodeIds.add(node.id);
      }

      if (depth > SUB_ANSWER_TREE_MAX_DEPTH) {
        issues.push({
          field: `${fieldPrefix}[${rootIndex}]`,
          message: `Sub-answer depth exceeds ${SUB_ANSWER_TREE_MAX_DEPTH} at node ${node.id || '(missing id)'}.`,
        });
      }

      if (isLeaf) {
        leafCount += 1;
        const required = node.required !== false;
        if (required && normalizeAcceptedAnswers(node.acceptedAnswers).length === 0) {
          issues.push({
            field: `${fieldPrefix}[${rootIndex}]`,
            message: `Required leaf ${node.id || '(missing id)'} must define at least one accepted answer.`,
          });
        }
      }
    });
  });

  if (leafCount === 0) {
    issues.push({
      field: fieldPrefix,
      message: 'Sub-answer tree must contain at least one leaf node.',
    });
  }

  return issues;
}

export function flattenSubAnswerTree(
  blockId: string,
  answerTree: readonly SubAnswerTreeNode[] | undefined,
  startRootNumber: number,
): FlattenSubAnswerTreeResult {
  const roots = normalizeSubAnswerTree(answerTree).filter(isTreeNode);
  const rootDescriptors: SubAnswerTreeRootDescriptor[] = [];
  const leafDescriptors: SubAnswerTreeLeafDescriptor[] = [];
  let currentRootNumber = startRootNumber;

  roots.forEach((root) => {
    const rootNumber = currentRootNumber;
    const rootId = ensureRootId(blockId, root.id);
    const rootLabel = root.label?.trim() || root.id;
    const leafIds: string[] = [];
    const requiredLeafIds: string[] = [];

    walkTree(root, [], 1, ({ node, path, depth, isLeaf }) => {
      if (!isLeaf) return;
      const required = node.required !== false;
      const acceptedAnswers = normalizeAcceptedAnswers(node.acceptedAnswers);
      const numberLabel = leafNumberLabel(rootNumber, path.length === 0 ? [1] : path);
      const leafId = ensureLeafQuestionId(blockId, root.id, node.id);

      leafIds.push(leafId);
      if (required) requiredLeafIds.push(leafId);

      leafDescriptors.push({
        id: leafId,
        rootId,
        rootNodeId: root.id,
        rootLabel,
        rootNumber,
        numberLabel,
        nodeId: node.id,
        prompt: node.label?.trim() || '',
        acceptedAnswers,
        required,
        depth,
      });
    });

    rootDescriptors.push({
      rootId,
      rootNodeId: root.id,
      rootLabel,
      rootNumber,
      numberLabel: String(rootNumber),
      leafQuestionIds: leafIds,
      requiredLeafQuestionIds: requiredLeafIds,
    });

    currentRootNumber += 1;
  });

  return {
    roots: rootDescriptors,
    leaves: leafDescriptors,
    nextRootNumber: currentRootNumber,
  };
}

function normalizedAnswerSet(values: readonly string[]): Set<string> {
  const out = new Set<string>();
  values.forEach((value) => {
    const key = normalizeAnswerForMatching(value);
    if (key) out.add(key);
  });
  return out;
}

export function isSubAnswerLeafCorrect(
  acceptedAnswers: readonly string[],
  studentValue: unknown,
): boolean {
  const normalized = normalizeAnswerForMatching(typeof studentValue === 'string' ? studentValue : '');
  if (!normalized) {
    return false;
  }
  return normalizedAnswerSet(acceptedAnswers).has(normalized);
}

export function evaluateSubAnswerRootUnordered(
  leaves: readonly SubAnswerTreeLeafDescriptor[],
  answers: Record<string, unknown>,
): {
  leafCorrectness: Record<string, boolean>;
  rootCorrect: boolean;
} {
  const leafCorrectness: Record<string, boolean> = Object.fromEntries(
    leaves.map((leaf) => [leaf.id, false]),
  );
  const requiredLeaves = leaves.filter((leaf) => leaf.required);
  const studentLeaves = leaves.filter((leaf) => {
    const studentValue = answers[leaf.id];
    const raw = typeof studentValue === 'string' ? studentValue : '';
    return normalizeAnswerForMatching(raw);
  });

  // Build candidate mapping: required leaf -> student leaves that can satisfy it.
  const candidates = new Map<string, string[]>();
  requiredLeaves.forEach((requiredLeaf) => {
    const allowed = studentLeaves
      .filter((studentLeaf) =>
        isSubAnswerLeafCorrect(
          requiredLeaf.acceptedAnswers,
          answers[studentLeaf.id],
        ),
      )
      .map((studentLeaf) => studentLeaf.id);
    candidates.set(requiredLeaf.id, allowed);
  });

  // Maximum bipartite matching (DFS augmenting paths) so one student answer
  // can satisfy at most one required leaf across the entire root pool.
  const studentToRequired = new Map<string, string>();
  const tryAssign = (requiredLeafId: string, seenStudents: Set<string>): boolean => {
    const options = candidates.get(requiredLeafId) ?? [];
    for (const studentLeafId of options) {
      if (seenStudents.has(studentLeafId)) continue;
      seenStudents.add(studentLeafId);
      const occupiedBy = studentToRequired.get(studentLeafId);
      if (!occupiedBy || tryAssign(occupiedBy, seenStudents)) {
        studentToRequired.set(studentLeafId, requiredLeafId);
        return true;
      }
    }
    return false;
  };

  let matchedRequiredCount = 0;
  requiredLeaves.forEach((requiredLeaf) => {
    if (tryAssign(requiredLeaf.id, new Set<string>())) {
      matchedRequiredCount += 1;
    }
  });

  for (const studentLeafId of studentToRequired.keys()) {
    leafCorrectness[studentLeafId] = true;
  }

  return {
    leafCorrectness,
    rootCorrect:
      requiredLeaves.length === 0 || matchedRequiredCount === requiredLeaves.length,
  };
}
