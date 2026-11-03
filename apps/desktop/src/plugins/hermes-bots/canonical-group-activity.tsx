import { GlyphSpinner } from '@hermes/plugin-sdk'

import type { CanonicalRoomMember } from './canonical-groups'

/** What a running member is doing, as `groups.state` reports it (absent from older gateways). */
export interface CanonicalMemberStep {
  kind: 'tool' | 'thinking' | 'writing' | 'approval'
  tool?: string | null
  detail?: string | null
}

/** `groups.state` driver fields that say who is answering. */
export interface CanonicalDriverActivity {
  working?: boolean
  member_activity?: { member_id: string; status: string; step?: CanonicalMemberStep | null }[]
}

export type CanonicalMemberPhase = 'queued' | 'working'

export interface CanonicalMemberActivity { phase: CanonicalMemberPhase; step?: CanonicalMemberStep }

interface ActivityLabels {
  groupWorking: string
  memberQueued: string
  memberWorking: string
  stepApproval: string
  stepThinking: string
  stepTool: string
  stepWriting: string
}

const memberName = (member: CanonicalRoomMember) => member.display_name || member.handle || member.member_id

/** One phase per member: a running (or stopping) task outranks one still queued behind it. */
export function canonicalMemberPhases(driver?: CanonicalDriverActivity): Map<string, CanonicalMemberActivity> {
  const phases = new Map<string, CanonicalMemberActivity>()

  for (const { member_id, status, step } of driver?.member_activity ?? []) {
    if (status !== 'queued') {
      phases.set(member_id, { phase: 'working', step: step ?? phases.get(member_id)?.step })
    } else if (!phases.has(member_id)) {
      phases.set(member_id, { phase: 'queued' })
    }
  }

  return phases
}

const STEP_LABEL: Record<CanonicalMemberStep['kind'], keyof ActivityLabels> = {
  approval: 'stepApproval',
  thinking: 'stepThinking',
  tool: 'stepTool',
  writing: 'stepWriting'
}

function stepText(labels: ActivityLabels, activity: CanonicalMemberActivity) {
  if (activity.phase === 'queued') {return labels.memberQueued}
  const step = activity.step

  if (!step) {return labels.memberWorking}

  return step.kind === 'tool' && step.tool ? `${labels.stepTool} ${step.tool}` : labels[STEP_LABEL[step.kind]] ?? labels.memberWorking
}

export function CanonicalGroupRoster({ members = [], label, labels, phases }: {
  members?: CanonicalRoomMember[]; label: string; labels: ActivityLabels; phases: Map<string, CanonicalMemberActivity>
}) {
  if (!members.length) {return null}

  return <ul aria-label={label} className="flex flex-wrap gap-x-2 text-xs text-(--ui-text-tertiary)">
    {members.map(member => {
      const phase = phases.get(member.member_id)?.phase

      return <li className="inline-flex items-center gap-1" data-phase={phase ?? 'idle'} key={member.member_id}>
        {phase === 'working' && <GlyphSpinner ariaLabel={labels.memberWorking} className="text-(--ui-accent)" />}
        <span className={phase === 'working' ? 'text-(--ui-text-secondary)' : undefined}>{memberName(member)}</span>
        {phase === 'queued' && <span className="text-(--ui-text-quaternary)">· {labels.memberQueued}</span>}
      </li>
    })}
  </ul>
}

/** The room's live lines under the log: one per busy member, saying what it is doing. Older gateways
    without `member_activity` still say the group is working. */
export function CanonicalGroupWorkingLine({ driver, members = [], labels, phases }: {
  driver?: CanonicalDriverActivity; members?: CanonicalRoomMember[]; labels: ActivityLabels
  phases: Map<string, CanonicalMemberActivity>
}) {
  const busy = members.flatMap(member => {
    const activity = phases.get(member.member_id)

    return activity ? [{ activity, member }] : []
  })

  if (!busy.length && !driver?.working) {return null}

  // The container is the live region; the spinners' own status roles would nest more.
  return <div className="flex flex-col gap-0.5 px-2 py-1 text-[0.7rem] text-(--ui-text-quaternary)" role="status">
    {busy.length ? busy.map(({ activity, member }) => <div className="flex min-w-0 items-center gap-1.5" data-member={member.member_id} key={member.member_id}>
      <span aria-hidden="true" className="inline-flex w-3 justify-center">{activity.phase === 'working' && <GlyphSpinner />}</span>
      <span className="shrink-0 text-(--ui-text-tertiary)">{memberName(member)}</span>
      <span className="shrink-0 italic">{stepText(labels, activity)}</span>
      {activity.phase === 'working' && activity.step?.kind === 'tool' && activity.step.detail && <span className="min-w-0 truncate font-mono" title={activity.step.detail}>{activity.step.detail}</span>}
    </div>) : <div className="flex items-center gap-1.5 italic">
      <span aria-hidden="true"><GlyphSpinner className="not-italic" /></span>
      <span>{labels.groupWorking}</span>
    </div>}
  </div>
}
