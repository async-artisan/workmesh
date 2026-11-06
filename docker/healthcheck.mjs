const port = Number(process.env.WEB_PORT ?? 5173);
const response = await fetch(`http://127.0.0.1:${port}/api/health`);
if (!response.ok) process.exit(1);
const body = await response.json();
if (body?.data?.status !== 'ok') process.exit(1);
