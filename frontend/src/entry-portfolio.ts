import { SonarApi } from './api';
import { parseContext } from './context';
import { renderPortfolioPage } from './ui/portfolioPage';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

// One client per bundle so the cache survives navigation (see entry-overview.ts).
const api = new SonarApi();

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/portfolio', (options) => {
  void renderPortfolioPage(options.el, api, parseContext(options).project);
  return () => {
    options.el.innerHTML = '';
  };
});
