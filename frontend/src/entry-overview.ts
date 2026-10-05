import { SonarApi } from './api';
import { renderOverview } from './ui/overview';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/overview', (options) => {
  renderOverview(options.el, new SonarApi());
  return () => {
    options.el.innerHTML = '';
  };
});
