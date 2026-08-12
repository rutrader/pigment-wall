declare global {
  interface Window {
    welcome: { done: () => void }
  }
}

document.querySelector<HTMLButtonElement>('#done')!.addEventListener('click', () => {
  window.welcome.done()
})

export {}
