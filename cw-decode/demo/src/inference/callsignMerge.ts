export interface CallsignObservation {
  value: string
  laneId: string
  confidence: number
  sourceText?: string
}

export interface CallsignCandidate {
  value: string
  observations: CallsignObservation[]
  confidence: number
  lanes: string[]
}

const CALLSIGN_RE = /^[A-Z]{1,2}[0-9][A-Z]{2,3}$/

interface CallsignSpan {
  value: string
  start: number
  end: number
  score: number
}

export function inferContestSpacing(text: string): string {
  const tokens = text.toUpperCase().match(/[A-Z0-9]+|[^A-Z0-9]+/g) ?? []
  return tokens.map((token) => {
    if (!/[A-Z0-9]/.test(token)) return ' '
    return spaceToken(token)
  }).join(' ').replace(/\s+/g, ' ').trim()
}

export function extractCallsignsFromText(
  text: string,
  laneId: string,
  confidence = 0.5,
): CallsignObservation[] {
  const observations: CallsignObservation[] = []
  const spaced = inferContestSpacing(text)
  const tokens = spaced.match(/[A-Z0-9]+/g) ?? []

  for (const token of tokens) {
    if (isPlausibleCallsign(token)) {
      observations.push({ value: token, laneId, confidence, sourceText: spaced })
    }
  }

  return observations
}

function spaceToken(token: string): string {
  const spans = bestNonOverlappingCandidates(findCallsignSpans(token))
  if (spans.length === 0) return token

  const parts: string[] = []
  let cursor = 0
  for (const span of spans) {
    const before = token.slice(cursor, span.start)
    if (before) parts.push(...spaceExchangeLikeText(before))
    parts.push(span.value)
    cursor = span.end
  }
  const after = token.slice(cursor)
  if (after) parts.push(...spaceExchangeLikeText(after))

  return parts.filter(Boolean).join(' ')
}

function spaceExchangeLikeText(text: string): string[] {
  const parts: string[] = []
  let cursor = 0
  while (cursor < text.length) {
    if (text.slice(cursor, cursor + 3) === '599') {
      parts.push('599')
      cursor += 3
      continue
    }
    const section = text.slice(cursor, cursor + 2)
    if (/^[A-Z]{2}$/.test(section)) {
      parts.push(section)
      cursor += 2
      continue
    }
    parts.push(text[cursor])
    cursor += 1
  }
  return parts
}

function findCallsignSpans(token: string): CallsignSpan[] {
  const candidates: CallsignSpan[] = []

  for (let digitIndex = 0; digitIndex < token.length; digitIndex++) {
    if (!/[0-9]/.test(token[digitIndex])) continue

    for (let prefixLen = 1; prefixLen <= 2; prefixLen++) {
      for (let suffixLen = 2; suffixLen <= 3; suffixLen++) {
        const start = digitIndex - prefixLen
        const end = digitIndex + 1 + suffixLen
        if (start < 0 || end > token.length) continue

        const value = token.slice(start, end)
        if (!isPlausibleCallsign(value)) continue
        candidates.push({ value, start, end, score: callsignScore(value) })
      }
    }
  }

  return candidates
}

function bestNonOverlappingCandidates(
  candidates: CallsignSpan[],
): CallsignSpan[] {
  const sorted = candidates.sort((a, b) => a.end - b.end || a.start - b.start)
  const best: Array<{ score: number; chosen: typeof candidates }> = [{ score: 0, chosen: [] }]

  for (let i = 0; i < sorted.length; i++) {
    const candidate = sorted[i]
    const compatibleCount = sorted.slice(0, i).filter((item) => item.end <= candidate.start).length
    const withCandidate = {
      score: best[compatibleCount].score + candidate.score,
      chosen: [...best[compatibleCount].chosen, candidate],
    }
    const withoutCandidate = best[i]
    best[i + 1] = betterCandidateSet(withCandidate, withoutCandidate)
  }

  return best[sorted.length].chosen
}

function isPlausibleCallsign(value: string): boolean {
  if (!CALLSIGN_RE.test(value)) return false
  const match = value.match(/^([A-Z]{1,2})[0-9]/)
  const prefix = match?.[1] ?? ''

  if (prefix.length === 1) return ['K', 'N', 'W'].includes(prefix)
  return true
}

function callsignScore(value: string): number {
  const match = value.match(/^([A-Z]{1,2})[0-9]([A-Z]{2,3})$/)
  if (!match) return 0
  const [, prefix, suffix] = match
  let score = 10
  if (suffix.length === 3) score += 1
  if (/^(AA|AB|AC|AD|AE|AF|AG|AI|AJ|AK|AL|K[A-Z]|N[A-Z]|W[A-Z]|VA|VE|VO|VY)$/.test(prefix)) score += 4
  if (/^[KNW]$/.test(prefix)) score += 4
  return score
}

function betterCandidateSet<T extends { score: number; chosen: Array<{ start: number; end: number }> }>(a: T, b: T): T {
  if (a.score !== b.score) return a.score > b.score ? a : b
  if (a.chosen.length !== b.chosen.length) return a.chosen.length > b.chosen.length ? a : b
  const aSpan = a.chosen.reduce((sum, item) => sum + item.end - item.start, 0)
  const bSpan = b.chosen.reduce((sum, item) => sum + item.end - item.start, 0)
  return aSpan >= bSpan ? a : b
}

export function mergeLikelyCallsigns(
  observations: CallsignObservation[],
  maxDistance = 1,
): CallsignCandidate[] {
  const groups: CallsignObservation[][] = []

  for (const observation of observations) {
    const group = groups.find((candidateGroup) =>
      candidateGroup.some((candidate) => areLikelySameCallsign(candidate.value, observation.value, maxDistance)),
    )
    if (group) group.push(observation)
    else groups.push([observation])
  }

  return groups
    .map((group) => {
      const value = bestCallsign(group)
      const confidence = 1 - group.reduce((miss, obs) => miss * (1 - clamp01(obs.confidence)), 1)
      const lanes = Array.from(new Set(group.map((obs) => obs.laneId))).sort()
      return { value, observations: group, confidence, lanes }
    })
    .sort((a, b) => b.confidence - a.confidence || b.observations.length - a.observations.length)
}

export function areLikelySameCallsign(a: string, b: string, maxDistance = 1): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > maxDistance) return false
  if (digitSignature(a) !== digitSignature(b)) return false
  return levenshtein(a, b) <= maxDistance
}

function bestCallsign(observations: CallsignObservation[]): string {
  const scores = new Map<string, number>()
  for (const obs of observations) {
    scores.set(obs.value, (scores.get(obs.value) ?? 0) + Math.max(0.05, obs.confidence))
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0] ?? ''
}

function digitSignature(value: string): string {
  return value.replace(/[A-Z]/g, '')
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function levenshtein(a: string, b: string): number {
  const prev = new Int32Array(b.length + 1)
  const curr = new Int32Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev.set(curr)
  }
  return prev[b.length]
}
