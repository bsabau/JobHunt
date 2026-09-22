"use client";

import { useEffect, type RefObject } from "react";

// Turns a plain vertical mouse-wheel gesture over a horizontally overflowing
// element into sideways scrolling. The element only claims the wheel while it
// can still move in that direction; at either edge the event falls through so
// the page keeps scrolling vertically and the pointer never gets "trapped".
// Shift+wheel and predominantly horizontal gestures (trackpads) are untouched.
//
// A native listener is required: React's synthetic onWheel is registered as
// passive, so calling preventDefault() from it is ignored by the browser.
export function useHorizontalWheelScroll(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    function onWheel(event: WheelEvent) {
      if (!element || event.shiftKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      if (maxScrollLeft <= 0) {
        return;
      }

      const scrollingRight = event.deltaY > 0;
      const atEdge = scrollingRight ? element.scrollLeft >= maxScrollLeft - 1 : element.scrollLeft <= 0;
      if (atEdge) {
        return;
      }

      event.preventDefault();
      element.scrollLeft += event.deltaY;
    }

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [ref]);
}
