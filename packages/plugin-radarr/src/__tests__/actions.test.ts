import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'

describe('search_movies action', () => {
  test('requires query parameter', () => {
    const action = actionDefs.searchMovies
    expect(action.input.safeParse({ query: 'Dune' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
    expect(action.input.safeParse({ query: 123 }).success).toBe(false)
  })
})

describe('add_movie action', () => {
  test('requires title and year', () => {
    const action = actionDefs.addMovie
    expect(action.input.safeParse({ title: 'Dune', year: 2021 }).success).toBe(true)
    expect(action.input.safeParse({ title: 'Dune' }).success).toBe(false)
    expect(action.input.safeParse({ year: 2021 }).success).toBe(false)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('has advise tier', () => {
    const action = actionDefs.addMovie
    expect(action.ai).not.toBe(false)
    if (action.ai !== false) {
      expect(action.ai.tier).toBe('advise')
    }
  })

  test('tmdbId is optional', () => {
    const action = actionDefs.addMovie
    expect(action.input.safeParse({ title: 'Dune', year: 2021 }).success).toBe(true)
    expect(action.input.safeParse({ title: 'Dune', year: 2021, tmdbId: 438631 }).success).toBe(true)
  })
})

describe('check_movie_status action', () => {
  test('requires title', () => {
    const action = actionDefs.checkMovieStatus
    expect(action.input.safeParse({ title: 'Dune' }).success).toBe(true)
    expect(action.input.safeParse({}).success).toBe(false)
  })

  test('year is optional', () => {
    const action = actionDefs.checkMovieStatus
    expect(action.input.safeParse({ title: 'Dune', year: 2021 }).success).toBe(true)
    expect(action.input.safeParse({ title: 'Dune' }).success).toBe(true)
  })
})

describe('plugin structure', () => {
  test('all actions have http explicitly set', () => {
    for (const action of Object.values(actionDefs)) {
      expect(action.http).toBeDefined()
      expect(action.http.method).toBeDefined()
    }
  })

  test('all actions have ai explicitly set (or false)', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.ai, `action ${name} must have ai declared`).toBeDefined()
    }
  })

  test('all actions have ui explicitly set (or false)', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.ui, `action ${name} must have ui declared`).toBeDefined()
    }
  })
})
