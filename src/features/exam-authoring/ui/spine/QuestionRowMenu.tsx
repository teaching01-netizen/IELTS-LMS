import { MoreHorizontal } from 'lucide-react';
import { SatMenu } from '@/src/products/sat/ui/Menu';

export interface QuestionRowMenuProps {
  position: number;
  disabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  onDuplicate?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  /** Row menus are contextual; a list-level menu reuses the same items. */
  label?: string | undefined;
  onSelectQuestions?: (() => void) | undefined;
  onOpenImport?: (() => void) | undefined;
  importDisabled?: boolean | undefined;
}

export function QuestionRowMenu({
  position,
  disabled,
  canMoveUp,
  canMoveDown,
  onMove,
  onDuplicate,
  onDelete,
  label,
  onSelectQuestions,
  onOpenImport,
  importDisabled,
}: QuestionRowMenuProps) {
  const isList = Boolean(label);
  return (
    <div className="sat-spine__menu">
      <SatMenu
        compact
        label={label ?? 'Question ' + position + ' actions'}
        icon={MoreHorizontal}
        align="end"
        items={[
          ...(isList
            ? [
                { id: 'select', label: 'Select questions', onSelect: () => onSelectQuestions?.() },
                {
                  id: 'import',
                  label: 'Import questions',
                  disabled: disabled || importDisabled || !onOpenImport,
                  onSelect: () => onOpenImport?.(),
                },
              ]
            : [
                { id: 'duplicate', label: 'Duplicate', disabled: disabled || !onDuplicate, onSelect: () => onDuplicate?.() },
                { id: 'up', label: 'Move up', disabled: disabled || !canMoveUp, onSelect: () => onMove(-1) },
                { id: 'down', label: 'Move down', disabled: disabled || !canMoveDown, onSelect: () => onMove(1) },
              ]),
          ...(isList
            ? []
            : [{ id: 'delete', label: 'Delete', separatorBefore: true, destructive: true, disabled: disabled || !onDelete, onSelect: () => onDelete?.() }]),
        ]}
      />
    </div>
  );
}
