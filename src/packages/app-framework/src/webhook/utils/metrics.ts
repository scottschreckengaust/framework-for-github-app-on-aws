import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const metrics = new Metrics({
  namespace: 'GitHubAppPlatform',
  serviceName: 'webhook',
});

export interface EventMetricContext {
  appId?: string | number;
  orgName?: string;
  eventType: string;
  handlerName: string;
}

export function publishEventProcessed(ctx: EventMetricContext): void {
  metrics.addDimension('AppId', String(ctx.appId || 'unknown'));
  metrics.addDimension('OrgName', ctx.orgName || 'unknown');
  metrics.addDimension('EventType', ctx.eventType);
  metrics.addDimension('HandlerName', ctx.handlerName);
  metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
}

export function publishCommandExecuted(ctx: EventMetricContext, command: string): void {
  metrics.addDimension('AppId', String(ctx.appId || 'unknown'));
  metrics.addDimension('OrgName', ctx.orgName || 'unknown');
  metrics.addDimension('HandlerName', ctx.handlerName);
  metrics.addDimension('Command', command);
  metrics.addMetric('CommandExecuted', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
}

export function publishAuthResult(ctx: EventMetricContext, success: boolean): void {
  metrics.addDimension('AppId', String(ctx.appId || 'unknown'));
  metrics.addDimension('OrgName', ctx.orgName || 'unknown');
  metrics.addDimension('HandlerName', ctx.handlerName);
  const metricName = success ? 'AuthSuccess' : 'AuthFailed';
  metrics.addMetric(metricName, MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
}

export function publishError(ctx: EventMetricContext): void {
  metrics.addDimension('AppId', String(ctx.appId || 'unknown'));
  metrics.addDimension('OrgName', ctx.orgName || 'unknown');
  metrics.addDimension('HandlerName', ctx.handlerName);
  metrics.addMetric('ErrorOccurred', MetricUnit.Count, 1);
  metrics.publishStoredMetrics();
}
