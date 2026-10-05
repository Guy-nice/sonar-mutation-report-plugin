import { SonarApi } from './api';
import { parseContext } from './context';
import { renderProjectPage } from './ui/projectPage';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/project', (options) => {
  void renderProjectPage(options.el, new SonarApi(), parseContext(options));
  return () => {
    options.el.innerHTML = '';
  };
});
