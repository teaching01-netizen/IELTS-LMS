import React, { useEffect, useMemo, useState } from 'react';
import type { QuestionBlock, SubAnswerTreeNode } from '../../types';
import { createId } from '../../utils/idUtils';
import { normalizeSubAnswerTree } from '../../utils/subAnswerTree';
import {
  appendSubAnswerLeafAtSlot,
  buildSubAnswerSlotSeeds,
  healSubAnswerTreeForBlock,
} from '../../utils/subAnswerTreeSlots';

interface SubAnswerTreeEditorProps {
  block: QuestionBlock;
  startNumber: number;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  onChangeTree: (nextTree: SubAnswerTreeNode[]) => void;
  onAddSubAnswerAtSlot?: (slotIndex: number) => void;
}

interface NodeRowProps {
  node: SubAnswerTreeNode;
  path: number[];
  depth: number;
  rootNumber: number;
  siblingCount: number;
  onUpdateNode: (path: number[], updater: (node: SubAnswerTreeNode) => SubAnswerTreeNode) => void;
  onRemoveNode: (path: number[]) => void;
  onMoveNode: (path: number[], direction: 'up' | 'down') => void;
  onAddChild: (path: number[]) => void;
}

const MAX_DEPTH = 10;

function getNodeByPath(tree: SubAnswerTreeNode[], path: number[]): SubAnswerTreeNode | null {
  const firstIndex = path[0];
  if (firstIndex === undefined) {
    return null;
  }
  let current: SubAnswerTreeNode | null = tree[firstIndex] ?? null;
  for (let index = 1; index < path.length; index += 1) {
    const childIndex = path[index];
    if (childIndex === undefined) return null;
    const next = current?.children?.[childIndex];
    if (!next) return null;
    current = next;
  }
  return current;
}

function updateNodeByPath(
  tree: SubAnswerTreeNode[],
  path: number[],
  updater: (node: SubAnswerTreeNode) => SubAnswerTreeNode,
): SubAnswerTreeNode[] {
  const updateRecursive = (nodes: SubAnswerTreeNode[], pathIndex: number): SubAnswerTreeNode[] => {
    const targetIndex = path[pathIndex];
    if (targetIndex === undefined) return nodes;
    return nodes.map((node, index) => {
      if (index !== targetIndex) return node;
      if (pathIndex === path.length - 1) {
        return updater(node);
      }
      const nextChildren = updateRecursive(node.children ?? [], pathIndex + 1);
      return {
        ...node,
        children: nextChildren,
      };
    });
  };

  return updateRecursive(tree, 0);
}

function removeNodeByPath(tree: SubAnswerTreeNode[], path: number[]): SubAnswerTreeNode[] {
  const removeRecursive = (nodes: SubAnswerTreeNode[], pathIndex: number): SubAnswerTreeNode[] => {
    const targetIndex = path[pathIndex];
    if (targetIndex === undefined) return nodes;
    if (pathIndex === path.length - 1) {
      return nodes.filter((_, index) => index !== targetIndex);
    }

    return nodes.map((node, index) => {
      if (index !== targetIndex) return node;
      return {
        ...node,
        children: removeRecursive(node.children ?? [], pathIndex + 1),
      };
    });
  };

  return removeRecursive(tree, 0);
}

function reorderNodeByPath(
  tree: SubAnswerTreeNode[],
  path: number[],
  direction: 'up' | 'down',
): SubAnswerTreeNode[] {
  const siblingIndex = path[path.length - 1];
  if (siblingIndex === undefined) {
    return tree;
  }
  const parentPath = path.slice(0, -1);
  const siblings =
    parentPath.length === 0
      ? tree
      : getNodeByPath(tree, parentPath)?.children ?? [];

  const swapIndex = direction === 'up' ? siblingIndex - 1 : siblingIndex + 1;
  if (swapIndex < 0 || swapIndex >= siblings.length) {
    return tree;
  }

  const reorderedSiblings = [...siblings];
  const current = reorderedSiblings[siblingIndex];
  const other = reorderedSiblings[swapIndex];
  if (!current || !other) return tree;
  reorderedSiblings[siblingIndex] = other;
  reorderedSiblings[swapIndex] = current;

  if (parentPath.length === 0) {
    return reorderedSiblings;
  }

  return updateNodeByPath(tree, parentPath, (node) => ({
    ...node,
    children: reorderedSiblings,
  }));
}

