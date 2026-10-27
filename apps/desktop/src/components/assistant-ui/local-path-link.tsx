import { Children, type ReactNode } from 'react'

import { ExternalLink, openExternalLink } from '@/lib/external-link'
import { isFileMediaPath } from '@/lib/media'
import { isWindowsAbsolutePath } from '@/lib/path-compare'

// Absolute paths a bot writes into prose: `C:\…` / `C:/…`, UNC `\\server\…`,
// `~/…` and POSIX paths with at least two segments (a lone `/help` is a slash
// command, not a path). A path must start at a word boundary so `and/or` or
// the path half of a URL never matches; trailing sentence punctuation is not
// part of the path.
const LOCAL_PATH_RE =
  /(?<![\w./\\:~-])(?:[A-Za-z]:[\\/]|\\\\[\w.$-]+[\\/]|~\/|\/(?=[\w.-]+\/[\w.-]))[^\s<>"'`|*?]*[^\s<>"'`|*?.,;:!)\]]/g

const EXPLICIT_URL_RE = /^https?:\/\/\S+$/i

/** No extension on the last segment (or a trailing separator): a folder. */
export function looksLikeDirectoryPath(path: string): boolean {
  const last =
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? ''

  return /[\\/]$/.test(path) || !/\.[A-Za-z0-9]{1,8}$/.test(last)
}

/** A local path rendered as a link: a click hands it to the OS (a folder opens
 *  in the file manager, a file in its default app) through the audited
 *  `hermes:openExternal` path route, which reports a missing path itself. */
export function LocalPathLink({ children, path }: { children?: ReactNode; path: string }) {
  const open = () => openExternalLink(path)

  return (
    <span
      className="ref cursor-pointer wrap-anywhere"
      // The app context menu reads this for Open / Open file location / Copy path.
      data-local-path={path}
      onClick={event => {
        event.stopPropagation()
        open()
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          open()
        }
      }}
      role="link"
      tabIndex={0}
      title={path}
    >
      {children ?? path}
    </span>
  )
}

/** Split one prose string into text and local-path links. */
export function linkifyLocalPathText(text: string): ReactNode {
  const parts: ReactNode[] = []
  let last = 0

  for (const match of text.matchAll(LOCAL_PATH_RE)) {
    const start = match.index ?? 0

    if (start > last) {
      parts.push(text.slice(last, start))
    }

    parts.push(<LocalPathLink key={`${start}:${match[0]}`} path={match[0]} />)
    last = start + match[0].length
  }

  if (!parts.length) {
    return text
  }

  if (last < text.length) {
    parts.push(text.slice(last))
  }

  return parts
}

/** The direct text nodes of a paragraph-level container, linkified. Nested
 *  markup (links, code, emphasis) keeps what the markdown renderer made. */
export function linkifyLocalPaths(children: ReactNode): ReactNode {
  return Children.map(children, child => (typeof child === 'string' ? linkifyLocalPathText(child) : child))
}

/** Inline code that is exactly one URL or one absolute local path stays code
 *  but becomes clickable — bots fence suggested sites and folders in
 *  backticks far more often than they write markdown links. */
export function linkedInlineCode(text: string, code: ReactNode): ReactNode | null {
  const value = text.trim()

  if (EXPLICIT_URL_RE.test(value)) {
    return <ExternalLink href={value}>{code}</ExternalLink>
  }

  // Windows paths keep their spaces (`C:\Program Files\…`); a POSIX one needs a
  // second segment so a backticked `/help` stays a slash command.
  const isPath = isWindowsAbsolutePath(value)
    ? !/\n/.test(value)
    : isFileMediaPath(value) && !value.startsWith('file:') && !/\s/.test(value) && /^(?:~\/.|\/[^/]+\/.)/.test(value)

  if (isPath) {
    return <LocalPathLink path={value}>{code}</LocalPathLink>
  }

  return null
}
