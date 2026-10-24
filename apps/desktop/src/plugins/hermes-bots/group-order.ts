interface OrderRow {
  activity: number
  kind: 'bot' | 'canonical' | 'group'
  name?: string
  pinned: boolean
}

/** Reorder room slots, not bots or folders. Pinning remains the outer band. */
export function sortGroupRosterRows<T extends OrderRow>(
  rows: T[],
  rooms: Record<string, { rosterOrder?: number }>
): T[] {
  const legacy = rows.slice().sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.activity - a.activity)

  const groups = legacy
    .filter(row => row.kind === 'group')
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (rooms[a.name!]?.rosterOrder ?? Infinity) - (rooms[b.name!]?.rosterOrder ?? Infinity)
    )

  let index = 0

  return legacy.map(row => (row.kind === 'group' ? groups[index++] : row))
}
