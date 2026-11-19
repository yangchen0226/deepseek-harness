// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryHeaderAction } from '../src/client/MemoryHeaderAction.tsx'
import { en, type MemoryKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: MemoryKey) => en[key]

describe('MemoryHeaderAction', () => {
  it('exposes the panel name as its accessible label', () => {
    render(<MemoryHeaderAction open={() => {}} t={t} />)
    expect(screen.getByRole('button', { name: en.headerAction })).toBeDefined()
  })

  it('opens the panel when clicked', () => {
    const open = vi.fn()
    render(<MemoryHeaderAction open={open} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: en.headerAction }))
    expect(open).toHaveBeenCalledTimes(1)
  })
})
