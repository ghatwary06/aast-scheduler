import { sept24 } from '../sample/sept24';
import { mountApp } from './app';

const root = document.getElementById('app');
if (root) {
  void mountApp(root).then(async (app) => {
    // ?demo loads the example data on an empty install (used for screenshots)
    if (!app.state.dataset && new URLSearchParams(location.search).has('demo')) await app.loadDataset(JSON.parse(JSON.stringify(sept24)));
  });
}
