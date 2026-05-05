import { Octokit } from '@octokit/rest';

export type ActionType =
  | 'block'
  | 'issue'
  | 'comment'
  | 'notify'
  | 'annotate'
  | 'ignore';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type SeverityActions = Partial<Record<Severity, ActionType[]>>;

export interface SecurityHandlerConfig {
  code_scanning?: SeverityActions;
  secret_scanning?: SeverityActions;
  dependabot?: SeverityActions;
  security_advisory?: SeverityActions;
}

const APP_DEFAULTS: Required<SecurityHandlerConfig> = {
  code_scanning: {
    critical: ['block', 'issue', 'notify'],
    high: ['comment', 'issue'],
    medium: ['annotate'],
    low: ['ignore'],
  },
  secret_scanning: {
    critical: ['block', 'issue', 'notify'],
    high: ['block', 'issue', 'notify'],
    medium: ['comment', 'issue'],
    low: ['comment'],
  },
  dependabot: {
    critical: ['block', 'issue', 'notify'],
    high: ['comment', 'issue'],
    medium: ['annotate'],
    low: ['ignore'],
  },
  security_advisory: {
    critical: ['notify'],
    high: ['ignore'],
    medium: ['ignore'],
    low: ['ignore'],
  },
};

interface CacheEntry {
  config: SecurityHandlerConfig | null;
  expiresAt: number;
}

const CONFIG_FILE_PATH = '.github/ai3-mvp.json';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function parseActionExpression(expr: string): ActionType[] {
  return expr
    .split('+')
    .filter((a): a is ActionType =>
      ['block', 'issue', 'comment', 'notify', 'annotate', 'ignore'].includes(a),
    );
}

function parseRepoConfig(raw: unknown): SecurityHandlerConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const security = obj.security;
  if (!security || typeof security !== 'object') return null;

  const result: SecurityHandlerConfig = {};
  const sec = security as Record<string, unknown>;

  for (const handler of [
    'code_scanning',
    'secret_scanning',
    'dependabot',
    'security_advisory',
  ] as const) {
    const handlerConfig = sec[handler];
    if (!handlerConfig || typeof handlerConfig !== 'object') continue;
    const severityMap = handlerConfig as Record<string, unknown>;
    const parsed: SeverityActions = {};
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      if (typeof severityMap[sev] === 'string') {
        parsed[sev] = parseActionExpression(severityMap[sev] as string);
      }
    }
    result[handler] = parsed;
  }
  return result;
}

async function fetchRepoConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<SecurityHandlerConfig | null> {
  const cacheKey = `${owner}/${repo}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.config;
  }

  let config: SecurityHandlerConfig | null = null;
  try {
    const response = await octokit.repos.getContent({
      owner,
      repo,
      path: CONFIG_FILE_PATH,
    });
    if ('content' in response.data && response.data.content) {
      const decoded = Buffer.from(response.data.content, 'base64').toString();
      const parsed = JSON.parse(decoded);
      config = parseRepoConfig(parsed);
    }
  } catch (err: any) {
    if (err.status !== 404) {
      console.error('Failed to fetch repo config', {
        owner,
        repo,
        error: err.message,
      });
    }
  }

  cache.set(cacheKey, { config, expiresAt: Date.now() + CACHE_TTL_MS });
  return config;
}

function mergeConfigs(
  handlerType: keyof SecurityHandlerConfig,
  ...layers: (SecurityHandlerConfig | null)[]
): SeverityActions {
  const merged: SeverityActions = { ...APP_DEFAULTS[handlerType] };

  for (const layer of layers) {
    if (!layer?.[handlerType]) continue;
    const overrides = layer[handlerType]!;
    for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
      if (overrides[sev]) {
        merged[sev] = overrides[sev];
      }
    }
  }
  return merged;
}

export interface ResolvedConfig {
  actions: SeverityActions;
}

export async function resolveConfig(
  octokit: Octokit,
  owner: string,
  repo: string,
  handlerType: keyof SecurityHandlerConfig,
): Promise<ResolvedConfig> {
  const repoConfig = await fetchRepoConfig(octokit, owner, repo);
  // org config (DynamoDB) is a future extension — slot in here
  const orgConfig: SecurityHandlerConfig | null = null;
  const actions = mergeConfigs(handlerType, orgConfig, repoConfig);
  return { actions };
}

export function getActionsForSeverity(
  config: ResolvedConfig,
  severity: Severity,
): ActionType[] {
  return config.actions[severity] ?? ['ignore'];
}

export function clearConfigCache(): void {
  cache.clear();
}
