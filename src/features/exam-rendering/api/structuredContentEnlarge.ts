import type { ReactNode } from "react";

export interface SatImageEnlargeProps {
  label: string;
  enlargeId: string;
  src: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  returnFocusSelector: string;
}

export type SatImageEnlargeSlot = (props: SatImageEnlargeProps) => ReactNode;
