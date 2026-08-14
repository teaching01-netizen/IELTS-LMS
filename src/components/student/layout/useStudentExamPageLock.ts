import { useEffect } from 'react';

/**
 * Scopes document-level locking to the actual exam phase.
 *
 * While active, `html` and `body` receive the `student-exam-active` class so
 * the document can never become the scrolling surface. On leave, the classes
 * are removed and the previous scroll position is restored. Admin, builder,
 * login, lobby, and post-exam screens never receive these classes.
 */
export function useStudentExamPageLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const body = document.body;
    const rootHadActiveClass = root.classList.contains('student-exam-active');
    const bodyHadActiveClass = body.classList.contains('student-exam-active');
    const previousScrollX = window.scrollX;
    const previousScrollY = window.scrollY;

    root.classList.add('student-exam-active');
    body.classList.add('student-exam-active');
    window.scrollTo(0, 0);

    return () => {
      if (!rootHadActiveClass) {
        root.classList.remove('student-exam-active');
      }
      if (!bodyHadActiveClass) {
        body.classList.remove('student-exam-active');
      }
      window.scrollTo(previousScrollX, previousScrollY);
    };
  }, [active]);
}
