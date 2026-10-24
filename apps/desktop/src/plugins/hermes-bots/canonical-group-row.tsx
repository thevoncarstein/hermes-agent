import { haptic } from '@hermes/plugin-sdk'

import type { CanonicalRosterRoom } from './canonical-group-roster'
import { botSourceStatus } from './data'
import { GroupRowShell } from './group-row-shell'
import { useBots } from './i18n'
import { stripPreviewMarkdown } from './labels'
import type { GroupMember } from './types'

interface CanonicalGroupRowProps {
  active: boolean
  entry: CanonicalRosterRoom
  /** The room's members resolved to roster bots, for their faces. */
  members: GroupMember[]
  onOpen: (key: string) => void
}

/** One gateway-hosted room as a roster row, drawn like a local group chat. */
export function CanonicalGroupRow({ active, entry, members, onOpen }: CanonicalGroupRowProps) {
  const b = useBots()
  const { last, room } = entry
  const availableMembers = members.filter(member => botSourceStatus(member).available).length

  const preview = last
    ? `${last.fromUser ? b.group.you : `@${last.from}`}: ${stripPreviewMarkdown(last.text) || '…'}`
    : b.group.memberCount(members.length)

  return (
    <GroupRowShell
      active={active}
      aria-label={`${room.name}, ${b.group.memberCount(members.length)}`}
      availableMembers={availableMembers}
      lastAt={last?.at || (room.updated_at ?? 0) * 1000}
      members={members}
      needsYou={false}
      onClick={() => {
        haptic('tap')
        onOpen(entry.key)
      }}
      preview={preview}
      title={room.name}
    />
  )
}
