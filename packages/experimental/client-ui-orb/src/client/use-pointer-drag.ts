/**
 * Pointer-drag gesture for the orb. Deltas report through animation frames
 * while the pointer moves and once on release; a gesture that crosses
 * {@link DRAG_THRESHOLD} pixels counts as a drag, so the caller suppresses the
 * click it would otherwise produce. Movement is measured in screen coordinates:
 * the carrier moves the window under the pointer, so client coordinates would
 * fold that movement back into the next delta and make the window lag the
 * pointer.
 */
import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

/** Distance in logical pixels a press travels before it becomes a window drag. */
export const DRAG_THRESHOLD = 4

/** Frames per second the delta report coalesces to; one report per animation frame. */
export interface PointerDragHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
}

/** One drag gesture's handlers and the state its owner renders. */
export interface PointerDragGesture {
  /** Spread on the dragged element. */
  readonly handlers: PointerDragHandlers
  /** Whether the pointer is currently dragging past the threshold. */
  readonly dragging: boolean
  /**
   * Whether the gesture that just ended moved past the click threshold.
   * @returns true when the release belongs to a drag, not to a click.
   */
  readonly moved: () => boolean
}

/**
 * Track one pointer drag and report throttled deltas.
 * @param onDelta - receives the movement since the last report.
 * @returns the element handlers and drag state.
 */
export function usePointerDrag(onDelta: (deltaX: number, deltaY: number) => void): PointerDragGesture {
  const [dragging, setDragging] = useState(false)
  const active = useRef<{
    pointerId: number
    startX: number
    startY: number
    sentX: number
    sentY: number
  } | null>(null)
  const latest = useRef({ x: 0, y: 0 })
  const frame = useRef<number | null>(null)
  const dragged = useRef(false)
  const report = useRef(onDelta)
  report.current = onDelta

  /** Send the movement accumulated since the last report. */
  const flush = useCallback((): void => {
    const gesture = active.current
    /* v8 ignore next -- ending a gesture cancels its queued frame, so a running report always owns one. */
    if (gesture === null) return
    const deltaX = latest.current.x - gesture.sentX
    const deltaY = latest.current.y - gesture.sentY
    if (deltaX === 0 && deltaY === 0) return
    gesture.sentX = latest.current.x
    gesture.sentY = latest.current.y
    report.current(deltaX, deltaY)
  }, [])

  /** Stop owning the gesture without reporting its remainder. */
  const end = useCallback((): void => {
    active.current = null
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    setDragging(false)
  }, [])

  const handlers: PointerDragHandlers = {
    onPointerDown: (event) => {
      if (event.button !== 0 || active.current !== null) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const point = { x: event.screenX, y: event.screenY }
      latest.current = point
      dragged.current = false
      active.current = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        sentX: point.x,
        sentY: point.y,
      }
    },
    onPointerMove: (event) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      latest.current = { x: event.screenX, y: event.screenY }
      if (!dragged.current) {
        const travelled = Math.abs(event.screenX - gesture.startX) >= DRAG_THRESHOLD
          || Math.abs(event.screenY - gesture.startY) >= DRAG_THRESHOLD
        if (!travelled) return
        dragged.current = true
        setDragging(true)
      }
      frame.current ??= requestAnimationFrame(() => {
        frame.current = null
        flush()
      })
    },
    onPointerUp: (event) => {
      const gesture = active.current
      if (gesture === null || gesture.pointerId !== event.pointerId) return
      latest.current = { x: event.screenX, y: event.screenY }
      // A press that never crossed the threshold is a click: it must not move the window.
      if (dragged.current) flush()
      event.currentTarget.releasePointerCapture(event.pointerId)
      end()
    },
    onPointerCancel: (event) => {
      if (active.current?.pointerId !== event.pointerId) return
      end()
    },
  }

  return {
    handlers,
    dragging,
    moved: () => dragged.current,
  }
}
