import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * What the surrounding delivery guarantees about exam interactions.
 *
 * A capability, not a verdict. Selection infrastructure asks this context what
 * the session it is rendering in allows; it never works that out for itself by
 * reading a route name, a user agent, a CSS class, or whether a highlight tool
 * happens to be armed. Those are guesses that are right until someone adds a
 * second caller, and the failure mode is silent: a staff preview that quietly
 * behaves like a locked exam, or an exam that quietly does not.
 *
 * `ownedTouchSelection` means: this is a real student sitting a real exam, its
 * prose is `user-select: none` under a coarse pointer, and the app — not the
 * platform — owns the selection gesture. Without it, the platform's own
 * selection is the only one there is, which is what every authoring surface and
 * every preview wants.
 *
 * Two responsibilities that look alike and are not:
 *
 *   exam scope      → WHO owns the selection gesture      (this context)
 *   armed tool      → WHAT happens to a selection         (tool state)
 *
 * They are declared in different places on purpose. Gating the gesture on the
 * tool would answer the first question with the second, and would make a preview
 * that arms a colour swatch silently take over the mouse.
 */
export interface StudentExamInteractionScope {
  ownedTouchSelection: boolean;
}

const OUTSIDE_ANY_EXAM: StudentExamInteractionScope = { ownedTouchSelection: false };

const StudentExamInteractionScopeContext = createContext<StudentExamInteractionScope | null>(null);

export function StudentExamInteractionScopeProvider({
  ownedTouchSelection,
  children,
}: {
  ownedTouchSelection: boolean;
  children: ReactNode;
}) {
  const value = useMemo<StudentExamInteractionScope>(
    () => ({ ownedTouchSelection }),
    [ownedTouchSelection],
  );

  return (
    <StudentExamInteractionScopeContext.Provider value={value}>
      {children}
    </StudentExamInteractionScopeContext.Provider>
  );
}

/**
 * The declared scope, or the conservative default.
 *
 * Reading outside the provider is not an error — it is the honest answer for
 * every surface that is not real student delivery, and it must stay safe by
 * default rather than by every caller remembering to say so.
 */
export function useStudentExamInteractionScope(): StudentExamInteractionScope {
  return useContext(StudentExamInteractionScopeContext) ?? OUTSIDE_ANY_EXAM;
}
