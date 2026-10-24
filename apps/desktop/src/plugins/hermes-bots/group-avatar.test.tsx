/**
 * A group row's avatar reads as a group at a glance: the room's own picture
 * when it has one, otherwise its members' faces stacked in the same box a bot
 * face fills, and the generic glyph only for a room with nobody in it.
 */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { $botMeta } from './data'
import { GroupAvatar } from './group-row-shell'
import type { GroupMember } from './types'

const member = (name: string) => ({ name }) as GroupMember

function faceWidths(container: HTMLElement) {
  return [...container.querySelectorAll('img')].map(img => img.style.width)
}

describe('GroupAvatar', () => {
  afterEach(() => $botMeta.set({}))

  it('stacks up to three member faces, smaller as more share the box', () => {
    $botMeta.set({
      a: { image: 'https://faces.test/a.png' },
      b: { image: 'https://faces.test/b.png' },
      c: { image: 'https://faces.test/c.png' },
      d: { image: 'https://faces.test/d.png' }
    })

    expect(faceWidths(render(<GroupAvatar members={[member('a'), member('b')]} />).container)).toEqual(['24px', '24px'])

    expect(
      faceWidths(render(<GroupAvatar members={['a', 'b', 'c', 'd'].map(member)} />).container)
    ).toEqual(['20px', '20px', '20px'])
  })

  it("prefers the room's own picture over its members' faces", () => {
    const { container } = render(<GroupAvatar image="https://rooms.test/team.png" members={[member('a'), member('b')]} />)

    expect([...container.querySelectorAll('img')].map(img => img.getAttribute('src'))).toEqual([
      'https://rooms.test/team.png'
    ])
  })

  it('falls back to the group glyph only when the room has no members', () => {
    const { container } = render(<GroupAvatar members={[]} />)

    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.codicon-organization')).not.toBeNull()
  })
})
