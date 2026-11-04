import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $activeGatewayProfile, $gatewaySwapTarget, $profiles, setShowAllProfiles } from '@/store/profile'
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

// The primary gateway answers `projects.tree` for whichever profile the params name.
const request = vi.fn(async (_method: string, params: { profile: string }) => treePayload(`p_${params.profile}`))

// Every profile is served by the primary backend unless a test says otherwise.
const sharedRoute = async (profile?: null | string) => ({ mode: 'local', profile, sharedPrimary: true })
const getConnection = vi.fn(sharedRoute)

let uninstall: () => void

beforeEach(() => {
  vi.clearAllMocks()
  getConnection.mockImplementation(sharedRoute)
  request.mockImplementation(async (_method, params) => treePayload(`p_${params.profile}`))
  activeGateway.mockReturnValue({ connectionState: 'open', request } as never)
  Object.assign(window, { hermesDesktop: { ...window.hermesDesktop, getConnection } })
  $profiles.set([])
  setShowAllProfiles(false)
  $activeGatewayProfile.set('default')
  $sessions.set([])
  $projectTree.set([])
  $activeProjectId.set(null)
  $removedSessionIds.set(new Set())
  clearProfileSidebarCache()
  uninstall = installProfileSidebarCache()
})

afterEach(() => {
  uninstall()
  vi.useRealTimers()
})

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

  it("prefetches only the target's own lists and paints them when the switch lands", async () => {
    listSidebarSessions.mockResolvedValue({ recents: { sessions: [row('w1', 'writer')] } } as never)
    request.mockImplementation(async () => treePayload('p_writer', 'p_writer'))

    $gatewaySwapTarget.set('writer')
    await flush()

    // A native grant reads only the profile it is scoped to (403 profile_scope_mismatch).
    expect(listSidebarSessions).toHaveBeenCalledWith(sidebarSessionsRequest('writer'), { scopeProfile: 'writer' })
    // The profile's own tree, not the all-profiles REST aggregate.
    expect(request).toHaveBeenCalledWith('projects.tree', { preview_limit: 3, profile: 'writer' })
    expect(hermes.hermesApi).not.toHaveBeenCalled()
    expect(visibleIn('writer')).toEqual([])

    $gatewaySwapTarget.set(null)
    $activeGatewayProfile.set('writer')

    expect(visibleIn('writer').map(session => session.id)).toEqual(['w1'])
    expect($projectTree.get().map(project => project.id)).toEqual(['p_writer'])
    expect($activeProjectId.get()).toBe('p_writer')
  })

  it("reuses a profile's cached tree instead of fetching it again", async () => {
    $activeGatewayProfile.set('coder')
    await refreshProjectTree()
    $activeGatewayProfile.set('default')
    $projectTree.set([])
    request.mockClear()

    $gatewaySwapTarget.set('coder')
    await flush()
    $activeGatewayProfile.set('coder')

    expect(request).not.toHaveBeenCalledWith('projects.tree', expect.anything())
    expect($projectTree.get().map(project => project.id)).toEqual(['p_coder'])
  })

  it("warms other profiles' lists once idle, so even a first switch paints immediately", async () => {
    uninstall()
    vi.useFakeTimers()
    listSidebarSessions.mockImplementation(
      async req => ({ recents: { sessions: [row(`${req.recentsProfile}-1`, req.recentsProfile)] } }) as never
    )
    $profiles.set([{ name: 'default' }, { name: 'writer' }, { name: 'coder' }] as never)
    uninstall = installProfileSidebarCache()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(listSidebarSessions).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(listSidebarSessions.mock.calls.map(([req]) => req.recentsProfile)).toEqual(['writer', 'coder'])

    $activeGatewayProfile.set('coder')

    expect(visibleIn('coder').map(session => session.id)).toEqual(['coder-1'])
    expect($projectTree.get().map(project => project.id)).toEqual(['p_coder'])
  })

  it('never warms a profile with a backend of its own', async () => {
    uninstall()
    vi.useFakeTimers()
    // A remote override, or a local profile not served by the primary: scoping a read to
    // either would dial (or spawn) that backend just to warm a cache.
    getConnection.mockImplementation(async profile => ({
      mode: profile === 'cloud-bot' ? 'remote' : 'local',
      profile,
      sharedPrimary: false
    }))
    listSidebarSessions.mockResolvedValue({ recents: { sessions: [] } } as never)
    $profiles.set([{ name: 'default' }, { name: 'cloud-bot' }, { name: 'own-backend' }] as never)
    uninstall = installProfileSidebarCache()

    await vi.advanceTimersByTimeAsync(15_000)
    $gatewaySwapTarget.set('cloud-bot')
    await vi.advanceTimersByTimeAsync(10)

    expect(listSidebarSessions).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })

  it('tries a refused profile once, not on every profile-list republish', async () => {
    uninstall()
    vi.useFakeTimers()
    listSidebarSessions.mockRejectedValue(new Error('403: profile_scope_mismatch'))
    request.mockRejectedValue(new Error('gateway refused'))
    $profiles.set([{ name: 'default' }, { name: 'writer' }] as never)
    uninstall = installProfileSidebarCache()

    await vi.advanceTimersByTimeAsync(15_000)

    for (let poll = 0; poll < 3; poll += 1) {
      $profiles.set([{ name: 'default' }, { name: 'writer' }] as never)
      await vi.advanceTimersByTimeAsync(30_000)
    }

    expect(listSidebarSessions).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(1)
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
