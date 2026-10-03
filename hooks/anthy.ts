// The conversion engine backed by libanthy: each call starts the bridge
// (bridge/bridge.lua under `nvim -l`) once and reads its one-line JSON answer.
import type { ConversionEngine, Resize, Segment } from './session'

export type RunResult = { exitCode: number; stdout: string; stderr: string }

/** Starts a host command and resolves once it exited; the hooks module passes `$.process.run`. */
export type Run = (argv: readonly string[], init: { stdin: string; timeoutMs: number }) => Promise<RunResult>

const TIMEOUT_MS = 5000

type BridgeAnswer = { segments: Segment[] } | { error: string }

export function anthyEngine(run: Run, bridgePath: string): ConversionEngine {
  const ask = async (request: object): Promise<readonly Segment[]> => {
    const ran = await run(['nvim', '--headless', '-l', bridgePath], {
      stdin: JSON.stringify(request) + '\n',
      timeoutMs: TIMEOUT_MS,
    })
    if (ran.exitCode !== 0) {
      throw new Error(`vime: the bridge exited with ${ran.exitCode}: ${ran.stderr.split('\n')[0]}`)
    }
    const answer = parse(ran.stdout)
    if ('error' in answer) throw new Error(`vime: ${answer.error}`)
    return answer.segments
  }

  return {
    convert: (yomi: string, resizes: readonly Resize[]) => ask({ yomi, resizes }),
    commit: async (yomi: string, resizes: readonly Resize[], choices: readonly number[]) => {
      await ask({ yomi, resizes, commit: choices })
    },
  }
}

function parse(stdout: string): BridgeAnswer {
  const line = stdout.trim()
  try {
    const answer: unknown = JSON.parse(line)
    if (isBridgeAnswer(answer)) return answer
  } catch {
    // reported below
  }
  throw new Error(`vime: the bridge answered something other than its JSON: ${line}`)
}

function isBridgeAnswer(value: unknown): value is BridgeAnswer {
  if (typeof value !== 'object' || value === null) return false
  if ('error' in value) return typeof value.error === 'string'
  return 'segments' in value && Array.isArray(value.segments)
}
