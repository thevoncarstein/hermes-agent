/**
 * Folder context for a group's composers, hosted or Desktop-local: the room's
 * project folder, plus folders added per composer (main = '', a reply box =
 * its thread id) that ride the next message only.
 */

import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tip } from '@hermes/plugin-sdk'
import { type ReactNode, useState } from 'react'

import { pickGroupFolders, readGroupProjectFolder, splitGroupContext, withGroupContext, writeGroupProjectFolder } from './canonical-group-context'
import { GroupContextChips } from './canonical-group-context-chips'
import { useBots } from './i18n'
import type { GroupMessage } from './types'

/** A local room entry's text without the composer's context block, and that block as chips. */
export function groupEntryContext(entry: GroupMessage): { text: string; chips: ReactNode } {
  if (entry.from.kind !== 'user') {return { text: entry.text, chips: null }}
  const sent = splitGroupContext(entry.text)

  return { text: sent.body, chips: <GroupContextChips folders={sent.folders} projectFolder={sent.projectFolder} /> }
}

/** The plug button: a menu above it to add files or a folder. */
export function GroupContextMenu({ onAddFiles, onAddFolder }: { onAddFiles: () => void; onAddFolder: () => void }) {
  const labels = useBots().canonical

  return <DropdownMenu>
    <Tip label={labels.addContext}>
      <DropdownMenuTrigger asChild>
        <Button aria-label={labels.addContext} className="shrink-0 text-(--ui-text-tertiary) hover:text-foreground" size="sm" type="button" variant="ghost">
          <Codicon name="plug" />
        </Button>
      </DropdownMenuTrigger>
    </Tip>
    <DropdownMenuContent align="end" side="top">
      <DropdownMenuItem onSelect={onAddFiles}>
        <Codicon className="mr-1.5" name="file-add" />
        {labels.addFiles}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onAddFolder}>
        <Codicon className="mr-1.5" name="new-folder" />
        {labels.addFolder}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

export function useGroupContextFolders(scope: string) {
  const labels = useBots().canonical
  const [folders, setFolders] = useState<Record<string, string[]>>({})
  // Re-read on render: the scope is the room's, and a write bumps this.
  const [, setRevision] = useState(0)
  const projectFolder = readGroupProjectFolder(scope)
  const foldersFor = (thread: null | string) => folders[thread ?? ''] || []
  const setFor = (thread: null | string, next: string[]) => setFolders(current => ({ ...current, [thread ?? '']: next }))

  const addFolders = (thread: null | string) => void pickGroupFolders(labels.addFolder, true).then(picked => {
    if (picked.length) {setFolders(current => ({ ...current, [thread ?? '']: [...new Set([...(current[thread ?? ''] || []), ...picked])] }))}
  })

  const changeProjectFolder = () => void pickGroupFolders(labels.projectFolder, false).then(([picked]) => {
    if (!picked) {return}
    writeGroupProjectFolder(scope, picked)
    setRevision(value => value + 1)
  })

  return {
    addFolders,
    /** Drop the room's project folder, e.g. once the room is disbanded. */
    clearProject: () => writeGroupProjectFolder(scope, ''),
    /** Folders added to one composer are spent once its message is sent. */
    clearFolders: (thread: null | string) => setFor(thread, []),
    /** The message `text` as sent from one composer, with its context block. */
    compose: (text: string, thread: null | string) => withGroupContext(text, projectFolder, foldersFor(thread)),
    chips: (thread: null | string) => <GroupContextChips folders={foldersFor(thread)}
      onProjectClick={thread === null ? changeProjectFolder : undefined}
      onRemove={folder => setFor(thread, foldersFor(thread).filter(item => item !== folder))}
      projectFolder={thread === null ? projectFolder : ''} />
  }
}
