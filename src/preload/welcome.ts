import { contextBridge, ipcRenderer } from 'electron'

/**
 * One channel: the button that dismisses first-run.
 *
 * The welcome panel makes a promise about what the app reads, so it is the last
 * place that should be handed filesystem access. Context isolation on, node
 * integration off, one method.
 */
contextBridge.exposeInMainWorld('welcome', {
  done: () => ipcRenderer.send('pigment:onboarded'),
})
