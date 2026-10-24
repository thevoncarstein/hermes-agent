/**
 * A gateway-hosted group row's right-click menu offers what a local group
 * row's does: open, pin, file into a section, and Delete, which confirms first
 * and then disbands the room on its own authority.
 */

import { host } from '@hermes/plugin-sdk'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { CANONICAL_GROUP_LOCALES } from './canonical-group-locales'
import type { CanonicalRosterRoom } from './canonical-group-roster'
import { CanonicalGroupRow } from './canonical-group-row'
import { BOTS_LOCALES } from './i18n'

// The plugin host registers the plugin's catalog; resolve its English copy here.
vi.mock('@hermes/plugin-sdk', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Read lazily: the catalogs import this very module.
  usePluginI18n: () => (key: string) => {
    const catalog = { ...BOTS_LOCALES.en, canonical: CANONICAL_GROUP_LOCALES.en }
    const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog)

    return typeof value === 'string' ? value : key
  }
}))

const entry: CanonicalRosterRoom = {
  key: 'canonical:remote-1:team:room-1',
  last: null,
  route: { connectionId: 'remote-1', profile: 'team' },
  room: { room_id: 'room-1', name: 'Launch crew', members: [] }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('offers open, pin, move and delete, and deletes only after confirming', async () => {
  const request = vi.spyOn(host, 'requestProfile').mockResolvedValue({ tombstone: { room_id: 'room-1' } } as never)

  render(
    <CanonicalGroupRow
      active={false}
      entry={entry}
      members={[]}
      onNewSection={() => undefined}
      onOpen={() => undefined}
      pinned={false}
      sectionId={null}
    />
  )

  const row = screen.getByRole('button', { name: /^Launch crew/ })
  // The marker that makes the window-wide menu (Reload, Close others…) step aside for the row's own.
  expect(row.hasAttribute('data-hermes-context-menu-trigger')).toBe(true)
  fireEvent.contextMenu(row)
  await screen.findByRole('menuitem', { name: 'Delete group' })
  expect(screen.getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual([
    'Open Group Chat',
    'Pin to top',
    'Move to section',
    'Delete group'
  ])
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete group' }))

  const confirm = await screen.findByRole('button', { name: 'Delete group' })
  expect(request).not.toHaveBeenCalled()
  fireEvent.click(confirm)

  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  const [route, method, params] = request.mock.calls[0]
  expect(route).toMatchObject({ connectionId: 'remote-1', targetProfile: 'team' })
  expect(method).toBe('groups.disband')
  expect(params).toMatchObject({ room_id: 'room-1', profile: 'team' })
})
