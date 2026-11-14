/** The host loader entry of this browser-only package provides no host-side behavior. */
import { expect, it } from 'vitest'
import { apply } from '../src/index.ts'

it('exports the inert Host Loader entry', () => {
  expect(apply).not.toThrow()
  apply()
})
