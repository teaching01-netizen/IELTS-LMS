import { createContext } from 'react';

export type SatAnnotationMode = 'none' | 'highlight' | 'underline' | 'note' | 'erase';
export const SatAnnotationModeContext = createContext<SatAnnotationMode>('none');
