/**
 * What every group row in the Bots rail looks like, whichever store the room
 * lives in: the stacked member avatar, then name, age and latest message on
 * the same grid as a bot row. Rows pass what to show and own the behaviour.
 */

import { cn, Codicon, RowButton, SidebarRowLead, Tip, useI18n, useValue } from '@hermes/plugin-sdk'
import type { ComponentProps, ReactNode } from 'react'

import { avatarColor, botAppearance, BotFace } from './avatar'
import { isBackfilledFacePng } from './avatar-image'
import { $botMeta } from './data'
import { useBots } from './i18n'
import { botRosterMeta } from './routing'
import { rowAge } from './row-helpers'
import type { GroupMember } from './types'

const AVATAR_SIZE = 34

// Face size and offset per stacked count, inside the same 34px box a bot face fills.
const STACK: Record<number, { size: number; spots: Array<{ left: number; top: number }> }> = {
  2: { size: 24, spots: [{ left: 0, top: 0 }, { left: 10, top: 10 }] },
  3: { size: 20, spots: [{ left: 7, top: 0 }, { left: 0, top: 14 }, { left: 14, top: 14 }] }
}

function MemberFace({ member, size }: { member: GroupMember; size: number }) {
  const allMeta = useValue($botMeta)
  const { shape, color, image } = botAppearance(member.name, botRosterMeta(member, allMeta))

  return (
    <BotFace
      color={avatarColor(color, member.name)}
      image={image && !isBackfilledFacePng(image) ? image : null}
      name={member.name}
      shape={shape}
      size={size}
    />
  )
}

/** The room's own picture when it has one, else up to three member faces. */
export function GroupAvatar({ dimmed, image, members }: { dimmed?: boolean; image?: null | string; members: GroupMember[] }) {
  const faces = members.slice(0, 3)
  const stack = STACK[faces.length]

  return (
    <div
      aria-hidden
      className={cn('relative shrink-0', dimmed && 'grayscale opacity-60')}
      style={{ height: AVATAR_SIZE, width: AVATAR_SIZE }}
    >
      {image ? (
        <img alt="" className="size-full rounded-md object-cover ring-1 ring-(--ui-stroke-tertiary)" src={image} />
      ) : faces.length === 1 ? (
        <MemberFace member={faces[0]} size={AVATAR_SIZE} />
      ) : stack ? (
        faces.map((member, index) => (
          <span
            className="absolute rounded-[22%] ring-2 ring-(--ui-bg-primary)"
            key={`${member.connectionId || ''}:${member.name}`}
            style={stack.spots[index]}
          >
            <MemberFace member={member} size={stack.size} />
          </span>
        ))
      ) : (
        <span className="flex size-full items-center justify-center rounded-md bg-(--chrome-action-hover) text-(--ui-text-tertiary)">
          <Codicon name="organization" />
        </span>
      )}
    </div>
  )
}

interface GroupRowShellProps extends Omit<ComponentProps<typeof RowButton>, 'children' | 'title'> {
  active: boolean
  /** Shown on the avatar when some members are unreachable. */
  availabilityLabel?: string
  availableMembers: number
  dragging?: boolean
  image?: null | string
  /** Epoch milliseconds of the latest activity, or 0. */
  lastAt: number
  members: GroupMember[]
  needsYou: boolean
  pinned?: boolean
  preview: ReactNode
  title: string
}

export function GroupRowShell({
  active,
  availabilityLabel,
  availableMembers,
  className,
  dragging,
  image,
  lastAt,
  members,
  needsYou,
  pinned,
  preview,
  title,
  ...buttonProps
}: GroupRowShellProps) {
  const { t } = useI18n()
  const b = useBots()

  return (
    <RowButton
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-2.5 overflow-hidden rounded-md px-2 py-2 text-left transition-colors',
        'hover:bg-(--chrome-action-hover)',
        active && 'bg-(--ui-row-active-background)',
        dragging && 'opacity-40',
        className
      )}
      {...buttonProps}
    >
      <div className="relative shrink-0">
        <GroupAvatar dimmed={members.length > 0 && availableMembers === 0} image={image} members={members} />
        {availabilityLabel && members.length > 0 && availableMembers < members.length ? (
          <Tip label={availabilityLabel}>
            <span
              aria-label={availabilityLabel}
              className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-(--ui-bg-primary) text-[0.625rem] text-amber-600 ring-1 ring-(--ui-stroke-tertiary) dark:text-amber-300"
            >
              <Codicon name="debug-disconnect" />
            </span>
          </Tip>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Same lead cell as a bot row, so every name in the rail starts on one edge. */}
            <SidebarRowLead />
            {pinned ? (
              <Tip label={b.roster.pinned}>
                <Codicon className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)" name="pinned" />
              </Tip>
            ) : null}
            <span className="min-w-0 truncate text-[0.8125rem] font-medium">{title}</span>
          </div>
          {needsYou ? (
            <Tip label={b.group.needsYourInput}>
              <Codicon aria-label={b.roster.needsInput} className="shrink-0 text-(--ui-accent)" name="question" />
            </Tip>
          ) : null}
          {lastAt ? (
            <span className="shrink-0 text-[0.6875rem] text-(--ui-text-quaternary)">{rowAge(lastAt, t.sidebar.row)}</span>
          ) : null}
        </div>
        <div className="min-w-0 truncate text-xs text-(--ui-text-tertiary)">{preview}</div>
      </div>
    </RowButton>
  )
}
