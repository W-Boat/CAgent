/** Enter confirms a Chinese IME candidate without sending the unfinished message. */
export function composerKeys(send: () => unknown) {
  let composing = false
  return {
    start: () => { composing = true },
    end: () => { composing = false },
    keydown: (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || composing || event.isComposing || event.keyCode === 229 ||
          event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      void send()
    }
  }
}
