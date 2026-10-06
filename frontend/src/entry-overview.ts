import { SonarApi } from './api';
import { renderOverview } from './ui/overview';

type Registrar = (key: string, fn: (options: { el: HTMLElement }) => () => void) => void;

// One client per bundle: Sonar loads this script once and calls the function on each mount, so the
// 5 minute cache survives navigating away and back.
const api = new SonarApi();

(window as unknown as { registerExtension?: Registrar }).registerExtension?.('mutationreport/overview', (options) => {
  const page = renderOverview(options.el, api);
  return () => {
    page.dispose();
    options.el.innerHTML = '';
  };
});
