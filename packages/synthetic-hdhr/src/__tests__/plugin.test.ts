import { describe, test, expect } from 'bun:test'
import * as actionDefs from '../actions'
import * as eventDefs from '../events'
import { channing } from '../persona'

describe('plugin structure', () => {
  test('all actions have http, ai, ui declared', () => {
    for (const [name, action] of Object.entries(actionDefs)) {
      expect(action.http, `${name}: http missing`).toBeDefined()
      expect(action.ai, `${name}: ai missing`).not.toBeUndefined()
      expect(action.ui, `${name}: ui missing`).not.toBeUndefined()
    }
  })

  test('get_lineup has inform tier', () => {
    expect(actionDefs.getLineup.ai).not.toBe(false)
    if (actionDefs.getLineup.ai !== false) {
      expect(actionDefs.getLineup.ai.tier).toBe('inform')
    }
  })

  test('add_library_channel has advise tier', () => {
    if (actionDefs.addLibraryChannel.ai !== false) {
      expect(actionDefs.addLibraryChannel.ai.tier).toBe('advise')
    }
  })

  test('remove_library_channel has advise tier', () => {
    if (actionDefs.removeLibraryChannel.ai !== false) {
      expect(actionDefs.removeLibraryChannel.ai.tier).toBe('advise')
    }
  })
})

describe('Channing persona', () => {
  test('eventSubscriptions cover TV and Plex topics', () => {
    expect(channing.eventSubscriptions.some(s => s.includes('media/plex'))).toBe(true)
    expect(channing.eventSubscriptions.some(s => s.includes('channels'))).toBe(true)
  })

  test('defaultTier is advise', () => {
    expect(channing.defaultTier).toBe('advise')
  })

  test('toolScopes include lineup management actions', () => {
    expect(channing.toolScopes).toContain('get_lineup')
    expect(channing.toolScopes).toContain('add_library_channel')
  })
})

describe('events', () => {
  test('streamError has advise tier and notify true', () => {
    expect(eventDefs.streamError.ai.tier).toBe('advise')
    expect(eventDefs.streamError.ui.notify).toBe(true)
  })

  test('epgRefreshed has ignore tier', () => {
    expect(eventDefs.epgRefreshed.ai.tier).toBe('ignore')
  })
})
