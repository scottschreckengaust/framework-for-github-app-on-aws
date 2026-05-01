# Redriving Webhook Events

## When to Redrive

- Bug fix deployed and you want to reprocess a previously failed event
- Handler crashed and the event went to DLQ
- Testing a specific webhook payload again

## Two Idempotency Layers

Events are deduped at two levels. Both must be cleared to reprocess:

| Layer | Table | Key | TTL | Purpose |
|-------|-------|-----|-----|---------|
| Receiver | Idempotency Table | `DeliveryId` | 24 hours | Prevents EventBridge dispatch of duplicates |
| Handler | Jobs Table | `delivery:<DeliveryId>` | None (permanent) | Prevents duplicate side effects |

## Steps to Redrive

### 1. Clear the receiver-level idempotency record

```bash
# Find the idempotency table
IDEMP_TABLE=$(AWS_PROFILE=<profile> aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=ai3-mvp,Values=WebhookIngestion \
  --resource-type-filters dynamodb:table \
  --region us-east-1 --query 'ResourceTagMappingList[*].ResourceARN' --output text | tr '\t' '\n' | grep -v UserTokens | grep -v Jobs | grep -v AuthState | sed 's|.*/||')

# Delete the record
AWS_PROFILE=<profile> aws dynamodb delete-item \
  --table-name "$IDEMP_TABLE" \
  --key "{\"DeliveryId\":{\"S\":\"<delivery-id>\"}}" \
  --region us-east-1
```

Or use the CLI:
```bash
app-framework-for-github-apps-on-aws-ops-tools redrive <delivery-id> <table-name>
```

### 2. Clear the handler-level idempotency record

```bash
# Find the Jobs table
JOBS_TABLE=$(AWS_PROFILE=<profile> aws resourcegroupstaggingapi get-resources \
  --tag-filters Key=ai3-mvp,Values=WebhookIngestion \
  --resource-type-filters dynamodb:table \
  --region us-east-1 --query 'ResourceTagMappingList[*].ResourceARN' --output text | tr '\t' '\n' | grep Jobs | sed 's|.*/||')

# Delete the handler-level record
AWS_PROFILE=<profile> aws dynamodb delete-item \
  --table-name "$JOBS_TABLE" \
  --key "{\"JobId\":{\"S\":\"delivery:<delivery-id>\"}}" \
  --region us-east-1
```

### 3. Redeliver from GitHub

Go to: GitHub App settings > Advanced > Recent Deliveries > Find the delivery > Click "Redeliver"

### After the 24-hour receiver TTL

If more than 24 hours have passed, the receiver-level record has auto-expired. You only need to clear the handler-level record (Step 2) and redeliver.

## Verifying a Redrive

Check CloudWatch logs for the handler:
```bash
AWS_PROFILE=<profile> aws logs tail /aws/lambda/<handler-function-name> --since 5m --region us-east-1
```

You should see the event processed without "Duplicate delivery" messages.
