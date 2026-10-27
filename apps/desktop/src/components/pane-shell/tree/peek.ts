import { useStore } from '@nanostores/react'
import { atom } from 'nanostores'
import { useEffect } from 'react'

import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import { ESCAPE_PRIORITY, isTopEscapeLayer } from '@/lib/escape-layers'

/** A collapsed pane peeked from its titlebar toggle on a WIDE viewport (hover the
 *  sidebar button): NarrowOverlays floats it over the window exactly as it does
 *  a narrow reveal — live instance, zone tab strip, opaque surface — without
 *  reopening the zone. Null when nothing is peeked. */
export const $treePanePeek = atom<null | string>(null)

type OverlayReveal = { id: string; pinned: boolean } | null

/** Who owns the edge overlay right now. A wide-viewport peek borrows it (`active`
 *  = not narrow, not solo) and is window-fixed above every zone and bar
 *  (terminal, statusbar) but under the titlebar clusters (z-70), so its trigger
 *  stays live; otherwise the narrow reveal owns it, inside the tree. Escape
 *  drops an active peek. */
export function useTreePanePeek(
  narrowReveal: OverlayReveal,
  setNarrowReveal: (update: (current: OverlayReveal) => OverlayReveal) => void,
  active: boolean
) {
  const peekId = useStore($treePanePeek)
  const peeking = active && peekId !== null

  useEffect(() => {
    if (!peeking) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && isTopEscapeLayer(ESCAPE_PRIORITY.narrowOverlay)) {
        event.preventDefault()
        $treePanePeek.set(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => window.removeEventListener('keydown', onKeyDown)
  }, [peeking])

  if (peeking) {
    return {
      peeking,
      reveal: { id: peekId, pinned: false },
      selectTab: (id: string) => $treePanePeek.set(id),
      surfaceClass: 'fixed z-65',
      // As the docked sidebar zone does: its tabs sit below the titlebar band.
      topInset: TITLEBAR_HEIGHT
    }
  }

  return {
    peeking,
    reveal: narrowReveal,
    selectTab: (id: string) => setNarrowReveal(current => ({ id, pinned: current?.pinned ?? false })),
    surfaceClass: 'absolute z-40',
    topInset: 0
  }
}
