import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { createDbContractVitestConfig } from '../../vitest.db-contract.config'

import {
  EXPECTED_CONTROL_PLANE_ASSERTIONS,
  EXPECTED_REAL_ASSERTIONS,
  EXPECTED_TOTAL_ASSERTIONS,
  SUITE_MANIFEST,
  TOPOLOGY_VERSION,
  classifyTestId,
  getTopologySummary,
} from './topology'
import { hasNeonCreds } from './harness'

const CONTRACT_TEST_DIR = dirname(fileURLToPath(import.meta.url))
const ROUTED_SUITES = [
  'accept-path',
  'baseline',
  'collaboration',
  'meeting-ingest',
  'memory-curator',
  'memory-tier',
] as const

type RoutedHelper = 'transactional' | 'dedicated'

interface CallSite {
  readonly title: string
  readonly helpers: readonly string[]
  readonly suiteScope?: string
}

function nearestSuiteScope(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node
  while (current?.parent) {
    const parent: ts.Node = current.parent
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isCallExpression(parent.parent)
      && parent.parent.expression.getText().startsWith('describe')) {
      const title = parent.parent.arguments[0]
      if (title && ts.isStringLiteralLike(title)) return title.text
    }
    current = parent
  }
  return undefined
}

/**
 * Read helper choices from the TypeScript AST rather than inferring isolation
 * from a filename or a test-id prefix. The explicit topology manifest remains
 * the authority; this only proves each manifest entry is wired to its declared
 * helper at the call site.
 */
function readCallSites(suiteId: string): {
  readonly callSites: readonly CallSite[]
  readonly transactionalAliases: ReadonlySet<string>
  readonly legacyCalls: number
  readonly factoryCalls: number
} {
  const fileName = join(CONTRACT_TEST_DIR, `${suiteId}.test.ts`)
  const source = ts.createSourceFile(
    fileName,
    readFileSync(fileName, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const transactionalAliases = new Set<string>()
  let legacyCalls = 0
  let factoryCalls = 0
  const callSites: CallSite[] = []

  const isNamedCall = (node: ts.Node | undefined, name: string): node is ts.CallExpression =>
    node !== undefined && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === name

  const unwrap = (expression: ts.Expression | undefined): ts.Expression | undefined => {
    let current = expression
    while (
      current !== undefined &&
      (ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current))
    ) {
      current = current.expression
    }
    return current
  }

  const collectHelpers = (root: ts.Node): string[] => {
    const helpers: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text
        if (name === 'withDedicatedDbBranch' || name === 'withTransactionalDb' || transactionalAliases.has(name)) {
          helpers.push(name)
        }
      }
      ts.forEachChild(node, visit)
    }
    ts.forEachChild(root, visit)
    return helpers
  }

  const visit = (node: ts.Node): void => {
    if (isNamedCall(node, 'withDbBranch')) legacyCalls += 1
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isNamedCall(unwrap(node.initializer), 'withTransactionalDb')
    ) {
      transactionalAliases.add(node.name.text)
    }
    if (isNamedCall(node, 'withTransactionalDb')) factoryCalls += 1

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const titleArgument = node.arguments[0]
      if (
        (node.expression.text === 'it' || node.expression.text === 'test') &&
        node.arguments.length > 1 &&
        titleArgument !== undefined &&
        ts.isStringLiteralLike(titleArgument)
      ) {
        const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
        callSites.push({
          title: titleArgument.text,
          helpers: callback ? collectHelpers(callback) : [],
          suiteScope: nearestSuiteScope(node),
        })
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return { callSites, transactionalAliases, legacyCalls, factoryCalls }
}

function expectedHelper(executionClass: string): RoutedHelper {
  if (executionClass === 'transactional-suite') return 'transactional'
  if (executionClass === 'dedicated-branch') return 'dedicated'
  throw new Error(`non-real assertion in routed suite: ${executionClass}`)
}

