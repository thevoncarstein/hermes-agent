import { useStore } from '@nanostores/react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ComponentProps } from 'react'
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'

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

// jsdom has no layout: give the log a tall content box and a writable scrollTop.
const scrollTops = new WeakMap<Element, number>()
const scrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')
const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get() { return this.getAttribute('role') === 'log' ? 4000 : 0 } })
  Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return scrollTops.get(this) ?? 0 }, set(value: number) { scrollTops.set(this, value) } })
})
afterAll(() => {
  Object.defineProperty(Element.prototype, 'scrollHeight', scrollHeight!)
  Object.defineProperty(Element.prototype, 'scrollTop', scrollTop!)
})
afterEach(() => { cleanup(); request.mockReset(); localStorage.clear() })

it('opens a group chat at its latest message, not the top of the history', async () => {
  const events = Array.from({ length: 40 }, (_, index) => ({
    seq: index + 1, kind: 'message.member', actor: { kind: 'member', id: 'm1', display_name: 'Bot' }, payload: { text: `reply ${index + 1}` }
  }))

  request.mockImplementation(async (_route, method) => method === 'groups.state'
    ? { room: { name: 'Room' }, driver_status: {} } : method === 'groups.log' ? { events } : {})
  render(<CanonicalGroupWorkspace binding={{ connectionId: 'local', profile: 'team', roomId: 'scroll' }} />)

  await screen.findByText('reply 40')
  await waitFor(() => expect(screen.getByRole('log').scrollTop).toBe(4000))
})
