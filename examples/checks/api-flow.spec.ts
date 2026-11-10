// API multistep check: each step uses what the previous one returned. Specs
// that never touch `page` run without a browser.
import { test, expect } from 'playwright-synthetic-exporter';

const base = process.env.API_BASE_URL ?? 'https://jsonplaceholder.typicode.com';

test('user, posts, new post', async ({ request }) => {
  const user = await test.step('read user', async () => {
    const res = await request.get(`${base}/users/1`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id', 1);
    return body;
  });

  await test.step('list posts', async () => {
    const res = await request.get(`${base}/posts`, { params: { userId: user.id } });
    expect(res.status()).toBe(200);
    const posts = await res.json();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p: { userId: number }) => p.userId === user.id)).toBe(true);
  });

  await test.step('create post', async () => {
    const res = await request.post(`${base}/posts`, {
      data: { userId: user.id, title: 'synthetic check', body: 'created by playwright-synthetic-exporter' },
    });
    expect(res.status()).toBe(201);
    expect(await res.json()).toMatchObject({ userId: user.id, title: 'synthetic check' });
  });
});
