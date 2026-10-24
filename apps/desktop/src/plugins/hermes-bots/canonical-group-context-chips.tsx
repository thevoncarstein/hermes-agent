import { Button, Codicon, Tip } from '@hermes/plugin-sdk'

import { useBots } from './i18n'

const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path

/** The project folder and added folders as chips; a chip with `onRemove` can be dropped.
 *  With `onProjectClick`, a room without a project folder offers to choose one. */
export function GroupContextChips({ projectFolder, folders, onRemove, onProjectClick }: {
  projectFolder: string
  folders: readonly string[]
  onRemove?: (folder: string) => void
  onProjectClick?: () => void
}) {
  const labels = useBots().canonical

  if (!projectFolder && !folders.length && !onProjectClick) {return null}

  const shape = 'flex max-w-56 items-center gap-1 rounded-md bg-(--chrome-action-hover) px-1.5 py-0.5 text-[0.6875rem]'
  const chip = `${shape} text-(--ui-text-secondary)`

  return <div className="flex flex-wrap items-center gap-1">
    {!projectFolder && onProjectClick && <button className={`${shape} text-(--ui-text-quaternary) hover:text-foreground`} onClick={onProjectClick} type="button">
      <Codicon className="shrink-0 text-[0.75rem]" name="root-folder" />
      <span className="truncate">{labels.projectFolder}</span>
    </button>}
    {projectFolder && <Tip label={`${labels.projectFolder}: ${projectFolder}`}>
      {onProjectClick
        ? <button aria-label={`${labels.projectFolder}: ${projectFolder}`} className={`${chip} hover:text-foreground`} onClick={onProjectClick} type="button">
          <Codicon className="shrink-0 text-[0.75rem]" name="root-folder" />
          <span className="truncate">{baseName(projectFolder)}</span>
        </button>
        : <span className={chip}>
          <Codicon className="shrink-0 text-[0.75rem]" name="root-folder" />
          <span className="truncate">{baseName(projectFolder)}</span>
        </span>}
    </Tip>}
    {folders.map(folder => <span className={chip} key={folder} title={folder}>
      <Codicon className="shrink-0 text-[0.75rem]" name="folder" />
      <span className="truncate">{baseName(folder)}</span>
      {onRemove && <Button aria-label={`${labels.removeContext}: ${folder}`} className="size-4 p-0" onClick={() => onRemove(folder)} size="icon-xs" type="button" variant="ghost">
        <Codicon className="text-[0.625rem]" name="close" />
      </Button>}
    </span>)}
  </div>
}
