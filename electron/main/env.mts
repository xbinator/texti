import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface EnvConfig {
  DEV_SERVER_HOST: string;
  DEV_SERVER_PORT: string;
}

function loadEnv(): EnvConfig {
  const defaultConfig: EnvConfig = {
    DEV_SERVER_HOST: 'localhost',
    DEV_SERVER_PORT: '1420'
  };

  const envPath = path.join(__dirname, '../../.env');

  if (!fs.existsSync(envPath)) {
    return defaultConfig;
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const lines = envContent.split('\n');

  const config: Partial<EnvConfig> = {};

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmedLine.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedLine.slice(0, separatorIndex).trim();
    const value = trimmedLine.slice(separatorIndex + 1).trim();

    if (key === 'DEV_SERVER_HOST' || key === 'DEV_SERVER_PORT') {
      config[key] = value;
    }
  }

  return { ...defaultConfig, ...config };
}

export const env = loadEnv();
