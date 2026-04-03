import { Hono } from 'hono'
import {
  listPersonas,
  getPersona,
  createPersona,
  updatePersona,
  deletePersona,
} from '../../../plugin-core/src/actions'

const noopCtx = {} as never

export function createPersonasRouter() {
  const router = new Hono()

  router.get('/personas', async (c) => {
    try {
      const personas = await listPersonas.execute({}, noopCtx)
      return c.json(personas)
    } catch (err) {
      console.error('[personas] list error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  router.get('/personas/:name', async (c) => {
    try {
      const persona = await getPersona.execute({ name: c.req.param('name') }, noopCtx)
      return c.json(persona)
    } catch (err) {
      const msg = String(err)
      return c.json({ error: msg }, msg.includes('not found') ? 404 : 500)
    }
  })

  router.post('/personas', async (c) => {
    try {
      const body = await c.req.json()
      const persona = await createPersona.execute(body, noopCtx)
      return c.json(persona, 201)
    } catch (err) {
      console.error('[personas] create error:', err)
      return c.json({ error: String(err) }, 500)
    }
  })

  router.patch('/personas/:name', async (c) => {
    try {
      const body = await c.req.json()
      const persona = await updatePersona.execute({ ...body, name: c.req.param('name') }, noopCtx)
      return c.json(persona)
    } catch (err) {
      const msg = String(err)
      return c.json({ error: msg }, msg.includes('not found') ? 404 : 500)
    }
  })

  router.delete('/personas/:name', async (c) => {
    try {
      const result = await deletePersona.execute({ name: c.req.param('name') }, noopCtx)
      return c.json(result)
    } catch (err) {
      const msg = String(err)
      if (msg.includes('built-in')) return c.json({ error: msg }, 403)
      return c.json({ error: msg }, msg.includes('not found') ? 404 : 500)
    }
  })

  return router
}
