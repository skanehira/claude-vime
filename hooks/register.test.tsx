import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const runVime = ($: Engine) =>
  $.command.run({ command: 'vime', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 90 } })

// What lies beneath the plugin in a session: the session starting and the command registry.
function standInForEngine(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
}

// The host commands the plugin ran, each answered as an agent that is installed.
function recordRuns(on: On) {
  const ran: (readonly string[])[] = []
  on('process.run', (_$, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return ran
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
  mock.env(on, {})
  recordRuns(on)
  const shown = recordStatus(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(shown).toEqual([undefined])
})

test('/vime turns Japanese input on and off, showing あ on the status line while it is on', async ($, on) => {
  standInForEngine(on)
  mock.env(on, {})
  recordRuns(on)
  const shown = recordStatus(on)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  const first = await runVime($)
  const second = await runVime($)

  expect({ answers: [first.text, second.text], shown }).toEqual({
    answers: ['vime: on', 'vime: off'],
    shown: [undefined, 'あ', undefined],
  })
})

test('on start, the agent VIME_ANTHY_AGENT names is the one asked for its version', async ($, on) => {
  standInForEngine(on)
  mock.env(on, { VIME_ANTHY_AGENT: '/opt/anthy/bin/anthy-agent' })
  const ran = recordRuns(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(ran).toEqual([['/opt/anthy/bin/anthy-agent', '--version']])
})

test('on start without VIME_ANTHY_AGENT, anthy-agent-unicode is asked first', async ($, on) => {
  standInForEngine(on)
  mock.env(on, {})
  const ran = recordRuns(on)

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

  expect(ran).toEqual([['anthy-agent-unicode', '--version']])
})
