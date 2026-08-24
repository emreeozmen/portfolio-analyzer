import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Card from './Card'

describe('Card', () => {
  it('renders the label and value', () => {
    render(<Card label="Sharpe Oranı" value="1.23" />)
    expect(screen.getByText('Sharpe Oranı')).toBeInTheDocument()
    expect(screen.getByText('1.23')).toBeInTheDocument()
  })
})
