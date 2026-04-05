import { Hono } from 'hono'
import {
  getLayout,
  updateLayout,
  resetLayout,
  setWidgetVisibility,
  reorderWidgets,
  patchWidget,
  getCardCatalog,
} from '../../../plugin-core/src/actions'

const noopCtx = {} as never

export function createLayoutRouter() {
  const router = new Hono()

  // GET /api/layout/:page — current ordered widget config
  router.get('/layout/:page', async (c) => {
    try {
      const widgets = await getLayout.execute({ page: c.req.param('page') }, noopCtx)
      return c.json(widgets)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // POST /api/layout/:page — full replace
  router.post('/layout/:page', async (c) => {
    try {
      const body = await c.req.json()
      const result = await updateLayout.execute({ page: c.req.param('page'), widgets: body.widgets }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // DELETE /api/layout/:page — reset to defaults
  router.delete('/layout/:page', async (c) => {
    try {
      const result = await resetLayout.execute({ page: c.req.param('page') }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // PATCH /api/layout/:page/order — reorder widgets
  router.patch('/layout/:page/order', async (c) => {
    try {
      const body = await c.req.json()
      const result = await reorderWidgets.execute({ page: c.req.param('page'), orderedIds: body.orderedIds }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // PATCH /api/layout/:page/cards/:cardId/visibility — show/hide
  router.patch('/layout/:page/cards/:cardId/visibility', async (c) => {
    try {
      const body = await c.req.json()
      const result = await setWidgetVisibility.execute({
        page: c.req.param('page'),
        cardId: c.req.param('cardId'),
        visible: body.visible,
      }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // PATCH /api/layout/:page/cards/:cardId — patch col_span or visibility
  router.patch('/layout/:page/cards/:cardId', async (c) => {
    try {
      const body = await c.req.json()
      const result = await patchWidget.execute({
        page: c.req.param('page'),
        cardId: c.req.param('cardId'),
        ...body,
      }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // GET /api/cards/catalog — all available cards
  router.get('/cards/catalog', async (c) => {
    try {
      const catalog = await getCardCatalog.execute({}, noopCtx)
      return c.json(catalog)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return router
}
