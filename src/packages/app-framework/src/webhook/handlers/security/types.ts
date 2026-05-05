import { Severity } from './config';

export interface SecurityFinding {
  severity: Severity;
  title: string;
  body: string;
  htmlUrl: string;
  repo: { owner: string; name: string };
  ref?: { pr?: number; commit?: string };
  tool?: string;
  alertNumber?: number;
  source: string;
}
