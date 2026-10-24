/**
 * Opening the Bots panel lists the gateway-hosted rooms. The list must not
 * wait on the slowest room's preview, a load that fails while the backend
 * settles must retry within seconds rather than at the 30 s poll, and a
 * reopened panel paints the rooms it already knows.
 */

import type * as HermesSdk from '@hermes/plugin-sdk'
import { host } from '@hermes/plugin-sdk'
import { act, renderHook } from '@testing-library/react'
import type { WritableAtom } from 'nanostores'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const { requestProfile } = vi.hoisted(() => ({ requestProfile: vi.fn() }))

vi.mock('@hermes/plugin-sdk', async importOriginal => {
  const sdk = await importOriginal<typeof HermesSdk>()

  return {
    ...sdk,
    host: {
      ...sdk.host,
      requestProfile,
      state: { ...sdk.host.state, connectionId: sdk.atom<string | null>('local'), profile: sdk.atom('default') }
    }
  }
})

import { useCanonicalRosterRooms } from './canonical-group-roster'

const room = {
  room_id: 'room-a',
  name: 'Team',
  members: [{ member_id: 'alice', profile: 'alice', handle: 'alice' }],
  latest_seq: 3
}

const tail = {
  events: [{ seq: 3, kind: 'message.member', actor: { kind: 'member', id: 'alice' }, payload: { text: 'hello' }, created_at: 100 }]
}

type Handler = (params: Record<string, unknown>) => Promise<unknown>

let sourceCount = 0

/** Each test reads its own source, so the roster's cross-mount cache never leaks between tests. */
function useFreshSource() {
  sourceCount += 1
  ;(host.state.connectionId as WritableAtom<string | null>).set(`source-${sourceCount}`)
}

function respond(handlers: Record<string, Handler>) {
  requestProfile.mockImplementation((_route, method: string, params: Record<string, unknown>) => {
    const handler = handlers[method]

    return handler ? handler(params) : Promise.reject(new Error(`unexpected ${method}`))
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => (resolve = r))

  return { promise, resolve }
}

const methods = () => requestProfile.mock.calls.map(call => call[1])
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
  requestProfile.mockReset()
  useFreshSource()
})

afterEach(() => {
  vi.useRealTimers()
})

it('retries a load that fails while the backend settles within seconds, not at the 30 s poll', async () => {
  let listCalls = 0

  respond({
    'groups.list': async () => {
      listCalls += 1

      if (listCalls === 1) {
        throw new Error('Backend for "default" is reconnecting; retry after it settles.')
      }

      return { rooms: [room], next_offset: null }
    },
    'groups.log': async () => tail
  })

  const { result } = renderHook(() => useCanonicalRosterRooms())
  await advance(0)
  expect(result.current).toEqual([])

  await advance(1_000)
  expect(result.current.map(row => [row.room.name, row.last?.text])).toEqual([['Team', 'hello']])
})

it('bounds the quick retries and then falls back to the poll', async () => {
  respond({ 'groups.list': async () => Promise.reject(new Error('unreachable')) })

  renderHook(() => useCanonicalRosterRooms())
  await advance(0)
  await advance(1_000 + 2_000 + 4_000)
  expect(methods()).toHaveLength(4)

  await advance(29_999)
  expect(methods()).toHaveLength(4)
  await advance(1)
  expect(methods()).toHaveLength(5)
})

it('lists rooms before their previews arrive, without a groups.capabilities round trip', async () => {
  const slowTail = deferred<typeof tail>()

  respond({
    'groups.list': async () => ({ rooms: [room], next_offset: null }),
    'groups.log': () => slowTail.promise
  })

  const { result } = renderHook(() => useCanonicalRosterRooms())
  await advance(0)
  expect(result.current.map(row => [row.room.name, row.last])).toEqual([['Team', null]])

  await act(async () => slowTail.resolve(tail))
  expect(result.current[0]?.last?.text).toBe('hello')
  expect(methods()).not.toContain('groups.capabilities')
})

it('paints the known rooms at once on reopen and keeps a preview whose room has not moved', async () => {
  respond({
    'groups.list': async () => ({ rooms: [room], next_offset: null }),
    'groups.log': async () => tail
  })

  const first = renderHook(() => useCanonicalRosterRooms())
  await advance(0)
  first.unmount()
  requestProfile.mockClear()

  const relist = deferred<{ rooms: (typeof room)[]; next_offset: null }>()
  respond({ 'groups.list': () => relist.promise, 'groups.log': async () => tail })

  const { result } = renderHook(() => useCanonicalRosterRooms())
  expect(result.current.map(row => [row.room.name, row.last?.text])).toEqual([['Team', 'hello']])

  await act(async () => relist.resolve({ rooms: [room], next_offset: null }))
  expect(result.current[0]?.last?.text).toBe('hello')
  expect(methods()).toEqual(['groups.list'])
})
