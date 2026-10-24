/**
 * The gateway-hosted rooms the Bots roster lists beside the bots: each room
 * with the key it opens under and its latest message, for the row preview.
 *
 * `groups.list` carries no message text, so each room's preview is one short
 * `groups.log` page read from its tail.
 */

import { atom, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

import type { CanonicalGroupEvent } from './canonical-group-history'
import { registerCanonicalGroup } from './canonical-group-registry'
import { canonicalGroupRequest, captureCanonicalGroupRoute, discoverCanonicalGroups } from './canonical-groups'
import type { CanonicalGroupRoute, CanonicalRoom } from './canonical-groups'

const PREVIEW_WINDOW = 10
const POLL_MS = 30_000
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

export async function loadCanonicalRosterRooms(route: CanonicalGroupRoute): Promise<CanonicalRosterRoom[]> {
  const { rooms } = await discoverCanonicalGroups(route)

  return Promise.all(
    rooms.map(async room => ({
      key: registerCanonicalGroup(route, room),
      // A failed tail read costs the row its preview, never the row itself.
      last: await roomPreview(route, room).catch(() => null),
      room,
      route
    }))
  )
}

/** The current source's hosted rooms, reloaded on a source switch and polled
 *  while the roster is mounted. A failed load keeps the rows already shown;
 *  the next poll retries. */
export function useCanonicalRosterRooms(): CanonicalRosterRoom[] {
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const refresh = useValue($canonicalRosterRefresh)
  const [rooms, setRooms] = useState<CanonicalRosterRoom[]>([])

  useEffect(() => {
    setRooms([])
  }, [connectionId, profile])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const load = async () => {
      try {
        const next = await loadCanonicalRosterRooms(captureCanonicalGroupRoute())

        if (!cancelled) {
          setRooms(next)
        }
      } catch {
        // No connection yet, or the gateway is unreachable: keep what is shown.
      }

      if (!cancelled) {
        timer = setTimeout(() => void load(), POLL_MS)
      }
    }

    void load()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [connectionId, profile, refresh])

  return rooms
}
