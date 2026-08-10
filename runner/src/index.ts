import { buildServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildServer({ config });

const close = async (signal: string) => {
  app.log.info({ signal }, 'Encerrando Navebox Runner');
  await app.close();
  process.exit(0);
};
process.once('SIGTERM', () => void close('SIGTERM'));
process.once('SIGINT', () => void close('SIGINT'));

await app.listen({ host: config.host, port: config.port });
