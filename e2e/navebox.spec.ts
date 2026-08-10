import { expect, test, type Page } from '@playwright/test';

async function waitForRuntime(page: Page, timeout = 120_000) {
  await expect(page.locator('.nbx-runtime-state.is-running')).toBeVisible({ timeout });
}

async function selectNodeMode(page: Page) {
  await page.locator('.nbx-mode-switch button', { hasText: 'Node' }).click();
  await page.getByRole('button', { name: /Run/ }).click();
  await waitForRuntime(page);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('preview leve compila React no browser', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForRuntime(page);
  const frame = page.locator('iframe[title="Preview do projeto"]').contentFrame();
  await expect(frame.getByText('Construa sem sair')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Node browser executa http, fs, crypto, terminal e API JSON', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForRuntime(page);
  await page.locator('select[aria-label="Selecionar template"]').selectOption('node-api');
  await selectNodeMode(page);

  const frame = page.locator('iframe[title="Preview do servidor Node"]').contentFrame();
  await expect(frame.getByText('Uma API viva')).toBeVisible();
  const api = await page.evaluate(async () => {
    const response = await fetch('/__virtual__/3000/api/health');
    return { status: response.status, body: await response.json() };
  });
  expect(api.status).toBe(200);
  expect(api.body).toMatchObject({ ok: true, runtime: 'node-browser' });

  const terminal = page.locator('input[aria-label="Comando do terminal"]');
  await terminal.fill('cat /project/data/message.txt');
  await terminal.press('Enter');
  await expect(page.getByText(/arquivo foi lido pela API usando node:fs/).last()).toBeVisible();
  expect(errors).toEqual([]);
});

test('Next App Router e route.ts respondem dentro do navegador', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForRuntime(page);
  await page.locator('select[aria-label="Selecionar template"]').selectOption('next');
  await selectNodeMode(page);

  const frame = page.locator('iframe[title="Preview do servidor Node"]').contentFrame();
  await expect(frame.getByText('Good afternoon.')).toBeVisible();
  const api = await page.evaluate(async () => {
    const response = await fetch('/__virtual__/3000/api/health');
    return { status: response.status, body: await response.json() };
  });
  expect(api).toMatchObject({ status: 200, body: { ok: true, runtime: 'next-api-browser' } });
  expect(errors).toEqual([]);
});

test('npm instala Express 5 e serve uma API real', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForRuntime(page);
  await page.locator('select[aria-label="Selecionar template"]').selectOption('express');
  await selectNodeMode(page);

  const frame = page.locator('iframe[title="Preview do servidor Node"]').contentFrame();
  await expect(frame.getByText('Backend,')).toBeVisible({ timeout: 120_000 });
  const api = await page.evaluate(async () => {
    const response = await fetch('/__virtual__/3000/api/health');
    return { status: response.status, body: await response.json() };
  });
  expect(api).toMatchObject({ status: 200, body: { ok: true, framework: 'express' } });
  await expect(page.locator('.nbx-terminal-output')).toContainText('Installed');
  expect(errors).toEqual([]);
});

test('modo Node instala npm e sobe React pelo Vite virtual', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  await waitForRuntime(page);
  await selectNodeMode(page);

  const frame = page.locator('iframe[title="Preview do servidor Node"]').contentFrame();
  await expect(frame.getByText('Construa sem sair')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.nbx-terminal-output')).toContainText('Installed');
  await expect(page.locator('.nbx-terminal-output')).toContainText('Vite dev server');
  expect(errors).toEqual([]);
});
