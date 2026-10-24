import { Button, Codicon, ConfirmDialog, Tip } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { hostedProjectScope, writeGroupProjectFolder } from './canonical-group-context'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { type CanonicalGroupBinding, canonicalGroupRequest } from './canonical-groups'

/** Disband on the authority (which stops any running work) and forget the
 *  room's local project folder. */
export async function deleteCanonicalGroup(binding: CanonicalGroupBinding) {
  await canonicalGroupRequest(binding, 'groups.disband', { room_id: binding.roomId, cancel_id: crypto.randomUUID() })
  writeGroupProjectFolder(hostedProjectScope(binding, binding.roomId), '')
}

/** The one Delete confirmation, shared by the room header and the roster row's menu. */
export function CanonicalGroupDeleteDialog({ binding, name, open, onClose, onDeleted }: {
  binding: CanonicalGroupBinding; name?: string; open: boolean; onClose: () => void; onDeleted?: () => void
}) {
  const labels = useCanonicalGroupLabels()

  return <ConfirmDialog confirmLabel={labels.deleteGroup} description={labels.deleteGroupWarning} destructive
    onClose={onClose}
    onConfirm={async () => {
      await deleteCanonicalGroup(binding)
      onDeleted?.()
    }}
    open={open} title={`${labels.deleteGroup}: ${name ?? binding.roomName ?? ''}`} />
}

/** The room header's Delete; hands back so the owner drops the room from Bots. */
export function CanonicalGroupDelete({ binding, name, disabled, onDeleted }: {
  binding: CanonicalGroupBinding; name?: string; disabled: boolean; onDeleted?: () => void
}) {
  const labels = useCanonicalGroupLabels()
  const [open, setOpen] = useState(false)

  return <>
    <Tip label={labels.deleteGroup}>
      <Button aria-label={labels.deleteGroup} className="shrink-0 text-(--ui-text-tertiary) hover:text-destructive" disabled={disabled} onClick={() => setOpen(true)} size="sm" variant="ghost">
        <Codicon name="trash" />
      </Button>
    </Tip>
    <CanonicalGroupDeleteDialog binding={binding} name={name} onClose={() => setOpen(false)} onDeleted={onDeleted} open={open} />
  </>
}
