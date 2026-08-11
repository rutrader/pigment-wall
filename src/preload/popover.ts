import { contextBridge, ipcRenderer } from 'electron'

/**
 * The only bridge between the wall and the renderer.
 *
 * Context isolation is on and node integration off, so the popover is a plain
 * web page that cannot touch the filesystem. It never needs to: everything it
 * receives has already been through `payload()` in the main process, which
 * carries token counts and never a path, a project name or a byte of
 * transcript (SPEC §8).
 */

export type Bridge = {
  onSnapshot: (handler: (snapshot: unknown) => void) => void
  request: () => Promise<unknown>
}

contextBridge.exposeInMainWorld('pigment', {
  onSnapshot: (handler: (snapshot: unknown) => void) => {
    ipcRenderer.on('pigment:snapshot', (_event, snapshot) => handler(snapshot))
  },
  request: () => ipcRenderer.invoke('pigment:request'),
} satisfies Bridge)
