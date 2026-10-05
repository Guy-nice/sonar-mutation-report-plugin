import { SonarApi } from './api';
import { parseContext } from './context';
import { renderProjectPage } from './ui/projectPage';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

// One client per bundle so the cache survives navigation (see entry-overview.ts).
const api = new SonarApi();

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/project', (options) => {
  void renderProjectPage(options.el, api, parseContext(options));
  return () => {
    options.el.innerHTML = '';
  };
});
