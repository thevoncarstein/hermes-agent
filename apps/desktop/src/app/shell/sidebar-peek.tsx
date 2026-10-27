import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useRef } from 'react'

import { $treePanePeek } from '@/components/pane-shell/tree/peek'
import { CHAT_SIDEBAR_PANE_ID } from '@/store/layout'
import { $selectedStoredSessionId } from '@/store/session'

const OPEN_DELAY_MS = 250
// Long enough to cross from the button into the panel.
const CLOSE_DELAY_MS = 250

// The pointer is still on the peeked panel, or on a menu it opened (portaled
// outside it): moving there from the button must not retire the peek.
const peekStillInUse = () =>
  document.querySelector('[data-narrow-overlay]:hover, [data-radix-popper-content-wrapper]') !== null

/**
 * Hover the collapsed sidebar's titlebar button to peek at the sidebar zone and
 * pick a chat straight from it. The tree's overlay renders the peek (see
 * `$treePanePeek` / NarrowOverlays): the zone's live panes with its own tab
 * strip, on an opaque surface floating above every zone and bar, so peeking
 * never resizes the layout or reopens the column. A click still toggles the
 * real sidebar. Children pass through untouched while the sidebar is open.
 */
export function SidebarPeek({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const selectedId = useStore($selectedStoredSessionId)
  const peeked = useStore($treePanePeek) !== null
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const openedOn = useRef(selectedId)

  const cancel = () => clearTimeout(timer.current)

  const close = () => {
    cancel()
    $treePanePeek.set(null)
  }

  const scheduleOpen = () => {
    cancel()
    timer.current = setTimeout(() => {
      openedOn.current = $selectedStoredSessionId.get()
      // The sidebar's alias: the overlay shows its zone at the front tab, as docked.
      $treePanePeek.set(CHAT_SIDEBAR_PANE_ID)
    }, OPEN_DELAY_MS)
  }

  const scheduleClose = () => {
    cancel()

    const attempt = () => {
      if (peekStillInUse()) {
        timer.current = setTimeout(attempt, CLOSE_DELAY_MS)

        return
      }

      $treePanePeek.set(null)
    }

    timer.current = setTimeout(attempt, CLOSE_DELAY_MS)
  }

  useEffect(
    () => () => {
      clearTimeout(timer.current)
      $treePanePeek.set(null)
    },
    []
  )

  // Opening the real sidebar retires the peek, and so does picking a chat in it.
  useEffect(() => {
    if (!enabled || (peeked && selectedId !== openedOn.current)) {
      clearTimeout(timer.current)
      $treePanePeek.set(null)
    }
  }, [enabled, peeked, selectedId])

  if (!enabled) {
    return <>{children}</>
  }

  return (
    <span
      className="inline-flex"
      data-pane-peek-trigger=""
      // Clicking toggles the real sidebar; drop the peek with it.
      onClickCapture={close}
      onPointerEnter={scheduleOpen}
      onPointerLeave={scheduleClose}
    >
      {children}
    </span>
  )
}
