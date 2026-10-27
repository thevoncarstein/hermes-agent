import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarkdownTextContent, MessageTextContent } from './markdown-text'

// Bots suggest folders and sites as bare paths or in backticks far more often
// than as markdown links; both must be clickable in bot and group chats.
describe('local path and backticked links', () => {
  const openExternal = vi.fn(async () => undefined)
  const original = window.hermesDesktop

  beforeEach(() => {
    window.hermesDesktop = { ...original, openExternal } as typeof window.hermesDesktop
  })

  afterEach(() => {
    cleanup()
    openExternal.mockClear()
    window.hermesDesktop = original
  })

  it('opens a bare Windows folder path written in prose', async () => {
    render(<MarkdownTextContent isRunning={false} text={'I created it in D:\\projects\\demo, take a look.'} />)

    fireEvent.click(await screen.findByRole('link', { name: 'D:\\projects\\demo' }))
    expect(openExternal).toHaveBeenCalledWith('D:\\projects\\demo')
  })

  it('opens a backticked POSIX path and keeps it code', async () => {
    render(<MessageTextContent media={false} text="Open `~/work/site` to start." />)

    const link = await screen.findByRole('link', { name: '~/work/site' })
    expect(link.querySelector('code')).not.toBeNull()
    fireEvent.click(link)
    expect(openExternal).toHaveBeenCalledWith('~/work/site')
  })

  it('links a backticked URL', async () => {
    render(<MessageTextContent text="Docs: `https://example.com/guide`" />)

    expect((await screen.findByRole('link', { name: 'https://example.com/guide' })).getAttribute('href')).toBe(
      'https://example.com/guide'
    )
  })

  it('leaves slash commands and URL paths alone', async () => {
    render(<MarkdownTextContent isRunning={false} text="Run `/help` or read and/or skip 10/27/2026." />)

    await screen.findByText(/skip/)
    expect(screen.queryByRole('link')).toBeNull()
  })
})
