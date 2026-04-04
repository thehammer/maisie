import { Hono } from 'hono'
import {
  getLayout,
  updateLayout,
  resetLayout,
  setWidgetVisibility,
  reorderWidgets,
  patchWidget,
  getWidgetCatalog,
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

  // PATCH /api/layout/:page/widgets/:widgetId/visibility — show/hide
  router.patch('/layout/:page/widgets/:widgetId/visibility', async (c) => {
    try {
      const body = await c.req.json()
      const result = await setWidgetVisibility.execute({
        page: c.req.param('page'),
        widgetId: c.req.param('widgetId'),
        visible: body.visible,
      }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // PATCH /api/layout/:page/widgets/:widgetId — patch col_span or visibility
  router.patch('/layout/:page/widgets/:widgetId', async (c) => {
    try {
      const body = await c.req.json()
      const result = await patchWidget.execute({
        page: c.req.param('page'),
        widgetId: c.req.param('widgetId'),
        ...body,
      }, noopCtx)
      return c.json(result)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  // GET /api/widgets/catalog — all available widgets
  router.get('/widgets/catalog', async (c) => {
    try {
      const catalog = await getWidgetCatalog.execute({}, noopCtx)
      return c.json(catalog)
    } catch (err) {
      return c.json({ error: String(err) }, 500)
    }
  })

  return router
}
