import { createContext } from 'react';

export type SatAnnotationMode = 'none' | 'highlight' | 'underline' | 'note';
export const SatAnnotationModeContext = createContext<SatAnnotationMode>('none');
