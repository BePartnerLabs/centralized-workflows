// node --test scripts/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  alreadyCommented,
  previousTag,
  prNumbersFromCommits,
  resolveOption,
} from './release-to-project.mjs'

describe('prNumbersFromCommits', () => {
  it('saca el numero del asunto del squash-merge, sin repetidos y ordenado', () => {
    const messages = [
      'fix: payload 3.92 (#425)\n\ncuerpo (#999)',
      'chore: algo (#485)',
      'fix: otra vez (#425)',
    ]
    assert.deepEqual(prNumbersFromCommits(messages), [425, 485])
  })
  it('ignora commits sin (#NNN) al final del asunto', () => {
    assert.deepEqual(prNumbersFromCommits(['Merge branch main', 'fix: refs #12 en medio', '']), [])
  })
})

describe('previousTag', () => {
  const tags = ['v1.80.3', 'v1.9.0', 'v1.80.10', 'v1.80.4', 'v2.0.0', 'nightly']
  it('compara por semver, no como texto', () => {
    assert.equal(previousTag(tags, 'v1.80.4'), 'v1.80.3')
    assert.equal(previousTag(tags, 'v1.80.10'), 'v1.80.4')
  })
  it('ignora tags posteriores y no semver', () => {
    assert.equal(previousTag(tags, 'v1.80.3'), 'v1.9.0')
  })
  it('devuelve null si no hay anterior (primer release)', () => {
    assert.equal(previousTag(['v1.0.0'], 'v1.0.0'), null)
    assert.equal(previousTag([], 'v0.1.0'), null)
    assert.equal(previousTag(tags, 'nightly'), null)
  })
})

describe('alreadyCommented', () => {
  it('detecta el comentario del mismo tag', () => {
    assert.equal(alreadyCommented([{ body: 'Released in v1.80.4\n\nhttps://x' }], 'v1.80.4'), true)
    assert.equal(alreadyCommented([{ body: 'Released in v1.80.4' }], 'v1.80.4'), true)
    assert.equal(alreadyCommented(['Released in v1.80.4 !'], 'v1.80.4'), true)
  })
  it('no confunde otro tag', () => {
    assert.equal(alreadyCommented([{ body: 'Released in v1.80.3' }], 'v1.80.4'), false)
    assert.equal(alreadyCommented([], 'v1.80.4'), false)
  })
})

describe('resolveOption', () => {
  const fields = [
    {}, // campos que no son single-select llegan vacios desde el fragmento GraphQL
    { id: 'F1', name: 'Status', options: [{ id: 'o1', name: 'Done' }, { id: 'o2', name: 'Released' }] },
    { id: 'F2', name: 'Work type', options: [{ id: 'o3', name: 'Bump' }] },
  ]
  it('resuelve campo y opcion por nombre, sin distinguir mayusculas', () => {
    assert.deepEqual(resolveOption(fields, 'Status', 'Released'), { field: 'F1', option: 'o2' })
    assert.deepEqual(resolveOption(fields, 'work type', 'bump'), { field: 'F2', option: 'o3' })
  })
  it('lista los campos que hay cuando falta el campo', () => {
    assert.throws(() => resolveOption(fields, 'Site', 'X'), /hay: Status, Work type/)
  })
  it('lista las opciones que hay cuando falta la opcion', () => {
    assert.throws(() => resolveOption(fields, 'Status', 'Shipped'), /hay: Done, Released/)
  })
})
