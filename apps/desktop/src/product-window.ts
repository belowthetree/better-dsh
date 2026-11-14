/** The single product window a Desktop profile presents, and the capabilities that resolve their owner from it. */
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import { assertDesktopSender } from './ipc.ts'

/**
 * Owns the product window that renders the client application. Microphone
 * authorization, the Host cookie filter, keyboard attachment, update-overlay
 * ownership, surface commands, and quit inspection all resolve their window
 * here instead of from a local variable, so the welcome window and any future
 * surface share one lifecycle.
 */
export class DesktopProductWindow {
  private window: BrowserWindow | undefined

  /**
   * The registered product window, or undefined before creation and once it is destroyed.
   * @returns the live product window.
   */
  current(): BrowserWindow | undefined {
    const window = this.window
    return window === undefined || window.isDestroyed() ? undefined : window
  }

  /**
   * Register the window this registry owns, replacing any previous registration.
   * @param window - newly constructed product window.
   */
  attach(window: BrowserWindow): void {
    this.window = window
  }

  /**
   * Forget a window only while it is still the registered owner.
   * @param window - window whose `closed` event fired.
   */
  detach(window: BrowserWindow): void {
    if (this.window === window) this.window = undefined
  }

  /**
   * Top-frame web contents of the product renderer.
   * @returns the renderer contents, or undefined while no product window exists.
   */
  webContents(): WebContents | undefined {
    return this.current()?.webContents
  }

  /**
   * Whether one main-process event comes from the product renderer's top frame.
   * @param event - event whose sender and sender frame are checked.
   * @returns true when this registry owns the sender.
   */
  owns(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>): boolean {
    const window = this.current()
    return window !== undefined && event.sender === window.webContents
      && event.senderFrame !== null && event.senderFrame === window.webContents.mainFrame
  }

  /**
   * Authorize one invoke event as product-renderer input.
   * @param event - IPC invoke event to authorize.
   * @returns the product window that owns the event.
   * @throws when the event is not from the owned Desktop application document or its top frame.
   */
  assertSender(event: IpcMainInvokeEvent): BrowserWindow {
    assertDesktopSender(event, ['app'])
    const window = this.current()
    if (window === undefined || !this.owns(event)) throw new Error('dsh desktop: rejected IPC from an unowned renderer')
    return window
  }

  /**
   * Deliver one channel to the product renderer when it exists.
   * @param channel - IPC channel name.
   * @param args - serializable payload.
   */
  send(channel: string, ...args: readonly unknown[]): void {
    const window = this.current()
    if (window !== undefined) window.webContents.send(channel, ...args)
  }
}