function nodeLabel(rootNumber: number, path: number[]): string {
  if (path.length <= 1) {
    return `${rootNumber}`;
  }
  const suffix = path.slice(1).map((index) => index + 1).join('.');
  return suffix ? `${rootNumber}.${suffix}` : `${rootNumber}`;
}

function parseAcceptedAnswers(value: string): string[] {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function stringifyAcceptedAnswers(values: string[] | undefined): string {
  return (values ?? []).join('\n');
}

function NodeRow({
  node,
  path,
  depth,
  rootNumber,
  siblingCount,
  onUpdateNode,
  onRemoveNode,
  onMoveNode,
  onAddChild,
}: NodeRowProps) {
  const isRoot = path.length === 0;
  const isLeaf = !node.children || node.children.length === 0;
  const label = nodeLabel(rootNumber, path);

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
          {label}
        </span>
        <input
          type="text"
          value={node.label ?? ''}
          onChange={(event) =>
            onUpdateNode(path, (current) => ({
              ...current,
              label: event.target.value,
            }))
          }
          className="min-w-[220px] flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
          placeholder="Prompt / label"
        />
        <label className="inline-flex items-center gap-1 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={node.required !== false}
            onChange={(event) =>
              onUpdateNode(path, (current) => ({
                ...current,
                required: event.target.checked,
              }))
            }
          />
          Required
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAddChild(path)}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
          disabled={depth >= MAX_DEPTH}
        >
          Add child
        </button>
        <button
          type="button"
          onClick={() => onMoveNode(path, 'up')}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          disabled={isRoot || path[path.length - 1] === 0}
        >
          Move up
        </button>
        <button
          type="button"
          onClick={() => onMoveNode(path, 'down')}
          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          disabled={isRoot || path[path.length - 1] === siblingCount - 1}
        >
          Move down
        </button>
        <button
          type="button"
          onClick={() => onRemoveNode(path)}
          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
          disabled={isRoot}
        >
          Remove
        </button>
      </div>

      {isLeaf ? (
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Accepted answers (one per line)</label>
          <textarea
            value={stringifyAcceptedAnswers(node.acceptedAnswers)}
            onChange={(event) =>
              onUpdateNode(path, (current) => ({
                ...current,
                acceptedAnswers: parseAcceptedAnswers(event.target.value),
              }))
            }
            rows={3}
            className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
            placeholder="answer one\nanswer two"
          />
        </div>
      ) : null}

      {Array.isArray(node.children) && node.children.length > 0 ? (
        <div className="space-y-2 border-l-2 border-gray-100 pl-3">
          {node.children.map((child, childIndex) => (
            <NodeRow
              key={child.id || `${label}-child-${childIndex}`}
              node={child}
              path={[...path, childIndex]}
              depth={depth + 1}
              rootNumber={rootNumber}
              siblingCount={node.children?.length ?? 0}
              onUpdateNode={onUpdateNode}
              onRemoveNode={onRemoveNode}
              onMoveNode={onMoveNode}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SubAnswerTreeEditor({
  block,
  startNumber,
  enabled,
  onToggle,
  onChangeTree,
  onAddSubAnswerAtSlot,
}: SubAnswerTreeEditorProps) {
  const treeBlock = block as QuestionBlock & { answerTree?: SubAnswerTreeNode[] };
  const [isExpanded, setIsExpanded] = useState(false);

  const answerTree = useMemo(() => {
    const rawTree = treeBlock.answerTree;
    const hasRawTree = Array.isArray(rawTree) && rawTree.length > 0;
    if (!enabled && !hasRawTree) {
      return normalizeSubAnswerTree(rawTree);
    }
    return healSubAnswerTreeForBlock(block, startNumber, rawTree);
  }, [block, enabled, startNumber, treeBlock.answerTree]);

  useEffect(() => {
    const rawTree = treeBlock.answerTree ?? [];
    if (JSON.stringify(rawTree) !== JSON.stringify(answerTree)) {
      onChangeTree(answerTree);
    }
  }, [answerTree, onChangeTree, treeBlock.answerTree]);

  const updateNode = (path: number[], updater: (node: SubAnswerTreeNode) => SubAnswerTreeNode) => {
    onChangeTree(updateNodeByPath(answerTree, path, updater));
  };

  const removeNode = (path: number[]) => {
    onChangeTree(removeNodeByPath(answerTree, path));
  };

  const moveNode = (path: number[], direction: 'up' | 'down') => {
    onChangeTree(reorderNodeByPath(answerTree, path, direction));
  };

  const slotSeeds = useMemo(() => buildSubAnswerSlotSeeds(block, startNumber), [block, startNumber]);
  const editedRootIndexes = useMemo(
    () =>
      answerTree
        .map((root, index) => ({ root, index }))
        .filter(({ root }) => (root.children?.length ?? 0) > 1)
        .map(({ index }) => index),
    [answerTree],
  );

  const addChild = (path: number[]) => {
    const currentNode = getNodeByPath(answerTree, path);
    if (!currentNode) return;
    if (path.length + 1 > MAX_DEPTH) return;

    updateNode(path, (node) => {
      const { acceptedAnswers: _ignored, ...rest } = node;
      return {
        ...rest,
        children: [
          ...(node.children ?? []),
          {
            id: createId('node'),
            label: '',
            acceptedAnswers: [],
            required: true,
          },
        ],
      };
    });
  };

  const ensureInitialTree = () => {
    onChangeTree(healSubAnswerTreeForBlock(block, startNumber, treeBlock.answerTree));
  };

  const createSubAnswerFromSlot = (slotIndex: number) => {
    if (onAddSubAnswerAtSlot) {
      onAddSubAnswerAtSlot(slotIndex);
      return;
    }

    onToggle(true);
    onChangeTree(appendSubAnswerLeafAtSlot(block, startNumber, treeBlock.answerTree, slotIndex));
  };

  return (
    <div className="mt-3 rounded-md border border-blue-200 bg-blue-50/40 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Sub-answer tree mode</h4>
          <p className="text-xs text-gray-600">
            Dot labels preview and root-level scoring. Depth limit: {MAX_DEPTH}.
          </p>
        </div>
        <label className="inline-flex items-center gap-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-800">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              const nextEnabled = event.target.checked;
              onToggle(nextEnabled);
              if (nextEnabled) {
                ensureInitialTree();
              }
            }}
          />
          Enable
        </label>
      </div>

      {!enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">Quick add sub-answer from a question:</p>
          <div className="flex flex-wrap gap-2">
            {slotSeeds.map((slot, slotIndex) => (
              <button
                key={`${slot.numberLabel}-${slotIndex}`}
                type="button"
                onClick={() => createSubAnswerFromSlot(slotIndex)}
                className="inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                title={slot.prompt || `Question ${slot.numberLabel}`}
                aria-label={`Add sub-answer to question ${slot.numberLabel}`}
              >
                <span aria-hidden="true">＋</span>
                <span>{slot.numberLabel}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {enabled ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              className="rounded border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              {isExpanded ? 'Hide tree editor' : 'Open tree editor'}
            </button>
          </div>
          <p className="text-xs text-gray-600">
            Editing only questions that currently have extra sub-answers.
          </p>

          {!isExpanded ? (
            <p className="text-xs text-gray-600">Tree editor is collapsed. Use row icons or open the editor.</p>
          ) : editedRootIndexes.length === 0 ? (
            <p className="text-xs text-gray-600">No sub-answer rows yet. Use the + icon on a question to add one.</p>
          ) : (
            editedRootIndexes.map((index) => {
              const root = answerTree[index];
              if (!root) return null;
              return (
                <NodeRow
                  key={root.id || `root-${index}`}
                  node={root}
                  path={[index]}
                  depth={1}
                  rootNumber={startNumber + index}
                  siblingCount={answerTree.length}
                  onUpdateNode={updateNode}
                  onRemoveNode={removeNode}
                  onMoveNode={moveNode}
                  onAddChild={addChild}
                />
              );
            })
          )}
        </div>
      ) : (
        <p className="text-xs text-gray-600">Legacy block mode remains active.</p>
      )}
    </div>
  );
}
