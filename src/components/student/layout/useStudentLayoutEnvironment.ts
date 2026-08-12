import { useEffect, useState } from 'react';
import {
  getStudentCapabilitySnapshot,
  getStudentInteractionCapabilities,
  type StudentInteractionCapabilities,
} from './studentCapabilities';

function getInitialCapabilities(): StudentInteractionCapabilities {
  if (typeof window === 'undefined') {
    return {
      layoutMode: 'wide',
      primaryPointer: 'fine',
      hasTouch: false,
      hasHover: true,
      orientation: 'landscape',
    };
  }

  return getStudentInteractionCapabilities(getStudentCapabilitySnapshot(window));
}

export function useStudentLayoutEnvironment(): StudentInteractionCapabilities {
  const [capabilities, setCapabilities] = useState(getInitialCapabilities);

  useEffect(() => {
    const updateCapabilities = () => {
      setCapabilities(getStudentInteractionCapabilities(getStudentCapabilitySnapshot(window)));
    };

    const mediaQueries = [
      window.matchMedia?.('(pointer: coarse)'),
      window.matchMedia?.('(any-pointer: coarse)'),
      window.matchMedia?.('(hover: hover)'),
    ].filter((query): query is MediaQueryList => Boolean(query));

    updateCapabilities();
    window.addEventListener('resize', updateCapabilities);
    window.addEventListener('orientationchange', updateCapabilities);
    mediaQueries.forEach((query) => query.addEventListener?.('change', updateCapabilities));

    return () => {
      window.removeEventListener('resize', updateCapabilities);
      window.removeEventListener('orientationchange', updateCapabilities);
      mediaQueries.forEach((query) => query.removeEventListener?.('change', updateCapabilities));
    };
  }, []);

  return capabilities;
}
