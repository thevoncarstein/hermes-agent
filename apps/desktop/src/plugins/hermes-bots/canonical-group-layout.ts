/**
 * Where a gateway-hosted group sits in THIS machine's Bots roster: its "Pin to
 * top" flag and the user section it is filed under.
 *
 * A local group keeps both on its room record (`group-pin.ts`,
 * `moveGroupChatsToSection`). A hosted room has no local record and the
 * gateway's room is a conversation, not sidebar layout, so the same two
 * fields live here, keyed by the room's `canonical:` key (stable: it names the
 * authority, profile and immutable room id). Local like the section list
 * itself. A section that no longer exists reads as Unassigned, so deleting
 * one needs no cleanup here, and its Undo brings these rooms back with it.
 */

import { atom } from 'nanostores'

import { getPluginCtx } from './shared'

export const HOSTED_GROUP_LAYOUT_KEY = 'hosted-group-layout-v1'

export interface HostedGroupLayout {
  pinned?: boolean
  sectionId?: null | string
}

export const $hostedGroupLayout = atom<Record<string, HostedGroupLayout>>({})

function readLayout(): Record<string, HostedGroupLayout> {
  try {
    const stored = getPluginCtx()?.storage?.get?.(HOSTED_GROUP_LAYOUT_KEY, {})

    return stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, HostedGroupLayout>)
      : {}
  } catch {
    return {}
  }
}

/** Read the persisted layout back at plugin start. */
export function loadHostedGroupLayout(): void {
  $hostedGroupLayout.set(readLayout())
}

function updateLayout(key: string, patch: HostedGroupLayout): void {
  const current = $hostedGroupLayout.get()
  const entry = { ...current[key], ...patch }
  const next = { ...current, [key]: entry }

  if (!entry.pinned && !entry.sectionId) {
    delete next[key]
  }

  $hostedGroupLayout.set(next)

  try {
    getPluginCtx()?.storage?.set?.(HOSTED_GROUP_LAYOUT_KEY, next)
  } catch {
    // No storage: the layout lasts for this window only, as sections do.
  }
}

export function hostedGroupPinned(key: string, layout = $hostedGroupLayout.get()): boolean {
  return Boolean(layout[key]?.pinned)
}

export function hostedGroupSectionId(key: string, layout = $hostedGroupLayout.get()): null | string {
  return layout[key]?.sectionId || null
}

/** Flip "Pin to top"; returns the new state. */
export function toggleHostedGroupPinned(key: string): boolean {
  const pinned = !hostedGroupPinned(key)
  updateLayout(key, { pinned })

  return pinned
}

/** File a hosted group into a section (`null` clears it back to Unassigned). */
export function moveHostedGroupToSection(key: string, sectionId: null | string): void {
  if (hostedGroupSectionId(key) !== (sectionId || null)) {
    updateLayout(key, { sectionId: sectionId || null })
  }
}

/** Drag payload prefix that marks an in-flight hosted group row. */
export const HOSTED_GROUP_DRAG_PREFIX = 'hosted-group:'

export function hostedGroupDragKey(key: string): string {
  return `${HOSTED_GROUP_DRAG_PREFIX}${key}`
}
