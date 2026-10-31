#!/usr/bin/env node
import { Command } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configuredClient } from './client';
import { saveConfig } from './config';
import { fetchAllRequirements } from './sync';

const cli = new Command()
  .name('reqflow')
  .description('ReqFlow command line tools')
  .version('1.0.0');
cli
  .command('init')
  .description('Create a local ReqFlow config')
  .option('--api <url>', 'API base URL', 'http://127.0.0.1:3000/api')
  .option('--project <id>', 'default project id')
  .action(async (options: { api: string; project?: string }) => {
    await saveConfig({ apiUrl: options.api, projectId: options.project });
    console.log('ReqFlow CLI config saved.');
  });
cli
  .command('login')
  .description('Authenticate the CLI with ReqFlow')
  .option('--api <url>', 'API base URL')
  .option('--email <email>', 'account email')
  .action(async (options: { api?: string; email?: string }) => {
    const { config, client } = await configuredClient(options.api);
    let email = options.email;
    let password = process.env.REQFLOW_PASSWORD;
    if ((!email || !password) && stdin.isTTY) {
      const prompt = createInterface({ input: stdin, output: stdout });
      email ??= (await prompt.question('Email: ')).trim();
      prompt.close();
      if (!password) password = await readHidden('Password: ');
    }
    if (!email || !password)
      throw new Error(
        'Provide --email and use a terminal prompt or REQFLOW_PASSWORD in non-interactive runs.',
      );
    const result = await client.request<{
      user: { email: string };
      accessToken: string;
      refreshToken: string;
    }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await saveConfig({
      apiUrl: config.apiUrl,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
    console.log(`Logged in as ${result.user.email}.`);
  });
cli
  .command('sync')
  .description('Pull requirements from a ReqFlow API')
  .option('--project <id>', 'project id')
  .option('--status <status>', 'status filter')
  .option('--out <file>', 'output JSON file', '.reqflow/requirements.json')
  .option('--api <url>', 'API base URL')
  .action(async (options: { api?: string; project?: string; status?: string; out: string }) => {
    const { config, client } = await configuredClient(options.api);
    const project = options.project ?? config.projectId;
    if (!project) throw new Error('--project is required (or run reqflow init --project <id>)');
    const payload = await fetchAllRequirements(
      (path) => client.request(path),
      project,
      options.status,
    );
    await mkdir(dirname(options.out), { recursive: true });
    await writeFile(options.out, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Saved requirements to ${options.out}`);
  });
cli
  .command('push')
  .description('Push local requirement changes to a ReqFlow API')
  .option('--api <url>', 'API base URL')
  .option('--input <file>', 'local requirements JSON', '.reqflow/requirements.json')
  .action(async (options: { api?: string; input: string }) => {
    const { client } = await configuredClient(options.api);
    const raw = JSON.parse(await readFile(options.input, 'utf8')) as unknown;
    const requirements = Array.isArray(raw) ? raw : ((raw as { items?: unknown[] }).items ?? []);
    let updated = 0;
    for (const item of requirements) {
      if (!item || typeof item !== 'object' || !('id' in item)) continue;
      const { id, ...data } = item as { id: string; [key: string]: unknown };
      await client.request(`/requirements/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      });
      updated += 1;
    }
    console.log(`Updated ${updated} requirements.`);
  });
cli
  .command('generate <requirementId>')
  .alias('prd')
  .description('Generate and save a PRD through the ReqFlow API')
  .option('--api <url>', 'API base URL')
  .option('--template <id>', 'template id')
  .option('--out <file>', 'Markdown output', 'PRD.md')
  .action(
    async (requirementId: string, options: { api?: string; template?: string; out: string }) => {
      const { client } = await configuredClient(options.api);
      const prd = await client.request<{
        id: string;
        requirementId: string;
        title: string;
        version: number;
        content: string;
        createdAt: string;
      }>(`/requirements/${encodeURIComponent(requirementId)}/prds/generate`, {
        method: 'POST',
        body: JSON.stringify({ templateId: options.template }),
      });
      await mkdir(dirname(options.out), { recursive: true });
      await writeFile(options.out, `${prd.content}\n`);
      const metaPath = options.out.endsWith('.md')
        ? `${options.out.slice(0, -3)}.meta.json`
        : `${options.out}.meta.json`;
      await writeFile(
        metaPath,
        `${JSON.stringify(
          {
            id: prd.id,
            requirementId: prd.requirementId,
            generatedAt: prd.createdAt,
            version: prd.version,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`Saved PRD to ${options.out}`);
      console.log(prd.content.slice(0, 500));
    },
  );
cli
  .command('parse-commit <message>')
  .description('Parse a conventional commit and linked IDs')
  .action((message: string) => {
    const match = message.match(/^(\w+)(?:\(([^)]+)\))?:\s*(.+)$/);
    console.log(
      JSON.stringify(
        {
          type: match?.[1] ?? 'other',
          scope: match?.[2],
          subject: match?.[3] ?? message,
          requirementIds: [...message.matchAll(/REQ-([A-Za-z0-9_-]+)/g)].map((item) => item[1]),
          prdIds: [...message.matchAll(/PRD-([A-Za-z0-9_-]+)/g)].map((item) => item[1]),
        },
        null,
        2,
      ),
    );
  });
cli.parse();

function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode)
    return Promise.reject(new Error('Password prompt requires a terminal.'));
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') {
          finish();
          reject(new Error('Login cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) {
            value = value.slice(0, -1);
            stdout.write('\b \b');
          }
        } else {
          value += character;
          stdout.write('*');
        }
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
