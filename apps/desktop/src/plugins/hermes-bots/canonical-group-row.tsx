import {
  Codicon,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  haptic,
  host,
  useValue
} from '@hermes/plugin-sdk'
import { useState } from 'react'

import { CanonicalGroupDeleteDialog } from './canonical-group-delete'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { hostedGroupDragKey, moveHostedGroupToSection, toggleHostedGroupPinned } from './canonical-group-layout'
import { refreshCanonicalRosterRooms } from './canonical-group-roster'
import type { CanonicalRosterRoom } from './canonical-group-roster'
import { botSourceStatus } from './data'
import { closeGroupChatMainTab } from './group-panes'
import { GroupRowShell } from './group-row-shell'
import { useBots } from './i18n'
import { stripPreviewMarkdown } from './labels'
import type { GroupMember } from './types'
import { $botSections, $draggingBot, BOT_DRAG_MIME } from './user-sections'

interface CanonicalGroupRowProps {
  active: boolean
  entry: CanonicalRosterRoom
  /** The room's members resolved to roster bots, for their faces. */
  members: GroupMember[]
  /** Opens the New section dialog; the group is filed into it on create. */
  onNewSection: (key: string) => void
  onOpen: (key: string) => void
  pinned: boolean
  sectionId: null | string
}

/** One gateway-hosted room as a roster row, drawn and filed like a local group chat. */
export function CanonicalGroupRow({ active, entry, members, onNewSection, onOpen, pinned, sectionId }: CanonicalGroupRowProps) {
  const b = useBots()
  const labels = useCanonicalGroupLabels()
  const sections = useValue($botSections)
  const [deleting, setDeleting] = useState(false)
  const { last, room } = entry
  const availableMembers = members.filter(member => botSourceStatus(member).available).length
  // Same drag contract as a bot or local group row, under its own key shape.
  const dragKey = hostedGroupDragKey(entry.key)
  const dragging = useValue($draggingBot) === dragKey

  const preview = last
    ? `${last.fromUser ? b.group.you : `@${last.from}`}: ${stripPreviewMarkdown(last.text) || '…'}`
    : b.group.memberCount(members.length)

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <GroupRowShell
            active={active}
            aria-label={`${room.name}, ${b.group.memberCount(members.length)}`}
            availableMembers={availableMembers}
            draggable
            dragging={dragging}
            lastAt={last?.at || (room.updated_at ?? 0) * 1000}
            members={members}
            needsYou={false}
            onClick={() => {
              haptic('tap')
              onOpen(entry.key)
            }}
            onDragEnd={() => $draggingBot.set(null)}
            onDragStart={event => {
              event.dataTransfer.setData(BOT_DRAG_MIME, dragKey)
              event.dataTransfer.effectAllowed = 'move'
              $draggingBot.set(dragKey)
            }}
            pinned={pinned}
            preview={preview}
            title={room.name}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onOpen(entry.key)}>Open Group Chat</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => {
              const next = toggleHostedGroupPinned(entry.key)
              host.notify({ kind: 'info', message: `${room.name} ${next ? 'pinned to top' : 'unpinned'}` })
            }}
          >
            {pinned ? 'Unpin' : 'Pin to top'}
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>{b.sections.moveTo}</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {sections.map(section => (
                <ContextMenuItem
                  disabled={section.id === sectionId}
                  key={section.id}
                  onSelect={() => moveHostedGroupToSection(entry.key, section.id)}
                >
                  <Codicon className="mr-1.5" name="folder" />
                  {section.name}
                </ContextMenuItem>
              ))}
              {sections.length ? <ContextMenuSeparator /> : null}
              <ContextMenuItem onSelect={() => onNewSection(entry.key)}>
                <Codicon className="mr-1.5" name="new-folder" />
                {b.sections.newSectionEllipsis}
              </ContextMenuItem>
              {sectionId ? (
                <ContextMenuItem onSelect={() => moveHostedGroupToSection(entry.key, null)}>
                  <Codicon className="mr-1.5" name="inbox" />
                  {b.sections.removeFromSection}
                </ContextMenuItem>
              ) : null}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(true)}>
            {labels.deleteGroup}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CanonicalGroupDeleteDialog
        binding={{ ...entry.route, roomId: room.room_id, roomName: room.name }}
        name={room.name}
        onClose={() => setDeleting(false)}
        onDeleted={() => {
          // An open tab on the room would only show a dead room now.
          closeGroupChatMainTab(entry.key)
          moveHostedGroupToSection(entry.key, null)

          if (pinned) {
            toggleHostedGroupPinned(entry.key)
          }

          refreshCanonicalRosterRooms()
        }}
        open={deleting}
      />
    </>
  )
}
