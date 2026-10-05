type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/project', (options) => {
  options.el.textContent = 'Mutation';
  return () => {
    options.el.innerHTML = '';
  };
});
