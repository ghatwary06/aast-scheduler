import { installSubmitBlocker, pageOf } from '../portal/safety';

// Runs in the page's own JS world while the reader works. It refuses every form submission and
// postback except the page's allowlisted ones (none are needed by the reader), then removes itself.
const uninstall = installSubmitBlocker(window, pageOf(location.href));
document.addEventListener('aast-reader-finished', () => uninstall(), { once: true });
