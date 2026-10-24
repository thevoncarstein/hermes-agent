/**
 * Groups sit in the Bots roster like the bots: one flat list where groups
 * and bots sort together by recency, with no "Group chats" panel at the top
 * and no gateway headings once a group exists (a group can seat bots from
 * several gateways, so no single heading owns it). Gateway-hosted rooms are
 * rows of the same list, with their faces and latest message.
 */

import { describe, expect, it } from 'vitest'

import { canonicalRoomPreview } from './canonical-group-roster'
import type { CanonicalRosterRoom } from './canonical-group-roster'
import { deriveRosterRows } from './roster-pane-derivation'
import { rosterGatewayOptions } from './roster-sections'
import type { RosterRow } from './types'
import { groupRowsBySection } from './user-sections'

const NOW = Date.now()

const bot = (name: string, connectionId: string) => ({ name, connectionId }) as RosterRow

const roster = [bot('alpha', 'local'), bot('beta', 'remote-1')]

function hosted(name: string, updatedSecondsAgo: number, members = ['alpha', 'beta']): CanonicalRosterRoom {
  return {
    key: `canonical:local:default:${name}`,
    last: null,
    route: { connectionId: 'local', profile: 'default' },
    room: {
      room_id: name,
      name,
      updated_at: (NOW - updatedSecondsAgo * 1000) / 1000,
      members: members.map(profile => ({ member_id: `m-${profile}`, profile, handle: profile }))
    }
  }
}

function derive(overrides: Partial<Parameters<typeof deriveRosterRows>[0]> = {}) {
  const activity: Record<string, number> = { alpha: NOW - 60_000, beta: NOW - 3_600_000 }

  return deriveRosterRows({
    roster,
    allMeta: {},
    gatewayFilter: 'all',
    query: '',
    activityFilter: 'all',
    rowKindFilter: 'all',
    groupRooms: {},
    canonicalRooms: [],
    activeRosterKeys: new Set(),
    gatewayOptions: rosterGatewayOptions([], roster),
    activityOf: row => activity[row.name] || 0,
    isPinned: () => false,
    ...overrides
  })
}

const order = (rows: ReturnType<typeof derive>['rosterRows']) =>
  rows.map(row => (row.kind === 'bot' ? row.bot.name : `#${row.name}`))

describe('groups in the flat Bots roster', () => {
  it('keeps gateway headings while the roster lists bots alone', () => {
    expect(derive().showGatewaySections).toBe(true)
  })

  it('drops gateway headings for a flat list once a hosted group exists, sorted with the bots by recency', () => {
    const view = derive({ canonicalRooms: [hosted('Team', 600)] })

    expect(view.showGatewaySections).toBe(false)
    expect(order(view.rosterRows)).toEqual(['alpha', '#Team', 'beta'])
  })

  it('drops gateway headings for a local group chat too', () => {
    const view = derive({
      groupRooms: { Crew: { log: [{ at: NOW, from: { kind: 'user' }, text: 'hi' }], watermarks: {} } as never }
    })

    expect(view.showGatewaySections).toBe(false)
    expect(order(view.rosterRows)[0]).toBe('#Crew')
  })

  it('resolves hosted members to roster bots so the row draws their faces', () => {
    const [row] = derive({ canonicalRooms: [hosted('Team', 600, ['alpha', 'ghost'])] }).rosterRows.filter(
      row => row.kind === 'canonical'
    )

    expect(row.kind === 'canonical' && row.members).toEqual([roster[0], expect.objectContaining({ name: 'ghost' })])
  })

  it('applies the kind filter and the search to hosted rooms', () => {
    const rooms = [hosted('Team', 600)]

    expect(order(derive({ canonicalRooms: rooms, rowKindFilter: 'bots' }).rosterRows)).not.toContain('#Team')
    expect(order(derive({ canonicalRooms: rooms, query: 'tea' }).rosterRows)).toEqual(['#Team'])
    expect(order(derive({ canonicalRooms: rooms, query: '@beta' }).rosterRows)).toContain('#Team')
  })

  it('never files a hosted room into the section of a bot that shares its name', () => {
    const view = derive({ canonicalRooms: [hosted('alpha-room', 600)] })
    const canonical = view.rosterRows.filter(row => row.kind === 'canonical')
    const renamed = canonical.map(row => ({ ...row, name: 'alpha' }))

    const blocks = groupRowsBySection(renamed, [{ id: 's1', name: 'Mine' }], { alpha: { sectionId: 's1' } })

    expect(blocks.find(block => block.id === 's1')?.rows).toEqual([])
    expect(blocks.find(block => block.id === null)?.rows).toHaveLength(1)
  })
})

describe('hosted room preview', () => {
  const room = hosted('Team', 0).room

  it('reads the latest message, naming a member by handle and the user as the user', () => {
    expect(
      canonicalRoomPreview(
        [
          { seq: 1, kind: 'message.user', actor: { kind: 'user' }, payload: { text: 'hello' }, created_at: 10 },
          { seq: 2, kind: 'message', actor: { kind: 'member', id: 'm-beta' }, payload: { text: 'on it' }, created_at: 20 },
          { seq: 3, kind: 'room.activity', payload: { status: 'bounded' }, created_at: 30 }
        ],
        room
      )
    ).toEqual({ at: 20_000, from: 'beta', fromUser: false, text: 'on it' })

    expect(
      canonicalRoomPreview([{ seq: 1, kind: 'message.user', actor: { kind: 'user' }, payload: { text: 'hi' } }], room)
    ).toMatchObject({ fromUser: true, text: 'hi' })
  })

  it('has no preview before the first message', () => {
    expect(canonicalRoomPreview([{ seq: 1, kind: 'room.created', payload: {} }], room)).toBeNull()
  })
})
