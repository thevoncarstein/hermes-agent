import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { registry } from '@/contrib/registry'
import { stubResizeObserver } from '@/test/jsdom'

import { group, split } from '../model'
import { $treePanePeek } from '../peek'
import { $hiddenTreePanes, $layoutTree, $narrowViewport, declareDefaultTree } from '../store'

import { NarrowOverlays, narrowOverlayWidth } from './narrow-overlays'

// A wide-viewport peek (hover the collapsed sidebar's titlebar button) must show
// the zone exactly as docked — its tab strip and live pane — on an opaque
// surface that floats over every bar, not a stripped-down copy.

beforeAll(() => {
  stubResizeObserver()
})

const disposers: (() => void)[] = []

const registerPane = (id: string, title: string, data: Record<string, unknown>, body: string) => {
  disposers.push(
    registry.register({ area: 'panes', data, id, render: () => <div data-testid={`${id}-body`}>{body}</div>, title })
  )
}

beforeEach(() => {
  window.localStorage.clear()
  // As the app registers it: the titlebar addresses the sidebar by its alias.
  registerPane(
    'sessions',
    'sessions',
    { collapsible: true, placement: 'left', revealAliases: ['chat-sidebar'], width: '237px' },
    'session rows'
  )
  registerPane('bots', 'Bots', { collapsible: true, placement: 'left', width: '260px' }, 'bot roster')
  registerPane('workspace', 'workspace', { placement: 'main', uncloseable: true }, 'chat')
  declareDefaultTree(split('row', [group(['sessions', 'bots']), group(['workspace'])]))
  $narrowViewport.set(false)
  // The titlebar toggle hid the sidebar zone.
  $hiddenTreePanes.set(new Set(['sessions', 'bots']))
})

afterEach(() => {
  cleanup()
  $treePanePeek.set(null)
  $hiddenTreePanes.set(new Set())
  $layoutTree.set(null)
  disposers.splice(0).forEach(dispose => dispose())
})

const overlay = () => document.querySelector<HTMLElement>('[data-narrow-overlay]')
const overlayTab = (paneId: string) => document.querySelector<HTMLElement>(`[data-narrow-overlay-tab="${paneId}"]`)

describe('wide-viewport sidebar peek', () => {
  it('floats the hidden zone with its tab strip on an opaque, window-fixed surface', () => {
    const { getByTestId, queryByTestId } = render(<NarrowOverlays />)

    expect(overlay()).toBeNull()
    act(() => $treePanePeek.set('sessions'))

    expect(getByTestId('sessions-body')).toBeTruthy()
    expect(overlayTab('sessions')).toBeTruthy()
    expect(overlayTab('bots')).toBeTruthy()
    expect(overlay()?.hasAttribute('data-glass-opaque')).toBe(true)
    expect(overlay()?.className).toContain('fixed')

    fireEvent.pointerDown(overlayTab('bots')!, { button: 0 })
    expect(getByTestId('bots-body')).toBeTruthy()
    expect(queryByTestId('sessions-body')).toBeNull()
  })

  it('resolves the titlebar alias to the zone at its front tab, as docked', () => {
    $layoutTree.set(split('row', [group(['sessions', 'bots'], { active: 'bots' }), group(['workspace'])]))
    const { getByTestId } = render(<NarrowOverlays />)

    act(() => $treePanePeek.set('chat-sidebar'))

    expect(getByTestId('bots-body')).toBeTruthy()
    expect(overlayTab('sessions')).toBeTruthy()
  })

  it('is as wide as the open zone, not its minimized rail', () => {
    // jsdom's CSSOM drops the min() wrapper from style.width, so assert the resolution.
    const tree = split('row', [group(['sessions', 'bots'], { minimized: true }), group(['workspace'])])
    const panes = registry.getArea('panes')
    const ctx = { overrides: {}, paneFor: (id: string) => panes.find(p => p.id === id), paneGone: () => false }

    expect(
      narrowOverlayWidth(
        ctx,
        tree,
        panes.find(p => p.id === 'sessions')!
      )
    ).toBe('max(237px, 260px)')
  })

  it('retires the peek when the pointer leaves for the page', () => {
    render(<NarrowOverlays />)
    act(() => $treePanePeek.set('sessions'))

    fireEvent.mouseLeave(overlay()!, { relatedTarget: document.body })

    expect($treePanePeek.get()).toBeNull()
    expect(overlay()).toBeNull()
  })
})
