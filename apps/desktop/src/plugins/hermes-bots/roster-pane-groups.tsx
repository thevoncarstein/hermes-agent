import type { ComponentProps } from 'react'

import { GroupRow } from './bot-row'
import type { $groupClarify, $groupNeedsYou } from './group-chat'
import { groupHasPendingClarify } from './group-turns'

interface RosterGroupRowViewProps extends Omit<ComponentProps<typeof GroupRow>, 'needsYou'> {
  groupClarify: ReturnType<typeof $groupClarify.get>
  groupNeedsYou: ReturnType<typeof $groupNeedsYou.get>
}

export function RosterGroupRowView({ groupClarify, groupNeedsYou, ...rowProps }: RosterGroupRowViewProps) {
  return (
    <GroupRow
      {...rowProps}
      needsYou={Boolean(groupNeedsYou[rowProps.group]) || groupHasPendingClarify(groupClarify, rowProps.group)}
    />
  )
}
