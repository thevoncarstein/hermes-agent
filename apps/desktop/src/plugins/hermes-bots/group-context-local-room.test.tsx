import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { translateBots } from './i18n-test-helper'

const pickPaths = vi.hoisted(() => vi.fn())
const sendToGroupChat = vi.hoisted(() => vi.fn(() => true))

vi.mock('@hermes/plugin-sdk', async () => {
  const { pluginSdkMock, createGroupGateway } = await import('./group-test-utils')
  const base = await pluginSdkMock(createGroupGateway().host)
  const { en } = await import('@/i18n/en')

  const Button = ({ children, onClick, title, ...rest }: { children?: ReactNode; onClick?: () => void; title?: string; 'aria-label'?: string }) => (
    <button aria-label={rest['aria-label']} onClick={onClick} title={title} type="button">
      {children}
    </button>
  )

  return {
    ...base,
    Button,
    RowButton: Button,
    cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
    CopyButton: () => null,
    Dialog: () => null,
    DialogContent: () => null,
    DialogDescription: () => null,
    DialogFooter: () => null,
    DialogHeader: () => null,
    DialogTitle: () => null,
    Input: () => null,
    MessageTextContent: ({ text }: { text: string }) => <span data-testid="message-text-content">{text}</span>,
    ToggleRow: () => null,
    relativeTime: () => 'now',
    useI18n: () => ({ t: en }),
    usePluginI18n: () => translateBots
  }
})
vi.mock('./avatar', () => ({ avatarColor: () => '#888', botAppearance: () => ({}), BotFace: () => null }))
vi.mock('./group-chat-parts', () => ({
  GroupClarifyCard: () => null,
  GroupImageControls: () => null,
  GroupMentionInput: ({ 'aria-label': label, onChange, onSubmitDraft, value }: {
    'aria-label': string; onChange: (text: string) => void; onSubmitDraft: () => void; value: string
  }) => <textarea aria-label={label} onChange={event => onChange(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') {onSubmitDraft()} }} value={value} />
}))
vi.mock('./group-rounds', async importOriginal => ({ ...await importOriginal<object>(), sendToGroupChat }))
vi.mock('./shared', async importOriginal => ({ ...await importOriginal<object>(), getPluginCtx: () => ({ os: { pickPaths } }) }))
afterEach(() => { cleanup(); localStorage.clear(); sendToGroupChat.mockClear() })

it('a local room sends its project folder and added folders as context, and shows sent context as chips', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const { $groupChats } = await import('./group-chat')
  const { GroupChatWorkspace } = await import('./group-chat-view')
  const { localProjectScope, writeGroupProjectFolder } = await import('./canonical-group-context')

  writeGroupProjectFolder(localProjectScope('rid', 'Room'), '/work/app')
  const earlier = { id: 'u1', thread: 'a', from: { kind: 'user' as const, name: 'You' }, at: 1,
    text: 'Earlier ask\n\n[Context]\n- Project folder: /work/app\n- Folder: /work/app/docs' }
  $groupChats.set({ Room: { log: [earlier], roomId: 'rid', watermarks: {}, sessions: {} } as never })
  pickPaths.mockResolvedValue(['/work/app/src'])
  render(<GroupChatWorkspace group="Room" members={[{ name: 'builder' }] as never} />)

  // History: the body renders as text, the block as chips.
  await waitFor(() => expect(screen.getByTestId('message-text-content').textContent).toBe('Earlier ask'))
  expect(screen.getByText('docs')).toBeTruthy()

  fireEvent.click(screen.getAllByRole('menuitem', { name: 'Add folder' })[0])
  await screen.findByText('src')
  expect(pickPaths).toHaveBeenCalledWith(expect.objectContaining({ directories: true }))
  const composer = screen.getAllByRole('textbox').at(-1)!
  fireEvent.change(composer, { target: { value: 'Review this' } })
  fireEvent.keyDown(composer, { key: 'Enter' })

  expect(sendToGroupChat).toHaveBeenCalledTimes(1)
  expect((sendToGroupChat.mock.calls[0] as unknown[])[2]).toBe('Review this\n\n[Context]\n- Project folder: /work/app\n- Folder: /work/app/src')
  await waitFor(() => expect(screen.queryByText('src')).toBeNull())
})
