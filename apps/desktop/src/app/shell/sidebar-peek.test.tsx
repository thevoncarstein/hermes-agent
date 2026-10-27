// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $treePanePeek } from '@/components/pane-shell/tree/peek'
import { CHAT_SIDEBAR_PANE_ID } from '@/store/layout'
import { $selectedStoredSessionId } from '@/store/session'

import { SidebarPeek } from './sidebar-peek'

function renderPeek(enabled: boolean) {
  return render(
    <SidebarPeek enabled={enabled}>
      <button type="button">Show sidebar</button>
    </SidebarPeek>
  )
}

const hover = () => {
  fireEvent.pointerEnter(screen.getByRole('button', { name: 'Show sidebar' }))
  act(() => void vi.advanceTimersByTime(300))
}

describe('SidebarPeek', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    $selectedStoredSessionId.set('a')
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    $treePanePeek.set(null)
  })

  it('peeks the sidebar (by its alias, which the overlay resolves to the zone) on hover', () => {
    renderPeek(true)
    hover()

    expect($treePanePeek.get()).toBe(CHAT_SIDEBAR_PANE_ID)
  })

  it('retires the peek once a chat is picked from it', () => {
    renderPeek(true)
    hover()

    act(() => $selectedStoredSessionId.set('b'))

    expect($treePanePeek.get()).toBeNull()
  })

  it('does not peek while the sidebar is open', () => {
    renderPeek(false)
    hover()

    expect($treePanePeek.get()).toBeNull()
  })
})
