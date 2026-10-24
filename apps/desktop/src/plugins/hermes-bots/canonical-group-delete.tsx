import { Button, Codicon, ConfirmDialog, Tip } from '@hermes/plugin-sdk'
import { useState } from 'react'

import { hostedProjectScope, writeGroupProjectFolder } from './canonical-group-context'
import { useCanonicalGroupLabels } from './canonical-group-labels'
import { type CanonicalGroupBinding, canonicalGroupRequest } from './canonical-groups'

/** The room header's Delete: disband on the authority (which stops any running
 *  work), then hand back so the owner drops the room from Bots. */
export function CanonicalGroupDelete({ binding, name, disabled, onDeleted }: {
  binding: CanonicalGroupBinding; name?: string; disabled: boolean; onDeleted?: () => void
}) {
  const labels = useCanonicalGroupLabels()
  const [open, setOpen] = useState(false)

  const deleteRoom = async () => {
    await canonicalGroupRequest(binding, 'groups.disband', { room_id: binding.roomId, cancel_id: crypto.randomUUID() })
    writeGroupProjectFolder(hostedProjectScope(binding, binding.roomId), '')
    onDeleted?.()
  }

  return <>
    <Tip label={labels.deleteGroup}>
      <Button aria-label={labels.deleteGroup} className="shrink-0 text-(--ui-text-tertiary) hover:text-destructive" disabled={disabled} onClick={() => setOpen(true)} size="sm" variant="ghost">
        <Codicon name="trash" />
      </Button>
    </Tip>
    <ConfirmDialog confirmLabel={labels.deleteGroup} description={labels.deleteGroupWarning} destructive
      onClose={() => setOpen(false)} onConfirm={deleteRoom} open={open} title={`${labels.deleteGroup}: ${name ?? binding.roomName ?? ''}`} />
  </>
}
