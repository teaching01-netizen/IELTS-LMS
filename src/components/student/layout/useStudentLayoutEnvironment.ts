import { useEffect, useState } from 'react';
import {
  getStudentCapabilitySnapshot,
  getStudentInteractionCapabilities,
  type StudentContentScale,
  type StudentInteractionCapabilities,
} from './studentCapabilities';

function getInitialCapabilities(contentScale?: StudentContentScale): StudentInteractionCapabilities {
  if (typeof window === 'undefined') {
    return {
      layoutMode: 'wide',
      primaryPointer: 'fine',
      hasTouch: false,
      hasHover: true,
      orientation: 'landscape',
    };
  }

  return getStudentInteractionCapabilities(getStudentCapabilitySnapshot(window), contentScale);
}

export function useStudentLayoutEnvironment(
  zoom = 1,
  textScale = 1,
): StudentInteractionCapabilities {
  const [capabilities, setCapabilities] = useState(() =>
    getInitialCapabilities({ zoom, textScale }),
  );

  useEffect(() => {
    const updateCapabilities = () => {
      setCapabilities(
        getStudentInteractionCapabilities(getStudentCapabilitySnapshot(window), { zoom, textScale }),
      );
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
  }, [zoom, textScale]);

  return capabilities;
}
