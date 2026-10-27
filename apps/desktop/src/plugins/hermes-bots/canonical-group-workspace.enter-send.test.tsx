import { useStore } from '@nanostores/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const request = vi.hoisted(() => vi.fn())
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
import { CanonicalGroupWorkspace } from './canonical-group-workspace'
const originalDesktop = window.hermesDesktop
const binding = { connectionId: 'local', profile: 'team', roomId: 'enter-send' }
const sends = () => request.mock.calls.filter(c => c[1] === 'groups.send')

const openComposer = async () => {
  request.mockImplementation(async (_route, method) => method === 'groups.state'
    ? { room: { name: 'Room' }, driver_status: {} } : method === 'groups.log' ? { events: [] } : {})
  render(<CanonicalGroupWorkspace binding={binding} />)
  await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false))
  await screen.findByText('Room')
}

beforeEach(() => { Object.defineProperty(window, 'hermesDesktop', { configurable: true, writable: true, value: undefined }) })
afterEach(() => { cleanup(); request.mockReset(); localStorage.clear(); window.hermesDesktop = originalDesktop })

it('sends the draft when Enter is pressed in the composer', async () => {
  await openComposer()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship it' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  await waitFor(() => expect(sends()).toHaveLength(1))
  expect(sends()[0][2].payload.text).toBe('Ship it')
})

it('keeps Shift+Enter as a newline and never sends an empty draft', async () => {
  await openComposer()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'line one' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sends()).toHaveLength(0)
})

it('does not send when Enter confirms an IME composition', async () => {
  await openComposer()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'にほんご' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', keyCode: 229 })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sends()).toHaveLength(0)
})
