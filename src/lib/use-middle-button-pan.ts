"use client";

import { useEffect, type RefObject } from "react";

// Lets the user pan a horizontally overflowing element by holding the middle
// mouse button and dragging. The content follows the cursor, so dragging left
// reveals what is to the right. Only horizontal movement matters.
//
// preventDefault on the press stops the browser's own middle-button autoscroll
// (Windows/Linux Chrome) and Linux primary-selection paste. Middle-clicking a
// link inside the element still opens it in a new tab: auxclick is only
// suppressed when the pointer actually travelled, so a drag cannot open tabs.
//
// While panning the element carries data-panning="true" for styling.
const DRAG_THRESHOLD_PX = 4;

export function useMiddleButtonPan(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    let pointerId: number | null = null;
    let startX = 0;
    let startScrollLeft = 0;
    let moved = false;

    function stop() {
      if (pointerId !== null && element?.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
      pointerId = null;
      element?.removeAttribute("data-panning");
    }

    function onPointerDown(event: PointerEvent) {
      if (!element || event.button !== 1 || element.scrollWidth <= element.clientWidth) {
        return;
      }
      event.preventDefault();
      pointerId = event.pointerId;
      startX = event.clientX;
      startScrollLeft = element.scrollLeft;
      moved = false;
      element.setAttribute("data-panning", "true");
      // Capture keeps the pan alive when the cursor leaves the strip. If the
      // browser refuses (stale pointer id), panning still works inside it.
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!element || event.pointerId !== pointerId) {
        return;
      }
      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) > DRAG_THRESHOLD_PX) {
        moved = true;
      }
      element.scrollLeft = startScrollLeft - deltaX;
    }

    function onPointerEnd(event: PointerEvent) {
      if (event.pointerId === pointerId) {
        stop();
      }
    }

    function onAuxClick(event: MouseEvent) {
      if (event.button === 1 && moved) {
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      }
    }

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerEnd);
    element.addEventListener("pointercancel", onPointerEnd);
    element.addEventListener("auxclick", onAuxClick, true);
    return () => {
      stop();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerEnd);
      element.removeEventListener("pointercancel", onPointerEnd);
      element.removeEventListener("auxclick", onAuxClick, true);
    };
  }, [ref]);
}
