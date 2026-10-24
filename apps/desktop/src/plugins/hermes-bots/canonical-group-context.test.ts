import { expect, it, vi } from 'vitest'

vi.mock('./shared', () => ({ getPluginCtx: () => null }))

import { hostedProjectScope, localProjectScope, readGroupProjectFolder, splitGroupContext, withGroupContext, writeGroupProjectFolder } from './canonical-group-context'

it('appends the project folder and added folders, and reads them back for display', () => {
  const root = String.raw`D:\proj`
  const src = String.raw`D:\proj\src`
  const text = withGroupContext('Review the API', root, [src, root])
  expect(text).toBe(`Review the API\n\n[Context]\n- Project folder: ${root}\n- Folder: ${src}`)
  expect(splitGroupContext(text)).toEqual({ body: 'Review the API', projectFolder: root, folders: [src] })
})

it('leaves a message without context untouched, and never strips a block the user typed mid-text', () => {
  expect(withGroupContext('hi', '', [])).toBe('hi')
  const typed = 'Quote: [Context]\n- Folder: /x'
  expect(splitGroupContext(typed).body).toBe(typed)
  const prose = 'notes\n[Context]\nnot a path line'
  expect(splitGroupContext(prose).body).toBe(prose)
})

it('keeps the project folder per room, authority and room kind', () => {
  const route = { connectionId: 'local', profile: 'team' }
  writeGroupProjectFolder(hostedProjectScope(route, 'room-a'), '/work/a')
  expect(readGroupProjectFolder(hostedProjectScope(route, 'room-a'))).toBe('/work/a')
  expect(readGroupProjectFolder(hostedProjectScope(route, 'room-b'))).toBe('')
  expect(readGroupProjectFolder(hostedProjectScope({ ...route, profile: 'other' }, 'room-a'))).toBe('')
  expect(readGroupProjectFolder(localProjectScope('room-a', 'Room A'))).toBe('')
  writeGroupProjectFolder(hostedProjectScope(route, 'room-a'), '')
  expect(readGroupProjectFolder(hostedProjectScope(route, 'room-a'))).toBe('')
})
