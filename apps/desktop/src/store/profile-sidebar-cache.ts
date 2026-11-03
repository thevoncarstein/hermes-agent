import { listSidebarSessions, type SessionInfo, type SidebarSessionsRequest } from '@/hermes'
import { LOCAL_SESSION_SOURCE_IDS, MESSAGING_SESSION_SOURCE_IDS } from '@/lib/session-source'
import { activeGatewayConnectionId, isActivePrimary } from '@/store/gateway'
import { $sessionsLimit } from '@/store/layout'
import {
  $activeGatewayProfile,
  $gatewaySwapTarget,
  $profiles,
  $showAllProfiles,
  normalizeProfileKey
} from '@/store/profile'
import { clearProjectTreeCache, paintCachedProjectTree, prefetchProjectTreeForProfile } from '@/store/projects'
import { $connection, CRON_SECTION_LIMIT, MESSAGING_SECTION_LIMIT, setSessions } from '@/store/session'
import { $removedSessionIds, tombstoneRowIds } from '@/store/session-removal'

// Stale-while-revalidate for the sidebar across profile switches. The lists
// used to be fetched only after the target profile's gateway landed, so every
// switch showed an empty (or the previous profile's) sidebar for the whole
// dial + fetch. Now each profile's last rows are kept and paint the moment the
// switch lands; the regular post-switch refresh then replaces them.
//
// A profile's FIRST switch can't be fixed at click time: the switch lands in
// ~100 ms and then fires a burst of cold per-profile work at the same backend
// (model.options, commands.catalog, …, ~3 s of CPU for a never-served
// profile), and the sidebar's reads finish last behind it. So once the app is
// idle the other profiles' lists are fetched one at a time ahead of any click.

// The recents list is local-only: cron rows have their own section, kanban
// dispatcher workers are read on the board, finite one-shot runs (`hermes -z`,
// `chat -q`) are not conversations, and each messaging platform
// (telegram, discord, …) is fetched separately into its own self-managed
// sidebar section (refreshMessagingSessions). Excluding them here keeps
// "Load more" paging through interactive local chats instead of
// interleaving gateway threads that bury them. ACP rows are editor-driven
// conversations: every editor wake mints an auto-titled row, so they would
// bury local chats — and they were never ended before #118216, which also
// kept prune/archive away from them.
export const SIDEBAR_EXCLUDED_SOURCES = [
  'acp',
  'cron',
  'kanban',
  'oneshot',
  'subagent',
  'tool',
  ...MESSAGING_SESSION_SOURCE_IDS
]

// The messaging slice is the inverse: drop cron + every local source so only
// external-platform conversations remain, then split per platform in the UI.
export const MESSAGING_EXCLUDED_SOURCES = ['cron', ...LOCAL_SESSION_SOURCE_IDS]

/** The one sidebar page request; the prefetch must match the post-switch
 *  refresh exactly so the backend's sidebar cache answers the second read. */
export function sidebarSessionsRequest(profile: string): SidebarSessionsRequest {
  return {
    recentsProfile: profile,
    recentsLimit: $sessionsLimit.get(),
    recentsExclude: SIDEBAR_EXCLUDED_SOURCES,
    cronLimit: CRON_SECTION_LIMIT,
    messagingLimit: MESSAGING_SECTION_LIMIT,
    messagingExclude: MESSAGING_EXCLUDED_SOURCES
  }
}

// Drop rows the user just deleted/archived: ANY list fetch (full refresh,
// "Load more" paging, a per-platform messaging page, the cron slice) can race
// an in-flight delete RPC, and the backend page still carries the doomed row
// until the DELETE commits — so it flashed back into the sidebar (#50928).
// Honoring the optimistic tombstone at every ingestion point keeps the removal
// stable; the tombstone self-clears once projects.tree confirms the delete,
// and a failed delete untombstones immediately, so nothing is filtered on the
// non-destructive paths. A tombstone matches the row on ANY id the
// conversation has answered to (tip, root, and every intermediate lineage
// segment) — armed on one name, it must still catch the same conversation
// returning under another (#123685).
export function dropTombstoned(sessions: SessionInfo[]): SessionInfo[] {
  const tombstones = $removedSessionIds.get()

  if (!tombstones.size) {
    return sessions
  }

  const tombstoned = (session: SessionInfo): boolean => tombstoneRowIds(session).some(id => tombstones.has(id))

  const kept = sessions.filter(session => !tombstoned(session))

  return kept.length === sessions.length ? sessions : kept
}

const MAX_CACHED_PROFILES = 16
// Startup is the busiest moment for the backend; warm after it, one profile at
// a time, so the reads never compete with the foreground.
const WARM_DELAY_MS = 8_000
const WARM_GAP_MS = 750

const cachedRows = new Map<string, SessionInfo[]>()

const cacheKey = (connectionId: null | string, profile: string) =>
  `${connectionId ?? ''}\n${normalizeProfileKey(profile)}`

// Same (profile, id) identity mergeSessionPage uses: two profiles can hold the
// same stored id (#92454).
const rowIdentity = (session: SessionInfo) => `${normalizeProfileKey(session.profile)}::${session.id}`

function remember(connectionId: null | string, profile: string, rows: SessionInfo[]): void {
  const key = cacheKey(connectionId, profile)
  const owned = rows.filter(session => normalizeProfileKey(session.profile) === normalizeProfileKey(profile))
  cachedRows.delete(key)
  cachedRows.set(key, owned)

  for (const stale of [...cachedRows.keys()].slice(0, -MAX_CACHED_PROFILES)) {
    cachedRows.delete(stale)
  }
}

