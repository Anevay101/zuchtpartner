document.addEventListener('DOMContentLoaded', async () => {
  const session = await requireSession();
  if (!session) return;
  await renderSharedNav(session);
});
