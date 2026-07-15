import { useEffect, useRef } from 'react';

const META_ID = 'student-notranslate-meta';
const ACTIVE_CLASS = 'student-translation-guard-active';
const TRANSLATION_MESSAGE =
  'Translation tools detected. Please disable translation and continue in the original language.';

function hasKnownTranslationMarkers(root: HTMLElement): boolean {
  return (
    root.classList.contains('translated-ltr') ||
    root.classList.contains('translated-rtl') ||
    document.querySelector('#goog-gt-tt') != null ||
    document.querySelector('iframe.goog-te-banner-frame') != null ||
    document.querySelector('.goog-te-banner-frame') != null
  );
}

export function useStudentTranslationGuard(
  active: boolean,
  reportViolation: (type: string, message: string, severity: 'medium') => void,
) {
  const reportViolationRef = useRef(reportViolation);
  reportViolationRef.current = reportViolation;

  useEffect(() => {
    if (!active) return;

    const root = document.documentElement;
    const priorTranslate = root.getAttribute('translate');
    const priorNotranslate = root.classList.contains('notranslate');
    const priorActiveClass = root.classList.contains(ACTIVE_CLASS);
    const originalMarker = document.getElementById(META_ID);
    const originalParent = originalMarker?.parentNode ?? null;
    const originalNextSibling = originalMarker?.nextSibling ?? null;
    originalMarker?.remove();

    const ownedMeta = document.createElement('meta');
    ownedMeta.id = META_ID;
    ownedMeta.name = 'google';
    ownedMeta.content = 'notranslate';
    document.head.appendChild(ownedMeta);
    let knownMarkerEpisodeActive = false;

    const ensureMarkers = (): boolean => {
      const tampered =
        root.getAttribute('translate') !== 'no' ||
        !root.classList.contains('notranslate') ||
        !root.classList.contains(ACTIVE_CLASS) ||
        ownedMeta.name !== 'google' ||
        ownedMeta.content !== 'notranslate' ||
        ownedMeta.parentElement !== document.head;

      if (root.getAttribute('translate') !== 'no') root.setAttribute('translate', 'no');
      if (!root.classList.contains('notranslate')) root.classList.add('notranslate');
      if (!root.classList.contains(ACTIVE_CLASS)) root.classList.add(ACTIVE_CLASS);
      document.querySelectorAll(`#${META_ID}`).forEach((marker) => {
        if (marker !== ownedMeta) marker.remove();
      });
      if (ownedMeta.id !== META_ID) ownedMeta.id = META_ID;
      if (ownedMeta.name !== 'google') ownedMeta.name = 'google';
      if (ownedMeta.content !== 'notranslate') ownedMeta.content = 'notranslate';
      if (ownedMeta.parentElement !== document.head) document.head.appendChild(ownedMeta);
      return tampered;
    };

    ensureMarkers();
    const inspect = () => {
      const tampered = ensureMarkers();
      const hasKnownMarkers = hasKnownTranslationMarkers(root);
      if (tampered || (hasKnownMarkers && !knownMarkerEpisodeActive)) {
        reportViolationRef.current('TRANSLATION_DETECTED', TRANSLATION_MESSAGE, 'medium');
      }
      knownMarkerEpisodeActive = hasKnownMarkers;
    };

    const observer = new MutationObserver(inspect);
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'translate'] });
    observer.observe(document.head, { childList: true, subtree: true, attributes: true });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    const intervalId = window.setInterval(inspect, 2_000);
    inspect();

    return () => {
      observer.disconnect();
      window.clearInterval(intervalId);
      ownedMeta.remove();
      if (priorTranslate == null) root.removeAttribute('translate');
      else root.setAttribute('translate', priorTranslate);
      root.classList.toggle('notranslate', priorNotranslate);
      root.classList.toggle(ACTIVE_CLASS, priorActiveClass);
      if (originalMarker && originalParent) {
        if (originalNextSibling?.parentNode === originalParent) {
          originalParent.insertBefore(originalMarker, originalNextSibling);
        } else {
          originalParent.appendChild(originalMarker);
        }
      }
    };
  }, [active]);
}
