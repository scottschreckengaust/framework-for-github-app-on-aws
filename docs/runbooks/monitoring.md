# Monitoring Runbook

## Dashboard

**URL:** https://us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards/dashboard/ai3-mvp-platform

Shows: Events by handler, commands executed, auth results, errors, DLQ depth, API Gateway errors, alarms, health check, Step Functions executions.

## Alarms

| Alarm | What it means |
|-------|---------------|
| `ai3-mvp-webhook-oversized-payload` | API Gateway returned 4XX (possible >10MB payload) |
| `ai3-mvp-dlq-not-empty` | A handler Lambda crashed — event in dead letter queue |

## Looking Up a Job by ID

When the bot replies `CI Check started (Job: <job-id>)`, use that ID to trace the full execution.

### Find the job in DynamoDB

```bash
AWS_PROFILE=burner2 aws dynamodb get-item \
  --table-name <jobs-table> \
  --key "{\"JobId\":{\"S\":\"<job-id>\"}}" \
  --region us-east-1
```

### Find the execution in Step Functions logs

```bash
AWS_PROFILE=burner2 aws logs filter-log-events \
  --log-group-name the-app-framework-test-stack-WebhookIngestionCICheckWorkflowExecutionLogs0AFE04E5-QzYqW03zfOme \
  --start-time $(date -d '8 hours ago' +%s000) \
  --region us-east-1 \
  --filter-pattern "<job-id>" \
  --query 'events[*].message' --output text
```

### Find the Lambda invocations for that job

```bash
AWS_PROFILE=burner2 aws logs filter-log-events \
  --log-group-name /aws/lambda/the-app-framework-test-st-WebhookIngestionCheckRun-CzVaxaCyNic7 \
  --start-time $(date -d '8 hours ago' +%s000) \
  --region us-east-1 \
  --filter-pattern "<job-id>" \
  --query 'events[*].message' --output text
```

## Viewing Step Functions Executions

### Summary — successes and failures only

```bash
AWS_PROFILE=burner2 aws logs filter-log-events \
  --log-group-name the-app-framework-test-stack-WebhookIngestionCICheckWorkflowExecutionLogs0AFE04E5-QzYqW03zfOme \
  --start-time $(date -d '8 hours ago' +%s000) \
  --region us-east-1 \
  --filter-pattern '{ $.type = "ExecutionSucceeded" || $.type = "ExecutionFailed" }' \
  --query 'events[*].message' --output text
```

### All state transitions (readable)

```bash
AWS_PROFILE=burner2 aws logs tail \
  the-app-framework-test-stack-WebhookIngestionCICheckWorkflowExecutionLogs0AFE04E5-QzYqW03zfOme \
  --since 8h --region us-east-1 \
  | python3 -c "
import sys, json
for line in sys.stdin:
    parts = line.strip().split(' ', 2)
    if len(parts) < 3: continue
    try:
        d = json.loads(parts[2])
        t = d.get('type','')
        n = d.get('details',{}).get('name','')
        if t: print(f'{t:30s} {n}')
    except: pass
"
```

### CheckRunStep Lambda logs (create/complete)

```bash
AWS_PROFILE=burner2 aws logs filter-log-events \
  --log-group-name /aws/lambda/the-app-framework-test-st-WebhookIngestionCheckRun-CzVaxaCyNic7 \
  --start-time $(date -d '8 hours ago' +%s000) \
  --region us-east-1 \
  --filter-pattern 'INFO' \
  --query 'events[*].message' --output text
```

## Viewing Webhook Handler Logs

### Comment handler (processes @ai3-mvp commands)

```bash
AWS_PROFILE=burner2 aws logs tail \
  /aws/lambda/the-app-framework-test-st-WebhookIngestionCommentH-3XMAqXoApKDe \
  --since 1h --region us-east-1
```

### Webhook receiver (signature verification, dispatch)

```bash
AWS_PROFILE=burner2 aws logs tail \
  /aws/lambda/the-app-framework-test-st-WebhookIngestionReceiver-EwwytlIJmkXW \
  --since 1h --region us-east-1
```

### Health check (runs every 15 min)

```bash
AWS_PROFILE=burner2 aws logs tail \
  /aws/lambda/the-app-framework-test-st-WebhookIngestionHealthCh-Yoi782ERJhEO \
  --since 1h --region us-east-1
```

## Custom Metrics

Namespace: `GitHubAppPlatform`

| Metric | Dimensions | Meaning |
|--------|-----------|---------|
| `EventProcessed` | AppId, EventType, HandlerName, OrgName | An event was handled |
| `CommandExecuted` | AppId, Command, HandlerName, OrgName | A bot command ran |
| `AuthSuccess` | AppId, HandlerName, OrgName | User authorized successfully |
| `AuthFailed` | AppId, HandlerName, OrgName | Authorization denied |
| `ErrorOccurred` | AppId, HandlerName, OrgName | Handler error (also goes to DLQ) |
| `HealthCheckSuccess` | AppId, CheckType | Health check pass (1) or fail (0) |

Browse in console: CloudWatch → Metrics → All metrics → `GitHubAppPlatform`

## DLQ Investigation

When the DLQ alarm fires:

```bash
# See what's in the DLQ
AWS_PROFILE=burner2 aws logs tail \
  /aws/lambda/the-app-framework-test-st-WebhookIngestionAlertha-<id> \
  --since 1h --region us-east-1
```

The alert handler logs the full failed event body including the delivery ID, which you can use to redrive (see `docs/runbooks/redrive-events.md`).
