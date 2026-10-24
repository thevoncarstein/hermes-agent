/**
 * Working context a group's members are pointed at: the room's project
 * folder, plus folders added for one message.
 *
 * Members run in their own profiles' working directories, and a room has no
 * working directory of its own, so the context rides the message text as a
 * trailing block of absolute paths the members read with their file tools.
 * Every message carries the project folder again because a member's prompt is
 * only the thread delta since its last turn.
 */

import type { CanonicalGroupRoute } from './canonical-groups'
import { getPluginCtx } from './shared'

const HEADER = '[Context]'
const PROJECT = '- Project folder: '
const FOLDER = '- Folder: '

/** Storage scope of a gateway-hosted room's project folder: its authority and room. */
export function hostedProjectScope(route: CanonicalGroupRoute, roomId: string): string {
  return `${encodeURIComponent(route.connectionId)}:${encodeURIComponent(route.profile)}:${roomId}`
}

/** Storage scope of a Desktop-local room's project folder: its roomId, which
 *  survives renames, or the name for a room from before roomIds. */
export function localProjectScope(roomId: null | string | undefined, group: string): string {
  return `local:${roomId || group}`
}

const projectKey = (scope: string) => `hermes-bots:group-project:v1:${scope}`

export function readGroupProjectFolder(scope: string): string {
  try {
    return localStorage.getItem(projectKey(scope)) || ''
  } catch {
    return ''
  }
}

export function writeGroupProjectFolder(scope: string, folder: string): void {
  try {
    if (folder) {
      localStorage.setItem(projectKey(scope), folder)
    } else {
      localStorage.removeItem(projectKey(scope))
    }
  } catch {
    // Storage blocked: the folder holds for this view only.
  }
}

/** Folders on the active backend's filesystem; [] on cancel. */
export async function pickGroupFolders(title: string, multiple: boolean): Promise<string[]> {
  return (await getPluginCtx()?.os.pickPaths({ directories: true, multiple, title })) ?? []
}

/** `text` with the context block appended; unchanged when there is no context. */
export function withGroupContext(text: string, projectFolder: string, folders: readonly string[]): string {
  const lines = [
    ...(projectFolder ? [PROJECT + projectFolder] : []),
    ...folders.filter(folder => folder !== projectFolder).map(folder => FOLDER + folder)
  ]

  if (!lines.length) {
    return text
  }

  return [text.trimEnd(), '', HEADER, ...lines].join('\n').trimStart()
}

export interface GroupContextParts {
  body: string
  projectFolder: string
  folders: string[]
}

/** Split a sent message back into its text and the context block, for display. */
export function splitGroupContext(text: string): GroupContextParts {
  const at = text.lastIndexOf(HEADER)
  const lines = at < 0 ? [] : text.slice(at + HEADER.length).trim().split('\n')

  if (at < 0 || (at > 0 && text[at - 1] !== '\n') || !lines.every(line => line.startsWith(PROJECT) || line.startsWith(FOLDER))) {
    return { body: text, projectFolder: '', folders: [] }
  }

  return {
    body: text.slice(0, at).trimEnd(),
    projectFolder: lines.find(line => line.startsWith(PROJECT))?.slice(PROJECT.length) || '',
    folders: lines.filter(line => line.startsWith(FOLDER)).map(line => line.slice(FOLDER.length))
  }
}
