import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { LocalPathLink } from '@/components/assistant-ui/local-path-link'

import { AppContextMenu } from './app-context-menu'
import { $contextMenu } from './store'

const desktopWindow = window as unknown as { hermesDesktop?: Window['hermesDesktop'] }

afterEach(() => {
  $contextMenu.set(null)
  cleanup()
  delete desktopWindow.hermesDesktop
})

it('offers the platform reveal verb on a chat folder link right-click', async () => {
  const revealPath = vi.fn().mockResolvedValue(true)
  const openExternal = vi.fn().mockResolvedValue(undefined)

  desktopWindow.hermesDesktop = { openExternal, revealPath } as unknown as Window['hermesDesktop']
  render(
    <MemoryRouter>
      <AppContextMenu />
      <LocalPathLink path={'D:\\projects\\demo'} />
    </MemoryRouter>
  )

  fireEvent.contextMenu(screen.getByRole('link', { name: 'D:\\projects\\demo' }))

  expect(await screen.findByText('Open')).toBeTruthy()
  expect(screen.getByText('Copy path')).toBeTruthy()
  // The host OS's wording, from the same picker the file tree uses.
  fireEvent.click(screen.getByText(/^(Reveal in Finder|Reveal in File Explorer|Open containing folder)$/))

  expect(revealPath).toHaveBeenCalledWith('D:\\projects\\demo')
})
