/**
 * A hosted group's pin and section are this machine's sidebar layout: they
 * persist in plugin storage under the room's canonical key and come back on
 * the next start, and a cleared entry leaves nothing behind.
 */

import { beforeEach, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => new Map<string, unknown>())

vi.mock('./shared', () => ({
  getPluginCtx: () => ({
    storage: {
      get: (key: string, fallback: unknown) => (storage.has(key) ? storage.get(key) : fallback),
      set: (key: string, value: unknown) => storage.set(key, value)
    }
  })
}))

import {
  $hostedGroupLayout,
  HOSTED_GROUP_LAYOUT_KEY,
  hostedGroupPinned,
  hostedGroupSectionId,
  loadHostedGroupLayout,
  moveHostedGroupToSection,
  toggleHostedGroupPinned
} from './canonical-group-layout'

const KEY = 'canonical:local:default:room-1'

beforeEach(() => {
  storage.clear()
  $hostedGroupLayout.set({})
})

it('persists pin and section across a restart', () => {
  expect(toggleHostedGroupPinned(KEY)).toBe(true)
  moveHostedGroupToSection(KEY, 's1')

  $hostedGroupLayout.set({})
  loadHostedGroupLayout()

  expect(hostedGroupPinned(KEY)).toBe(true)
  expect(hostedGroupSectionId(KEY)).toBe('s1')
})

it('drops the entry once it is neither pinned nor filed', () => {
  toggleHostedGroupPinned(KEY)
  moveHostedGroupToSection(KEY, 's1')
  toggleHostedGroupPinned(KEY)
  moveHostedGroupToSection(KEY, null)

  expect(storage.get(HOSTED_GROUP_LAYOUT_KEY)).toEqual({})
})
