import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $activeGatewayProfile, $gatewaySwapTarget, setShowAllProfiles } from '@/store/profile'
import { $sessions } from '@/store/session'
import type { SessionInfo } from '@/types/hermes'

import {
  clearProfileSidebarCache,
  installProfileSidebarCache,
  rememberProfileSessions,
  sidebarSessionsRequest
} from './profile-sidebar-cache'
import { $activeProjectId, $projectTree, refreshProjectTree } from './projects'
import { $removedSessionIds } from './session-removal'

vi.mock('@/i18n', () => ({ translateNow: (key: string) => key }))
vi.mock('@/store/notifications', () => ({ notify: vi.fn() }))

vi.mock('@/store/gateway', () => ({
  $gateway: atom(null),
  activeGateway: vi.fn(),
  activeGatewayConnectionId: vi.fn(() => null),
  isActivePrimary: vi.fn(() => true),
  ensureActiveGatewayOpen: vi.fn()
}))

vi.mock('@/hermes', () => ({
  getHermesConfig: vi.fn(),
  getProfiles: vi.fn(),
  hermesApi: vi.fn(),
  listSidebarSessions: vi.fn(),
  setApiRequestProfile: vi.fn(),
  STARTUP_REQUEST_TIMEOUT_MS: 1000
}))

const hermes = await import('@/hermes')
const hermesApi = vi.mocked(hermes.hermesApi)
const listSidebarSessions = vi.mocked(hermes.listSidebarSessions)
const gw = await import('@/store/gateway')
const activeGateway = vi.mocked(gw.activeGateway)

const row = (id: string, profile: string) => ({ id, profile, title: id }) as unknown as SessionInfo
const visibleIn = (profile: string) => $sessions.get().filter(session => session.profile === profile)

const treePayload = (id: string, activeId: null | string = null) => ({
  active_id: activeId,
  projects: [{ id, label: id, path: `/${id}`, repos: [], sessionCount: 0, sessionIds: [] }],
  scoped_session_ids: []
})

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

let uninstall: () => void

beforeEach(() => {
  vi.clearAllMocks()
  setShowAllProfiles(false)
  $activeGatewayProfile.set('default')
  $sessions.set([])
  $projectTree.set([])
  $activeProjectId.set(null)
  $removedSessionIds.set(new Set())
  clearProfileSidebarCache()
  uninstall = installProfileSidebarCache()
})

afterEach(() => uninstall())

describe('profile sidebar cache', () => {
  it("paints a profile's last rows the moment the switch back lands, before any refresh", () => {
    $activeGatewayProfile.set('coder')
    rememberProfileSessions('coder', [row('c1', 'coder'), row('d-stray', 'default')])
    $activeGatewayProfile.set('default')
    $sessions.set([row('d1', 'default')])

    $activeGatewayProfile.set('coder')

    expect(visibleIn('coder').map(session => session.id)).toEqual(['c1'])
    expect(listSidebarSessions).not.toHaveBeenCalled()
  })

  it('does not repaint a row the user removed since it was cached', () => {
    $activeGatewayProfile.set('coder')
    rememberProfileSessions('coder', [row('c1', 'coder'), row('c2', 'coder')])
    $activeGatewayProfile.set('default')
    $removedSessionIds.set(new Set(['c2']))

    $activeGatewayProfile.set('coder')

    expect(visibleIn('coder').map(session => session.id)).toEqual(['c1'])
  })

  it("prefetches the target's lists while its backend spawns and paints them when the switch lands", async () => {
    listSidebarSessions.mockResolvedValue({ recents: { sessions: [row('w1', 'writer')] } } as never)
    hermesApi.mockResolvedValue(treePayload('p_writer') as never)
    $activeProjectId.set('p_kept')

    $gatewaySwapTarget.set('writer')
    await flush()

    expect(listSidebarSessions).toHaveBeenCalledWith(sidebarSessionsRequest('writer'))
    expect(hermesApi).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/api/profiles/projects/tree?') })
    )
    expect(String(hermesApi.mock.calls[0][0].path)).toContain('profile=writer')
    expect(visibleIn('writer')).toEqual([])

    $gatewaySwapTarget.set(null)
    $activeGatewayProfile.set('writer')

    expect(visibleIn('writer').map(session => session.id)).toEqual(['w1'])
    expect($projectTree.get().map(project => project.id)).toEqual(['p_writer'])
    // The REST tree has no active pointer; it must not clear the real one.
    expect($activeProjectId.get()).toBe('p_kept')
  })

  it("keeps a profile's own tree over the REST prefetch and restores its active project", async () => {
    const request = vi.fn(async () => treePayload('p_coder', 'p_coder'))
    activeGateway.mockReturnValue({ connectionState: 'open', request } as never)
    $activeGatewayProfile.set('coder')
    await refreshProjectTree()
    $activeGatewayProfile.set('default')
    $projectTree.set([])
    $activeProjectId.set(null)

    $gatewaySwapTarget.set('coder')
    await flush()
    $activeGatewayProfile.set('coder')

    expect(hermesApi).not.toHaveBeenCalled()
    expect($projectTree.get().map(project => project.id)).toEqual(['p_coder'])
    expect($activeProjectId.get()).toBe('p_coder')
  })

  it('forgets every cached list when the connection changes', () => {
    $activeGatewayProfile.set('coder')
    rememberProfileSessions('coder', [row('c1', 'coder')])
    $activeGatewayProfile.set('default')

    clearProfileSidebarCache()
    $activeGatewayProfile.set('coder')

    expect(visibleIn('coder')).toEqual([])
  })
})
