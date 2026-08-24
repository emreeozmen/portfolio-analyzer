import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from './ThemeContext'

function ThemeProbe() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button type="button" onClick={toggleTheme}>
      {theme}
    </button>
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('ThemeProvider', () => {
  it('defaults to dark when no preference is saved', () => {
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(screen.getByText('dark')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('reads a previously saved light preference on mount', () => {
    localStorage.setItem('pa_theme', 'light')
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )
    expect(screen.getByText('light')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('toggles theme, updates <html data-theme>, and persists to localStorage', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <ThemeProbe />
      </ThemeProvider>,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('light')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(localStorage.getItem('pa_theme')).toBe('light')

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('dark')).toBeInTheDocument()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('pa_theme')).toBe('dark')
  })
})
