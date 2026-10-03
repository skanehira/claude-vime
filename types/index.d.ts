/** The focused segment's candidates and the chosen one's index, while converting. */
export type Candidates = { list: readonly string[]; index: number }

declare module 'claude-code' {
  interface PluginState {
    vime: { candidates: Candidates | null }
  }
}
