import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { anthyEngine } from './anthy'
import type { Run } from './anthy'
import { candidatePage } from './band'
import { Composer } from './editor'
import type { Candidates } from '../types'

const candidates = atom({ plugin: 'vime', key: 'candidates' } as const, null as Candidates | null)

// The run function of the dispatch being answered: an edit's bridge process
// belongs to that edit's hook, so each hook sets it before the composer runs.
let run: Run | undefined
// Made on session.start, which knows the plugin's folder (and fires again on a reload).
let composer: Composer | undefined

const runBridge: Run = (argv, init) =>
  run === undefined ? Promise.reject(new Error('vime: no hook is running')) : run(argv, init)

async function showState($: EngineInterface, current: Composer) {
  $.ui.status(current.isOn ? 'あ' : undefined)
  const next = current.candidates() ?? null
  await update($, candidates, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    composer = new Composer(anthyEngine(runBridge, `${$.plugin.root}/bridge/bridge.lua`))
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
    if (answer.kind === 'pass') return next(answer.edit === undefined ? e : { ...e, text: answer.edit.text })
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
