import type { MemoryScopeType } from '../agent/memory-retrieval'

/**
 * QUALITY-IN-ISOLATION — the first half of SAP's Global Curator (research
 * §1.10B / arXiv 2607.03228 §5.2): is this candidate well-formed as a standalone
 * memory, judged without looking at anything else in the store?
 *
 * The paper's isolation checks are "a meaningful name, a clearly defined scope, and a
 * single rule". This module is that list, split so each concern is one code, one
 * reason, one test. Deliberately NOT a score: a reviewer cannot act on "0.4", but can
 * act on "the body states three separate directives". Every finding therefore carries a
 * sentence that names the evidence it found.
 *
 * Everything here is pure and synchronous — no database, no model. The relation half
 * (duplicate / overlap / conflict against existing memory) lives in `relation.ts`.
 */

/** The candidate memory a proposal is asking a human to log, normalised for checking. */
export interface CuratorCandidate {
  kind: 'decision' | 'fact' | 'rule' | null
  title: string
  body: string
  topics: string[]
  /** `attrs.applies_when` — SAP's Applicability field, when the payload states it. */
  appliesWhen: string | null
  scopeType: MemoryScopeType
  scopeId: string | null
}

/** One thing wrong with the candidate on its own. */
export interface CuratorQualityFinding {
  code: 'title_missing' | 'title_placeholder' | 'title_terse' | 'bundled_assertions' | 'applicability_missing'
  reason: string
}

/**
 * Titles that name the container instead of the content. A memory titled "Note" is
 * unrecognisable in a list of two hundred, which defeats the point of having a title.
 */
const PLACEHOLDER_TITLES = new Set([
  'note',
  'notes',
  'todo',
  'tbd',
  'memory',
  'memories',
  'rule',
  'rules',
  'fact',
  'facts',
  'decision',
  'decisions',
  'update',
  'updates',
  'misc',
  'untitled',
  'n/a',
  'na',
  'none',
  'placeholder',
])

/** A title should name the situation AND the position taken — three words is the floor. */
const MIN_TITLE_WORDS = 3

/** Words that mark a sentence as stating a directive (SAP's "Action"). */
const DIRECTIVE_RE =
  /\b(must not|must|shall not|shall|should not|should|always|never|require[sd]?|requires|prohibited?|forbidden|mandatory|do not|don't)\b/i

/**
 * Words that state WHEN a rule binds (SAP's "Applicability"). Kept broad on purpose:
 * the check exists to catch a rule with no trigger condition at all, not to police how
 * the condition is phrased. A false accusation of missing applicability is worse than a
 * missed one, because it trains reviewers to ignore the panel.
 */
const APPLICABILITY_RE =
  /\b(when|whenever|if|unless|before|after|during|while|for any|for all|for every|applies to|in cases?)\b/i

/** A markdown-ish list item: `- x`, `* x`, `• x`, `1. x`, `2) x`. */
const LIST_ITEM_RE = /^\s*(?:[-*•]|\d+[.)])\s+\S/

/** Sentence boundaries: terminal punctuation, or a hard line break. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter((w) => w.length > 0)
}

/** `1 word` / `2 words` — the count is the evidence, so it goes in the reason verbatim. */
function pluralWords(count: number): string {
  return count === 1 ? '1 word' : `${count} words`
}

/**
 * The title checks, which are MUTUALLY EXCLUSIVE (missing beats placeholder beats
 * terse). One bad title must produce one finding — reporting a blank title as also
 * placeholder and also terse would read as three separate problems.
 */
function checkTitle(title: string): CuratorQualityFinding | null {
  const trimmed = title.trim()
  if (trimmed.length === 0) {
    return {
      code: 'title_missing',
      reason: 'This memory has no title, so nothing identifies it in the memory list or in an injected context block.',
    }
  }

  const normalised = trimmed.toLowerCase().replace(/[.!?:;,]+$/, '')
  if (PLACEHOLDER_TITLES.has(normalised)) {
    return {
      code: 'title_placeholder',
      reason: `The title is just “${trimmed}” — a placeholder that names the container, not what this memory says. A reviewer scanning the list will not be able to tell it apart from any other memory.`,
    }
  }

  const count = words(trimmed).length
  if (count < MIN_TITLE_WORDS) {
    return {
      code: 'title_terse',
      reason: `The title is ${pluralWords(count)} long. A memory title should name both the situation and the position taken, so it can be recognised without opening it.`,
    }
  }
  return null
}

/**
 * SAP: "one atom = exactly one rule". Two independent signals, because bundling shows
 * up two different ways in practice — several directive sentences, or an enumerated
 * list. Either way the reason names the count, since the count is the evidence.
 */
function checkSingleAssertion(candidate: CuratorCandidate): CuratorQualityFinding | null {
  const listItems = candidate.body.split(/\n/).filter((line) => LIST_ITEM_RE.test(line))
  if (listItems.length >= 2) {
    return {
      code: 'bundled_assertions',
      reason: `The body enumerates ${listItems.length} items. A memory should carry a single assertion, so that one part of it can later be superseded or retracted without disturbing the rest.`,
    }
  }

  const directiveSentences = sentences(`${candidate.title}. ${candidate.body}`).filter((s) =>
    DIRECTIVE_RE.test(s),
  )
  if (directiveSentences.length >= 2) {
    return {
      code: 'bundled_assertions',
      reason: `This states ${directiveSentences.length} separate directives (“${directiveSentences
        .slice(0, 2)
        .join('” / “')}”). Split them: a bundled memory cannot be superseded one part at a time.`,
    }
  }
  return null
}

/**
 * A `rule` is the one kind whose meaning depends on knowing WHEN it binds, so it is the
 * one kind for which absent applicability is a defect. Demanding a trigger condition of
 * a `fact` ("the cutover finished in March") or a `decision` would be noise. An unknown
 * kind is not accused of anything.
 */
function checkApplicability(candidate: CuratorCandidate): CuratorQualityFinding | null {
  if (candidate.kind !== 'rule') return null
  if (candidate.appliesWhen !== null && candidate.appliesWhen.trim().length > 0) return null
  if (APPLICABILITY_RE.test(`${candidate.title} ${candidate.body}`)) return null
  return {
    code: 'applicability_missing',
    reason:
      'This is a rule but it never says when it applies — there is no attrs.applies_when and no condition in the text, so an agent cannot tell whether it binds to the situation in front of it.',
  }
}

/**
 * Run every isolation check. Order is stable (title, then bundling, then applicability)
 * so the panel reads the same way every time.
 */
export function checkQuality(candidate: CuratorCandidate): CuratorQualityFinding[] {
  const findings: CuratorQualityFinding[] = []
  const title = checkTitle(candidate.title)
  if (title) findings.push(title)
  const bundled = checkSingleAssertion(candidate)
  if (bundled) findings.push(bundled)
  const applicability = checkApplicability(candidate)
  if (applicability) findings.push(applicability)
  return findings
}
