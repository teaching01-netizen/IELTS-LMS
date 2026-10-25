import { useCallback } from 'react';
import { useReducedMotion } from 'motion/react';
import { useNavigate, type NavigateFunction, type NavigateOptions, type To } from 'react-router-dom';

/** Route changes stay immediate; the data router owns interruption and fallback. */
export function useSatNavigate(): NavigateFunction {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  return useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') return navigate(to);
    return navigate(to, { viewTransition: !reducedMotion, ...options });
  }, [navigate, reducedMotion]) as NavigateFunction;
}
