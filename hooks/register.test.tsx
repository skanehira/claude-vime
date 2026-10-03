import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const runVime = ($: Engine) =>
  $.command.run({ command: 'vime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })

// What lies beneath the plugin in a session: the session starting and the command registry.
function standInForEngine(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

// What the plugin put on the status line, in order (undefined clears it).
function recordStatus(on: On) {
  const shown: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    shown.push(e.text)
    return { value: undefined }
  })
  return shown
}

test('a (re)load clears the status line, so it never shows あ left over from before', async ($, on) => {
  standInForEngine(on)
  const shown = recordStatus(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(shown).toEqual([undefined])
})

test('/vime turns Japanese input on and off, showing あ on the status line while it is on', async ($, on) => {
  standInForEngine(on)
  const shown = recordStatus(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const first = await runVime($)
  const second = await runVime($)

  expect({ answers: [first.text, second.text], shown }).toEqual({
    answers: ['vime: on', 'vime: off'],
    shown: [undefined, 'あ', undefined],
  })
})
