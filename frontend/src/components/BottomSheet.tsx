import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ReactNode } from "react";

const PEEK_HEIGHT = 64;
const EXPANDED_RATIO = 0.75;

interface Props {
  children: ReactNode;
  peekContent?: ReactNode;
}

export interface BottomSheetHandle {
  collapse: () => void;
}

export const BottomSheet = forwardRef<BottomSheetHandle, Props>(
  ({ children, peekContent }, ref) => {
    const [expanded, setExpanded] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const dragging = useRef(false);
    const dragStartY = useRef(0);
    const dragStartHeight = useRef(0);
    const lastTouchY = useRef(0);
    const lastTouchTime = useRef(0);
    const velocity = useRef(0);
    // Capture height once to avoid jumps from mobile address bar show/hide
    const expandedHeight = useRef(window.innerHeight * EXPANDED_RATIO);
    const currentHeight = expanded ? expandedHeight.current : PEEK_HEIGHT;

    useImperativeHandle(ref, () => ({
      collapse: () => setExpanded(false),
    }));

    const handleTouchStart = useCallback(
      (e: React.TouchEvent) => {
        dragging.current = true;
        dragStartY.current = e.touches[0].clientY;
        // Recapture on drag start in case orientation changed
        expandedHeight.current = window.innerHeight * EXPANDED_RATIO;
        dragStartHeight.current = expanded ? expandedHeight.current : PEEK_HEIGHT;
        lastTouchY.current = e.touches[0].clientY;
        lastTouchTime.current = Date.now();
        velocity.current = 0;
        sheetRef.current?.classList.add("dragging");
      },
      [expanded],
    );

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
      if (!dragging.current || !sheetRef.current) return;

      const now = Date.now();
      const dt = now - lastTouchTime.current;
      if (dt > 0) {
        velocity.current = (lastTouchY.current - e.touches[0].clientY) / dt; // positive = dragging up
      }
      lastTouchY.current = e.touches[0].clientY;
      lastTouchTime.current = now;

      const dy = dragStartY.current - e.touches[0].clientY;
      const newHeight = Math.max(
        PEEK_HEIGHT,
        Math.min(expandedHeight.current, dragStartHeight.current + dy),
      );
      sheetRef.current.style.height = `${newHeight}px`;
    }, []);

    const handleTouchEnd = useCallback(() => {
      if (!dragging.current || !sheetRef.current) return;
      dragging.current = false;
      sheetRef.current.classList.remove("dragging");
      sheetRef.current.style.height = "";

      // Use velocity to determine direction — fast flick overrides position
      if (Math.abs(velocity.current) > 0.3) {
        setExpanded(velocity.current > 0); // positive velocity = dragging up = expand
      } else {
        // Slow drag — snap based on position
        const dy = dragStartY.current - lastTouchY.current;
        const finalHeight = dragStartHeight.current + dy;
        const mid = (PEEK_HEIGHT + expandedHeight.current) / 2;
        setExpanded(finalHeight > mid);
      }
    }, []);

    const handleTap = useCallback(() => {
      if (!expanded) setExpanded(true);
    }, [expanded]);

    return (
      <div
        ref={sheetRef}
        className={`bottom-sheet ${expanded ? "expanded" : "peek"}`}
        style={{ height: `${currentHeight}px` }}
      >
        <div
          className="bottom-sheet-handle"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleTap}
        >
          <div className="bottom-sheet-bar" />
          {peekContent && <div className="bottom-sheet-peek">{peekContent}</div>}
        </div>
        <div className="bottom-sheet-content">
          {children}
          <div className="bottom-sheet-fade" />
        </div>
      </div>
    );
  },
);
