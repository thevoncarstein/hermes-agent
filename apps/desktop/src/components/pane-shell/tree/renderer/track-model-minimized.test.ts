import { describe, expect, it } from 'vitest'

import type { Contribution } from '@/contrib/types'

import { group, split } from '../model'

import { fixedTrackSize, MINIMIZED_TRACK } from './track-model'

const panes: Record<string, Partial<Contribution>> = {
  sessions: { data: { placement: 'left', width: '237px' } },
  terminal: { data: { height: '200px' } },
  workspace: { data: { placement: 'main' } }
}

const ctx = { overrides: {}, paneFor: (id: string) => panes[id] as Contribution, paneGone: () => false }

// The sidebar zone minimizes into a vertical rail inside its row; along the
// root column that row must still stretch (it holds the chat), not shrink to
// the rail's 28px strip.
describe('fixedTrackSize across a split with a minimized zone', () => {
  it('keeps a row holding the chat flexible when its sidebar is minimized', () => {
    const top = split('row', [group(['sessions'], { minimized: true }), group(['workspace'])])

    expect(fixedTrackSize(top, 'column', ctx)).toBeNull()
  })

  it('still folds a row whose every zone is minimized to the strip', () => {
    const bottom = split('row', [group(['terminal'], { minimized: true })])

    expect(fixedTrackSize(bottom, 'column', ctx)).toBe(MINIMIZED_TRACK)
  })

  it('still sizes a minimized zone as its strip along its own split', () => {
    const top = split('row', [group(['sessions'], { minimized: true }), group(['workspace'])])

    expect(fixedTrackSize(top, 'row', ctx)).toBeNull()
    expect(fixedTrackSize(group(['sessions'], { minimized: true }), 'row', ctx)).toBe(MINIMIZED_TRACK)
  })
})
