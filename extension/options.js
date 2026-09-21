const input = document.getElementById('url');
const status = document.getElementById('status');

chrome.storage.local.get('yotramUrl', ({ yotramUrl }) => {
  if (yotramUrl) input.value = yotramUrl;
});

document.getElementById('settings').addEventListener('submit', (event) => {
  event.preventDefault();
  const url = input.value.replace(/\/$/, '');
  chrome.storage.local.set({ yotramUrl: url }, () => {
    status.textContent = 'Saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});
