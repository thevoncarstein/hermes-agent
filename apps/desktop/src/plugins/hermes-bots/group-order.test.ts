import { describe, expect, it } from 'vitest'

import { sortGroupRosterRows } from './group-order'

const rows = [
  { kind: 'group' as const, name: 'Older', activity: 1, pinned: false },
  { kind: 'bot' as const, name: 'Bot', activity: 2, pinned: false },
  { kind: 'group' as const, name: 'Newer', activity: 3, pinned: false },
  { kind: 'group' as const, name: 'Pinned', activity: 0, pinned: true }
]

describe('room display order', () => {
  it('keeps legacy recency until explicitly ordered, then only replaces room slots within pin bands', () => {
    expect(sortGroupRosterRows(rows, {}).map(row => row.name)).toEqual(['Pinned', 'Newer', 'Bot', 'Older'])
    const rooms = { Older: { rosterOrder: 0 }, Newer: { rosterOrder: 1 } }
    expect(sortGroupRosterRows(rows, rooms).map(row => row.name)).toEqual(['Pinned', 'Older', 'Bot', 'Newer'])
    expect(
      sortGroupRosterRows(
        rows.map(row => ({ ...row, activity: row.name === 'Newer' ? 999 : row.activity })),
        rooms
      )
        .filter(row => row.kind === 'group')
        .map(row => row.name)
    ).toEqual(['Pinned', 'Older', 'Newer'])
    expect(rows[0].name).toBe('Older')
  })
})
