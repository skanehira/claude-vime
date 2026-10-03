import { describe, expect, test } from 'claude-code/testing'

import { anthyEngine } from './anthy'
import type { Run, RunResult } from './anthy'

const BRIDGE = '/plugins/vime/bridge/bridge.lua'

// Answers every run with one result and keeps what each run was asked.
function fakeRun(result: RunResult) {
  const calls: { argv: readonly string[]; stdin: string; timeoutMs: number }[] = []
  const run: Run = async (argv, init) => {
    calls.push({ argv, ...init })
    return result
  }
  return { run, calls }
}

const ok = (stdout: string): RunResult => ({ exitCode: 0, stdout, stderr: '' })

const SEGMENTS = [
  { candidates: ['今日は', 'きょうは'] },
  { candidates: ['良い', 'いい'] },
]

const failureOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )

describe('anthyEngine', () => {
  test('convert runs the bridge under nvim with the reading and resizes as one JSON line, and answers its segments', async () => {
    const { run, calls } = fakeRun(ok(JSON.stringify({ segments: SEGMENTS }) + '\n'))

    const segments = await anthyEngine(run, BRIDGE).convert('きょうはいい', [[0, -1]])

    expect({ segments, calls }).toEqual({
      segments: SEGMENTS,
      calls: [
        {
          argv: ['nvim', '--headless', '-l', BRIDGE],
          stdin: '{"yomi":"きょうはいい","resizes":[[0,-1]]}\n',
          timeoutMs: 5000,
        },
      ],
    })
  })

  test('commit runs the bridge with the choices to learn', async () => {
    const { run, calls } = fakeRun(ok(JSON.stringify({ segments: SEGMENTS }) + '\n'))

    await anthyEngine(run, BRIDGE).commit('きょうはいい', [], [0, 1])

    expect(calls).toEqual([
      {
        argv: ['nvim', '--headless', '-l', BRIDGE],
        stdin: '{"yomi":"きょうはいい","resizes":[],"commit":[0,1]}\n',
        timeoutMs: 5000,
      },
    ])
  })

  test('an error the bridge answers rejects with that error', async () => {
    const { run } = fakeRun(ok('{"error":"libanthy not found"}\n'))

    const failed = await failureOf(anthyEngine(run, BRIDGE).convert('きょう', []))

    expect(failed).toBe('vime: libanthy not found')
  })

  test('a bridge that exits non-zero rejects with its exit code and the first line it wrote to stderr', async () => {
    const { run } = fakeRun({ exitCode: 1, stdout: '', stderr: 'E5113: lua error\nstack traceback:\n' })

    const failed = await failureOf(anthyEngine(run, BRIDGE).convert('きょう', []))

    expect(failed).toBe('vime: the bridge exited with 1: E5113: lua error')
  })

  test('an answer that is not the bridge JSON rejects', async () => {
    const { run } = fakeRun(ok('not json\n'))

    const failed = await failureOf(anthyEngine(run, BRIDGE).convert('きょう', []))

    expect(failed).toBe('vime: the bridge answered something other than its JSON: not json')
  })
})
