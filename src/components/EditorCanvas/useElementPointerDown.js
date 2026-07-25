import { useCallback, useRef } from "react";

// Tracks which diagram element (if any) received the pointerdown that started
// the current gesture. A diagram element's onPointerDown calls register(info)
// during the event's target phase; the canvas container's pointerdown handler
// (which fires afterwards, on bubble) calls consume() to read AND clear it.
//
// Clearing on read is load-bearing: it replaces the old render-scoped
// `let elementPointerDown = null`, so a subsequent pointerdown on empty canvas
// doesn't see a stale element. register/consume are stable references, which is
// what lets the element components be wrapped in React.memo.
export function useElementPointerDown() {
  const ref = useRef(null);

  const register = useCallback((info) => {
    ref.current = info;
  }, []);

  const consume = useCallback(() => {
    const info = ref.current;
    ref.current = null;
    return info;
  }, []);

  return { register, consume };
}
