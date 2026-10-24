import { useStore } from '@nanostores/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
const pickPaths = vi.hoisted(() => vi.fn())
vi.mock('./shared', () => ({ getPluginCtx: () => ({ os: { pickPaths } }) }))
vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const gateway = createGroupGateway()
  const { en } = await import('@/i18n/en')
  const { CANONICAL_GROUP_LOCALES } = await import('./canonical-group-locales')

  return { ...await pluginSdkMock(gateway.host), atom, useValue: useStore,
    useI18n: () => ({ t: en }),
    usePluginI18n: () => (key: string) => CANONICAL_GROUP_LOCALES.en[key.replace('canonical.', '') as keyof typeof CANONICAL_GROUP_LOCALES.en] ?? key,
    Button: (p: ComponentProps<'button'>) => <button {...p} />,
    host: { ...gateway.host, requestProfile: request } }
})
import { hostedProjectScope, readGroupProjectFolder, writeGroupProjectFolder } from './canonical-group-context'
import { CanonicalGroupWorkspace } from './canonical-group-workspace'

const binding = { connectionId: 'local', profile: 'team', roomId: 'room-1', roomName: 'Room' }
const originalDesktop = window.hermesDesktop
beforeEach(() => {
  Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined })
  request.mockImplementation(async (_route, method) => method === 'groups.state'
    ? { room: { name: 'Room', members: [] }, driver_status: {} } : method === 'groups.log' ? { events: [] } : {})
})
afterEach(() => { cleanup(); request.mockReset(); pickPaths.mockReset(); localStorage.clear(); window.hermesDesktop = originalDesktop })

it('has no Back or Stop; Delete disbands the room on its authority and closes it', async () => {
  writeGroupProjectFolder(hostedProjectScope(binding, binding.roomId), '/work/app')
  const deleted = vi.fn()
  render(<CanonicalGroupWorkspace binding={binding} onDeleted={deleted} />)
  await screen.findByText('Room')
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()

  await waitFor(() => expect((screen.getByRole('button', { name: 'Delete group' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Delete group' }))
  expect(request.mock.calls.some(c => c[1] === 'groups.disband')).toBe(false)
  fireEvent.click(screen.getAllByRole('button', { name: 'Delete group' }).at(-1)!)

  await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1))
  const call = request.mock.calls.find(c => c[1] === 'groups.disband')!
  expect(call[0]).toMatchObject({ connectionId: 'local', targetProfile: 'team' })
  expect(call[2]).toMatchObject({ room_id: 'room-1', profile: 'team' })
  expect(request.mock.calls.some(c => c[1] === 'groups.stop')).toBe(false)
  expect(readGroupProjectFolder(hostedProjectScope(binding, binding.roomId))).toBe('')
})

it('sends the project folder and added folders as context, then clears only the added folders', async () => {
  writeGroupProjectFolder(hostedProjectScope(binding, binding.roomId), '/work/app')
  pickPaths.mockResolvedValue(['/work/app/src'])
  render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))

  fireEvent.click(screen.getByRole('menuitem', { name: 'Add folder' }))
  await screen.findByText('src')
  expect(pickPaths).toHaveBeenCalledWith(expect.objectContaining({ directories: true }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Review this' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))

  await waitFor(() => expect(request.mock.calls.some(c => c[1] === 'groups.send')).toBe(true))
  const sent = request.mock.calls.find(c => c[1] === 'groups.send')![2]
  expect(sent.payload.text).toBe('Review this\n\n[Context]\n- Project folder: /work/app\n- Folder: /work/app/src')
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(''))
  expect(screen.queryByText('src')).toBeNull()
  expect(screen.getByText('app')).toBeTruthy()
})
