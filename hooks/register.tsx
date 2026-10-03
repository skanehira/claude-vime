import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { anthyEngine, findAgent, learnLater } from './anthy'
import type { Run } from './anthy'
import { candidatePage } from './band'
import { Composer } from './editor'
import type { Candidates } from '../types'

const candidates = atom({ plugin: 'vime', key: 'candidates' } as const, null as Candidates | null)

// The run function of the dispatch being answered: an edit's agent process
// belongs to that edit's hook, so each hook sets it before the composer runs.
let run: Run | undefined
// Made on session.start, once the agent is found (and again on a reload).
let composer: Composer | undefined

const runAgent: Run = (argv, init) =>
  run === undefined ? Promise.reject(new Error('vime: no hook is running')) : run(argv, init)

const PROBE_TIMEOUT_MS = 3000

/** VIME_ANTHY_AGENT, or the first installed of anthy-agent-unicode and anthy-agent. */
async function agentOf($: EngineInterface): Promise<string | undefined> {
  const custom = await $.env.get('VIME_ANTHY_AGENT')
  const probe = (argv: readonly string[]) =>
    $.process.run(argv, { timeoutMs: PROBE_TIMEOUT_MS }).then(
      ran => ran.exitCode === 0,
      () => false,
    )
  return findAgent(probe, custom === undefined || custom === '' ? undefined : custom)
}

async function showState($: EngineInterface, current: Composer) {
  $.ui.status(current.isOn ? 'あ' : undefined)
  const next = current.candidates() ?? null
  await update($, candidates, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const agent = await agentOf($)
    // Learning runs after the edit that committed has been answered, on the session's own $.
    const learning = anthyEngine((argv, init) => $.process.run(argv, init), agent)
    const commit = learnLater(learning.commit, message => $.ui.toast(message))
    composer = new Composer({ convert: anthyEngine(runAgent, agent).convert, commit })
    // A reload starts a fresh composer (off): clear what the last one left on screen.
    await showState($, composer)
    await $.command.register({ name: 'vime', description: 'Turn Japanese (romaji to kana and kanji) input on or off', immediate: true })
    return next(e)
  })

  on('command.run', { command: 'vime' }, async $ => {
    if (composer === undefined) return { text: 'vime: not ready yet' }
    run = (argv, init) => $.process.run(argv, init)
    await composer.toggle()
    await showState($, composer)
    return { text: composer.isOn ? 'vime: on' : 'vime: off' }
  })

  on('prompt.edit', async ($, e, next) => {
    if (composer === undefined) return next(e)
    run = (argv, init) => $.process.run(argv, init)
    const answer = await composer.edit(e)
    await showState($, composer)
    if (answer.kind === 'pass') {
      const edit = answer.edit
      return next(edit === undefined ? e : { ...e, text: edit.text, start: edit.start, end: edit.end, cursor: edit.cursor })
    }
    if (answer.error !== undefined) $.ui.toast(answer.error)
    return answer.box
  })

  // Enter sends the prompt when it does not reach prompt.edit: the run goes out committed.
  on('prompt.submit', async ($, e, next) => {
    if (composer === undefined) return next(e)
    run = (argv, init) => $.process.run(argv, init)
    const text = await composer.commitForSubmit(e.text)
    await showState($, composer)
    return next(text === e.text ? e : { ...e, text })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, candidates)
    if (current === null || e.props.hasSurvey) return next(e)
    const page = candidatePage(current.list, current.index)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        {page.items.map(item => (
          <Box key={item.text} flexShrink={0} marginRight={1}>
            <Text bold={item.isChosen} underline={item.isChosen} dimColor={!item.isChosen}>
              {item.text}
            </Text>
          </Box>
        ))}
        <Text dimColor>{page.position}</Text>
      </Box>
    )
  })
}
