export interface Config {
  port: number;
  hookEndpointUrl: string;
  corsOrigin: string | string[];
  redisUrl: string;
}

export function loadConfig(): Config {
  const port = Number(process.env.COCKPIT_API_PORT ?? 4500);
  const publicHost = process.env.COCKPIT_API_PUBLIC_HOST ?? `http://127.0.0.1:${port}`;
  return {
    port,
    hookEndpointUrl: `${publicHost}/hooks/claude-code`,
    corsOrigin: process.env.COCKPIT_CORS_ORIGIN?.split(',') ?? [
      'http://localhost:4400',
      'http://127.0.0.1:4400',
    ],
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  };
}