/** Record what one profile's sidebar just showed, for the next switch back. */
export function rememberProfileSessions(profile: string, rows: SessionInfo[]): void {
  remember(activeGatewayConnectionId(), profile, rows)
}

export function clearProfileSidebarCache(): void {
  cachedRows.clear()
  clearProjectTreeCache()
  scheduleWarm()
}

// Add the newly active profile's cached rows. The sidebar filters $sessions by
// profile scope, so until the refresh lands this is the difference between the
// cached list and an empty one; the refresh's merge drops whatever is stale.
function seedCachedProfileSessions(): void {
  if ($showAllProfiles.get()) {
    return
  }

  const rows = cachedRows.get(cacheKey(activeGatewayConnectionId(), $activeGatewayProfile.get()))

  if (!rows?.length) {
    return
  }

  const cached = dropTombstoned(rows)

  setSessions(prev => {
    const present = new Set(prev.map(rowIdentity))
    const missing = cached.filter(session => !present.has(rowIdentity(session)))

    return missing.length ? [...prev, ...missing] : prev
  })
}

// The prefetch reads `profile`'s databases through the backend already in
// front, so it is only right when that backend sits on the same machine as the
// profile: the active gateway is the window primary, the primary is local, and
// the profile resolves locally (served by that primary or a local sibling, not
// a per-profile remote override). The descriptor lookup is a cached IPC read
// and never dials anything.
async function readableThroughPrimary(profile: string): Promise<boolean> {
  if (!isActivePrimary() || $connection.get()?.mode !== 'local') {
    return false
  }

  try {
    return (await window.hermesDesktop?.getConnection(profile))?.mode === 'local'
  } catch {
    return false
  }
}

// Only cached, never painted: a page that lands after the switch could be
// older than the refresh that already published, and re-adding its rows would
// resurrect a session that refresh dropped.
async function prefetchProfileSessions(profile: string): Promise<void> {
  const connectionId = activeGatewayConnectionId()
  const key = cacheKey(connectionId, profile)

  if (cachedRows.has(key)) {
    return
  }

  try {
    const result = await listSidebarSessions(sidebarSessionsRequest(profile))
    const rows = result.recents.sessions

    if (rows && activeGatewayConnectionId() === connectionId && !cachedRows.has(key)) {
      remember(connectionId, profile, rows)
    }
  } catch {
    // Best-effort warm-up: the post-switch refresh still runs.
  }
}

async function prefetchProfileSidebar(profile: string): Promise<void> {
  if (!(await readableThroughPrimary(profile))) {
    return
  }

  await Promise.all([prefetchProfileSessions(profile), prefetchProjectTreeForProfile(profile)])
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Bumped by every install and teardown: a loop from an older install (a
// remount, a test) sees the change and exits instead of running beside the new one.
let warmGeneration = 0
let warmEnabled = false
let warmingGeneration: null | number = null
let warmAgain = false

// Fill the cache for every profile not yet seen, serially. The list is read
// live, and a change mid-run (profiles added, cache cleared by a connection
// switch) queues one more pass instead of restarting the delay — the profile
// list republishes often enough that a restart would never get to run.
async function warmProfileSidebars(generation: number): Promise<void> {
  const stale = () => generation !== warmGeneration

  await sleep(WARM_DELAY_MS)

  do {
    warmAgain = false

    for (const { name } of $profiles.get()) {
      if (stale()) {
        return
      }

      if ($showAllProfiles.get() || normalizeProfileKey(name) === normalizeProfileKey($activeGatewayProfile.get())) {
        continue
      }

      await prefetchProfileSidebar(name)
      await sleep(WARM_GAP_MS)
    }
  } while (warmAgain && !stale())
}

function scheduleWarm(): void {
  if (!warmEnabled) {
    return
  }

  if (warmingGeneration === warmGeneration) {
    warmAgain = true

    return
  }

  const generation = warmGeneration
  warmingGeneration = generation
  void warmProfileSidebars(generation).finally(() => {
    if (warmingGeneration === generation) {
      warmingGeneration = null
    }
  })
}

function paintCachedProfileSidebar(): void {
  seedCachedProfileSessions()
  paintCachedProjectTree()
}

/** Wire the cache to profile switches; returns the teardown. */
export function installProfileSidebarCache(): () => void {
  // A click on a profile the warm-up hasn't reached yet still gets a head start.
  const offSwap = $gatewaySwapTarget.listen(target => {
    if (target) {
      void prefetchProfileSidebar(target)
    }
  })

  const offProfile = $activeGatewayProfile.listen(paintCachedProfileSidebar)

  // Leaving All profiles for the profile already behind the gateway moves no
  // profile atom, but the merged tree still needs to give way to its own.
  const offShowAll = $showAllProfiles.listen(showAll => {
    if (!showAll) {
      paintCachedProjectTree()
    }
  })

  // Fires once now, and again whenever the profile list itself changes.
  warmEnabled = true
  warmGeneration += 1
  const offProfiles = $profiles.subscribe(scheduleWarm)

  return () => {
    warmEnabled = false
    warmGeneration += 1
    offProfiles()
    offSwap()
    offProfile()
    offShowAll()
  }
}
