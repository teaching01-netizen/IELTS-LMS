import {useCallback,type SetStateAction} from 'react';
import type {SpineOverlayKind} from './useOverlayStack';
import {useOverlayStack} from './useOverlayStack';
export function useOverlayToggle(stack:ReturnType<typeof useOverlayStack>,id:string,kind:SpineOverlayKind):[boolean,(next:SetStateAction<boolean>)=>void] {
 const open=(kind==='dialog'?stack.openDialog:stack.openSheet)===id;
 const {requestOpen,close}=stack;
 const set=useCallback((next:SetStateAction<boolean>)=>{const value=typeof next==='function'?next(open):next;if(value)requestOpen(id,kind);else close(id);},[close,id,kind,open,requestOpen]);
 return [open,set];
}
