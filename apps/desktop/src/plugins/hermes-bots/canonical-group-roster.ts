/**
 * The gateway-hosted rooms the Bots roster lists beside the bots: each room
 * with the key it opens under and its latest message, for the row preview.
 *
 * `groups.list` carries no message text, so each room's preview is one short
 * `groups.log` page read from its tail. Rows publish as soon as the list
 * answers; previews fill in after, so one slow tail read never holds the list.
 */

import { atom, host, useValue } from '@hermes/plugin-sdk'
import { useEffect } from 'react'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { registerCanonicalGroup } from './canonical-group-registry'
import { canonicalGroupRequest, captureCanonicalGroupRoute, discoverCanonicalRooms } from './canonical-groups'
import type { CanonicalGroupRoute, CanonicalRoom } from './canonical-groups'

const PREVIEW_WINDOW = 10
const POLL_MS = 30_000
/** A failed load (the panel opening before its backend answers) retries on
 *  these delays before falling back to the poll. */
const RETRY_MS = [1_000, 2_000, 4_000]
const MESSAGE_KINDS = new Set(['message', 'message.user', 'message.member'])

export interface CanonicalRoomPreview {
  /** Epoch milliseconds. */
  at: number
  from: string
  fromUser: boolean
  text: string
}

export interface CanonicalRosterRoom {
  key: string
  last: CanonicalRoomPreview | null
  room: CanonicalRoom
  route: CanonicalGroupRoute
}

const NO_ROOMS: CanonicalRosterRoom[] = []

/** The last rooms listed and the source they came from, so a reopened panel
 *  paints them at once while it refreshes. */
const $canonicalRosterRooms = atom<{ source: string; rooms: CanonicalRosterRoom[] }>({ source: '', rooms: NO_ROOMS })

function rosterSource(route: CanonicalGroupRoute): string {
  return JSON.stringify([route.connectionId, route.profile])
}

const $canonicalRosterRefresh = atom(0)

/** Reload the hosted rooms now, e.g. right after one is created here. */
export function refreshCanonicalRosterRooms() {
  $canonicalRosterRefresh.set($canonicalRosterRefresh.get() + 1)
}

export function canonicalRoomPreview(events: CanonicalGroupEvent[], room: CanonicalRoom): CanonicalRoomPreview | null {
  const last = events.filter(event => MESSAGE_KINDS.has(event.kind)).at(-1)

  if (!last) {
    return null
  }

  const fromUser = last.actor?.kind === 'user' || last.kind === 'message.user'
  const member = room.members.find(candidate => candidate.member_id === last.actor?.id)

  return {
    at: (last.created_at ?? 0) * 1000,
    from: fromUser ? '' : member?.handle || last.actor?.display_name || last.actor?.id || '',
    fromUser,
    text: last.payload.text || last.payload.content || ''
  }
}

async function roomPreview(route: CanonicalGroupRoute, room: CanonicalRoom) {
  const latest = room.latest_seq ?? 0

  if (latest <= 0) {
    return null
  }

  const page = await canonicalGroupRequest<{ events: CanonicalGroupEvent[] }>(route, 'groups.log', {
    room_id: room.room_id,
    since_seq: Math.max(0, latest - PREVIEW_WINDOW),
    limit: PREVIEW_WINDOW
  })

  return canonicalRoomPreview(page.events, room)
}

/** List `route`'s rooms into the roster now, each row keeping its previous
 *  preview, then reread the tail of every room that moved since. `isCurrent`
 *  turns false once a newer load or a source switch supersedes this one. */
async function syncCanonicalRosterRooms(route: CanonicalGroupRoute, isCurrent: () => boolean): Promise<void> {
  const source = rosterSource(route)
  const listed = await discoverCanonicalRooms(route)

  if (!isCurrent()) {
    return
  }

  const cached = $canonicalRosterRooms.get()
  const previous = new Map(cached.source === source ? cached.rooms.map(row => [row.key, row]) : [])

  const rows = listed.map(room => {
    const key = registerCanonicalGroup(route, room)

    return { key, last: previous.get(key)?.last ?? null, room, route }
  })

  $canonicalRosterRooms.set({ source, rooms: rows })

  await Promise.all(
    rows.map(async row => {
      const before = previous.get(row.key)

      if (before?.last && before.room.latest_seq === row.room.latest_seq) {
        return
      }

      // A failed tail read keeps the row and whatever preview it had.
      const last = await roomPreview(route, row.room).catch(() => row.last)
      const current = $canonicalRosterRooms.get()

      if (isCurrent() && last !== row.last && current.source === source) {
        $canonicalRosterRooms.set({ source, rooms: current.rooms.map(r => (r.key === row.key ? { ...r, last } : r)) })
      }
    })
  )
}

/** The current source's hosted rooms, reloaded on a source switch and polled
 *  while the roster is mounted. A failed load keeps the rows already shown and
 *  retries within seconds before falling back to the poll. */
export function useCanonicalRosterRooms(): CanonicalRosterRoom[] {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const refresh = useValue($canonicalRosterRefresh)
  const cached = useValue($canonicalRosterRooms)

  useEffect(() => {
    let cancelled = false
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        await syncCanonicalRosterRooms(captureCanonicalGroupRoute(), () => !cancelled)
        failures = 0
      } catch {
        // No connection yet, or its backend is still settling.
        failures += 1
      }

      if (!cancelled) {
        timer = setTimeout(() => void load(), (failures > 0 && RETRY_MS[failures - 1]) || POLL_MS)
      }
    }

    void load()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connectionId, profile, refresh])

  return connectionId !== null && cached.source === rosterSource({ connectionId, profile }) ? cached.rooms : NO_ROOMS
}