describe('db-contract topology lock', () => {
  it('uses only the list marker for metadata collection and keeps normal runs guarded', () => {
    const previous = process.env.DB_CONTRACT_LIST_ONLY

    try {
      process.env.DB_CONTRACT_LIST_ONLY = '1'
      const listConfig = createDbContractVitestConfig()
      expect(listConfig.test?.include).toEqual([
        'test/db-contract/{accept-path,baseline,collaboration,meeting-ingest,memory-curator,memory-tier,neon-authority,reap,role-privileges}.test.ts',
      ])
      expect(listConfig.test?.include?.every((pattern) => !pattern.includes('\\'))).toBe(true)
      expect(listConfig.test?.fileParallelism).toBe(true)
      expect(listConfig.test?.maxWorkers).toBe(2)
      expect(listConfig.test?.maxConcurrency).toBe(1)
      expect(listConfig.test?.hookTimeout).toBe(540_000)
      expect(listConfig.test?.hookTimeout).toBeGreaterThanOrEqual(
        300_000 + 120_000 + 30_000 + 30_000,
      )
      expect(listConfig.test?.globalSetup).toBeUndefined()
      expect(listConfig.test?.reporters).toEqual(['default'])
      expect(hasNeonCreds({ DB_CONTRACT_LIST_ONLY: '1' })).toBe(true)

      delete process.env.DB_CONTRACT_LIST_ONLY
      const normalConfig = createDbContractVitestConfig()
      expect(normalConfig.test?.globalSetup).toEqual(['./test/db-contract/reap-setup.ts'])
      expect(normalConfig.test?.reporters).toEqual(['default', './test/db-contract/zero-skip-reporter.ts'])
      expect(normalConfig.test?.hookTimeout).toBe(540_000)
      expect(hasNeonCreds({})).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.DB_CONTRACT_LIST_ONLY
      else process.env.DB_CONTRACT_LIST_ONLY = previous
    }
  })

  it('locks the 57-test inventory and its three execution classes', () => {
    const summary = getTopologySummary()

    expect(TOPOLOGY_VERSION).toBe('db-contract-v1')
    expect(summary.totalAssertions).toBe(EXPECTED_TOTAL_ASSERTIONS)
    expect(summary.realAssertions).toBe(EXPECTED_REAL_ASSERTIONS)
    expect(summary.controlPlaneAssertions).toBe(EXPECTED_CONTROL_PLANE_ASSERTIONS)
    expect(summary.transactionalAssertions).toBe(19)
    expect(summary.dedicatedAssertions).toBe(9)
    expect(summary.controlPlaneBySuite).toEqual({
      'neon-authority': 18,
      'role-privileges': 7,
      reap: 4,
    })
    expect(SUITE_MANIFEST.every((entry) => entry.executionClass)).toBe(true)
  })

  it('classifies only explicit manifest ids, never a destructive prefix', () => {
    expect(classifyTestId('accept-path:2')).toMatchObject({ executionClass: 'transactional-suite' })
    expect(classifyTestId('accept-path:8')).toMatchObject({ executionClass: 'dedicated-branch' })
    expect(classifyTestId('accept-path:8-extra')).toBeUndefined()
    expect(classifyTestId('accept-path:999')).toBeUndefined()
  })

  it('keeps control-plane assertions out of branch coverage', () => {
    const role = classifyTestId('role-privileges:1')
    const authority = classifyTestId('neon-authority:1')
    const reap = classifyTestId('reap:1')

    expect(role).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'role-privileges' })
    expect(authority).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'neon-authority' })
    expect(reap).toMatchObject({ executionClass: 'control-plane-unit', suiteId: 'reap' })
    expect(role?.branchCoverage).toBe(false)
    expect(authority?.branchCoverage).toBe(false)
    expect(reap?.branchCoverage).toBe(false)
  })

  it('derives control-plane counts from the supplied manifest', () => {
    const withoutOneReapAssertion = SUITE_MANIFEST.filter((entry) => entry.id !== 'reap:4')

    expect(getTopologySummary(withoutOneReapAssertion).controlPlaneBySuite).toEqual({
      'neon-authority': 18,
      'role-privileges': 7,
      reap: 3,
    })
  })

  it('routes every real call site according to the explicit topology manifest', () => {
    for (const suiteId of ROUTED_SUITES) {
      const { callSites, transactionalAliases, legacyCalls, factoryCalls } = readCallSites(suiteId)
      const entries = SUITE_MANIFEST.filter((entry) => entry.suiteId === suiteId)
      const byTitle = new Map(callSites.map((callSite) => [callSite.title, callSite]))

      expect(legacyCalls, `${suiteId} still uses compatibility withDbBranch`).toBe(0)
      const transactionalEntryCount = entries.filter((entry) => entry.executionClass === 'transactional-suite').length
      expect(factoryCalls, `${suiteId} transactional runner factories`).toBe(transactionalAliases.size)
      if (transactionalEntryCount > 0) expect(transactionalAliases.size).toBeGreaterThan(0)

      for (const entry of entries) {
        const callSite = byTitle.get(entry.title ?? '')
        expect(callSite, `${suiteId} is missing ${entry.id}`).toBeDefined()
        expect(callSite?.helpers, `${entry.id} helper mismatch`).toHaveLength(1)
        const helper = callSite?.helpers[0]
        const expected = expectedHelper(entry.executionClass)
        const actual =
          helper === 'withDedicatedDbBranch'
            ? 'dedicated'
            : helper !== undefined && transactionalAliases.has(helper)
              ? 'transactional'
              : undefined
        expect(actual, `${entry.id} helper mismatch`).toBe(expected)
      }
      expect(callSites).toHaveLength(entries.length)
    }
  })

  it('keeps mixed files from holding a suite lease while dedicated tests run', () => {
    for (const suiteId of ['accept-path', 'baseline', 'meeting-ingest']) {
      const { callSites } = readCallSites(suiteId)
      const transactionalScopes = new Set(callSites
        .filter(({ helpers }) => helpers.some((helper) => helper !== 'withDedicatedDbBranch'))
        .map(({ suiteScope }) => suiteScope))
      const dedicatedScopes = new Set(callSites
        .filter(({ helpers }) => helpers.includes('withDedicatedDbBranch'))
        .map(({ suiteScope }) => suiteScope))

      expect(transactionalScopes.size, `${suiteId} transactional lifecycle scope`).toBeGreaterThan(0)
      expect(dedicatedScopes.size, `${suiteId} dedicated lifecycle scope`).toBeGreaterThan(0)
      expect([...transactionalScopes].some((scope) => dedicatedScopes.has(scope)), `${suiteId} lifecycle overlap`)
        .toBe(false)
    }
  })
})
