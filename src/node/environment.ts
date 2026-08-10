import type { TemplateFile } from '../core/types';
import { BrowserPodNodeEngine } from './browserpod-engine';
import { CompatNodeEngine } from './compat-engine';
import type { BrowserNodeEngine, BrowserNodeEnvironmentOptions } from './types';

export function createBrowserNodeEngine(options: BrowserNodeEnvironmentOptions = {}): BrowserNodeEngine {
  const provider = options.provider === 'auto' || !options.provider
    ? options.browserPodApiKey ? 'browserpod' : 'compat'
    : options.provider;
  return provider === 'browserpod'
    ? new BrowserPodNodeEngine(options)
    : new CompatNodeEngine(options);
}

export async function bootBrowserNode(
  files: TemplateFile[],
  options: BrowserNodeEnvironmentOptions = {},
): Promise<BrowserNodeEngine> {
  const engine = createBrowserNodeEngine(options);
  await engine.boot(files);
  return engine;
}
