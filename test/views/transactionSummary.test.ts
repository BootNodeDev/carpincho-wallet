import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  commandCount,
  commandSummary,
  executeParams,
  optionalString,
  requestedActAs,
  transactionCommands,
} from '@/views/home/transactionSummary'

describe('executeParams', () => {
  it('passes a plain params object through untouched', () => {
    const params = { commands: [], actAs: ['bob::fp'] }
    assert.deepEqual(executeParams(params), params)
  })

  it('reads anything that is not a plain object as empty params', () => {
    assert.deepEqual(executeParams(null), {})
    assert.deepEqual(executeParams(['ignored']), {})
  })
})

describe('requestedActAs', () => {
  it('reads the party a dApp asks to act as', () => {
    assert.equal(requestedActAs({ actAs: ['bob::fp'] }), 'bob::fp')
  })

  it('takes the first party when a request names several', () => {
    assert.equal(requestedActAs({ actAs: ['bob::fp', 'alice::fp'] }), 'bob::fp')
  })

  it('is undefined when the dApp names no party, leaving the choice to the wallet', () => {
    assert.equal(requestedActAs({}), undefined)
    assert.equal(requestedActAs({ actAs: [] }), undefined)
    assert.equal(requestedActAs({ actAs: 'bob::fp' }), undefined)
    assert.equal(requestedActAs({ actAs: [42] }), undefined)
  })
})

describe('transactionCommands and commandCount', () => {
  it('returns the command array when present', () => {
    const commands = [{ CreateCommand: {} }]
    assert.deepEqual(transactionCommands({ commands }), commands)
    assert.equal(commandCount({ commands }), 1)
  })

  it('returns undefined when commands are missing or not an array', () => {
    assert.equal(transactionCommands({}), undefined)
    assert.equal(transactionCommands({ commands: 'nope' }), undefined)
    assert.equal(commandCount({}), undefined)
  })
})

describe('commandSummary', () => {
  it('falls back to a generic label with no commands', () => {
    assert.equal(commandSummary({}), 'Canton transaction')
    assert.equal(commandSummary({ commands: [] }), 'Canton transaction')
  })

  it('uses the first command kind for a single command', () => {
    assert.equal(commandSummary({ commands: [{ CreateCommand: {} }] }), 'CreateCommand')
  })

  it('appends a remainder count for multiple commands', () => {
    assert.equal(
      commandSummary({ commands: [{ CreateCommand: {} }, { ExerciseCommand: {} }] }),
      'CreateCommand + 1 more',
    )
  })

  it('counts commands when the first entry has no usable kind', () => {
    assert.equal(commandSummary({ commands: ['raw', 'raw'] }), '2 commands')
    assert.equal(commandSummary({ commands: [{}] }), '1 command')
  })
})

describe('optionalString', () => {
  it('keeps non-empty strings and drops everything else', () => {
    assert.equal(optionalString('value'), 'value')
    assert.equal(optionalString(''), undefined)
    assert.equal(optionalString(undefined), undefined)
    assert.equal(optionalString(42), undefined)
  })
})
