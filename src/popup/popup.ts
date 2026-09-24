document.getElementById('open')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('app/app.html') });
  window.close();
});

void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  const onPortal = tab?.url?.startsWith('https://alexreg.aast.edu/') ?? false;
  const note = document.getElementById('portal');
  if (note) {
    note.textContent = onPortal
      ? 'Reading the portal directly comes once registration reopens (it needs the Change Registered Courses page). For now, plan with imported data.'
      : 'Plan with imported data or the example. This extension never changes your registration.';
  }
});
