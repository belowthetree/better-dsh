/** Browser half: provide `ctx.surface` over the Desktop preload bridge or the inert Web carrier. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSurfaceAdapter } from './adapters.ts'
import { SurfaceRuntime } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** One renderer window's role, form, and presentation state. */
    surface: import('./service.ts').SurfaceService
  }
}

export type { SurfaceService } from './service.ts'
export type { ModalSizeHint, SurfaceMessage, SurfaceMessageRole, SurfaceSnapshot } from '../protocol.ts'

/**
 * Client plugin body: create the carrier adapter, provide `ctx.surface`, and
 * follow carrier notifications for the plugin lifetime.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const runtime = new SurfaceRuntime(createSurfaceAdapter(window))
  ctx.effect(() => runtime.connect(), 'surface: carrier subscription')
  ctx.reflect.provide('surface', runtime)
}
