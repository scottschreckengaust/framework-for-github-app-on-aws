## Disaster Recovery Test

### Environment
- **AWS Profile:** 
- **Account ID:** 
- **Region:** 

### Runbook Steps Completed
- [ ] 1. Prerequisites verified (Node >= 22, CDK, yarn, AWS CLI)
- [ ] 2. CDK bootstrapped
- [ ] 3. Dependencies installed and built
- [ ] 4. Secrets created (webhook + OAuth client)
- [ ] 5. Stack deployed
- [ ] 6. Private key generated and imported
- [ ] 7. GitHub App webhook URL/secret/callback updated
- [ ] 8. OAuth re-authorized via device flow
- [ ] 9. Verification passed

### Verification Results
- [ ] Health check Lambda passes (GET /app succeeds)
- [ ] `@ai3-mvp help` replies on a PR
- [ ] `@ai3-mvp check <sha>` creates a Check Run
- [ ] Dashboard shows metrics
- [ ] Webhook deliveries show 200 in GitHub App settings

### Findings / Documentation Gaps
<!-- List any issues found during recovery -->
| # | Finding | Fix Applied? |
|---|---------|-------------|
| | | |

### Runbook Accuracy
- [ ] All steps were accurate and complete
- [ ] No undocumented steps were needed
- [ ] Order of operations was correct
