type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/overview', (options) => {
  options.el.textContent = 'Mutation overview';
  return () => {
    options.el.innerHTML = '';
  };
});
