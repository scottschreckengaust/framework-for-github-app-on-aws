#!/usr/bin/env node

import { Command } from 'commander';
import { version } from '../package.json';
import { displayDynamoDBTables } from './getTableName';
import { importPrivateKey } from './importPrivateKey';

const program = new Command();
/**
 * CLI tool for Importing GitHub App private key into AWS KMS
 * Main command - 'app-framework-for-github-apps-on-aws-ops-tools'
 */
program
  .name('app-framework-for-github-apps-on-aws-ops-tools')
  .description(
    'CLI tool to get name of the App table with FrameworkForGitHubAppOnAwsManaged tag and to import GitHub App private key into AWS KMS',
  )
  .version(version)
  .showHelpAfterError()
  .action(() => {
    program.help();
  });
// subcommand - get-table-name
program
  .command('get-table-name')
  .description('Displays App tables with FrameworkForGitHubAppOnAwsManaged tag')
  .action(async () => {
    try {
      await displayDynamoDBTables({});
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });
// subcommand - import-private-key
program
  .command('import-private-key')
  .description('Import GitHub App private key into AWS KMS')
  .argument('<pemFilePath>', 'Path to the private key PEM file')
  .argument('<appId>', 'GitHub App ID')
  .argument('<tableName>', 'Table name to store the AppId and Key ARN')
  .addHelpText(
    'after',
    `
    Example:
      $ app-framework-for-github-apps-on-aws-ops-tools import-private-key private-key.pem 123456 my-table-name
  `,
  )
  .action(
    async (pemFilePath: string, appIdAsString: string, tableName: string) => {
      try {
        const appId = Number(appIdAsString);
        if (isNaN(appId)) {
          console.error('Error: GitHub AppId must be a valid number');
          process.exit(1);
        }

        await importPrivateKey({ pemFilePath, appId, tableName });
      } catch (error) {
        console.error('Error:', error);
        process.exit(1);
      }
    },
  );
// subcommand - redrive
program
  .command('redrive')
  .description('Clear idempotency record to allow webhook event reprocessing')
  .argument(
    '<delivery-id>',
    'GitHub webhook delivery ID (X-GitHub-Delivery header)',
  )
  .argument('<table-name>', 'DynamoDB idempotency table name')
  .action(async (deliveryId: string, tableName: string) => {
    try {
      const { redrive } = await import('./redrive');
      await redrive(deliveryId, tableName);
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });
// subcommand - device-flow-auth
program
  .command('device-flow-auth')
  .description(
    'Authorize a GitHub user via OAuth Device Flow and store token in DynamoDB',
  )
  .requiredOption('--client-id <clientId>', 'GitHub App Client ID')
  .requiredOption(
    '--user-tokens-table <tableName>',
    'DynamoDB UserTokens table name',
  )
  .option('--kms-key-arn <keyArn>', 'KMS key ARN for token encryption')
  .action(async (options) => {
    try {
      const { deviceFlowAuth } = await import('./deviceFlowAuth');
      await deviceFlowAuth(
        options.clientId,
        options.userTokensTable,
        options.kmsKeyArn,
      );
    } catch (error) {
      console.error('Device flow auth failed:', error);
      process.exit(1);
    }
  });
// subcommand - update-webhook-config
program
  .command('update-webhook-config')
  .description('Update GitHub App webhook URL/secret and app URLs via JWT authentication')
  .requiredOption('--app-id <appId>', 'GitHub App ID')
  .requiredOption('--webhook-url <url>', 'New webhook URL')
  .requiredOption('--webhook-secret-arn <arn>', 'Secrets Manager ARN for the webhook secret')
  .option('--callback-url <url>', 'OAuth callback URL')
  .option('--homepage-url <url>', 'App homepage URL')
  .option('--setup-url <url>', 'App setup URL')
  .option('--table-name <tableName>', 'DynamoDB Apps table name (for KMS key lookup)')
  .option('--kms-key-arn <keyArn>', 'KMS key ARN (skips table lookup if provided)')
  .addHelpText(
    'after',
    `
    Example:
      $ app-framework-for-github-apps-on-aws-ops-tools update-webhook-config \\
          --app-id 123456 \\
          --webhook-url https://example.com/webhook \\
          --webhook-secret-arn arn:aws:secretsmanager:us-east-1:123456789:secret:my-secret \\
          --table-name my-apps-table \\
          --callback-url https://example.com/callback
  `,
  )
  .action(async (options) => {
    try {
      const appId = Number(options.appId);
      if (isNaN(appId)) {
        console.error('Error: --app-id must be a valid number');
        process.exit(1);
      }
      const { updateWebhookConfig } = await import('./updateWebhookConfig');
      await updateWebhookConfig({
        appId,
        webhookUrl: options.webhookUrl,
        webhookSecretArn: options.webhookSecretArn,
        callbackUrl: options.callbackUrl,
        homepageUrl: options.homepageUrl,
        setupUrl: options.setupUrl,
        tableName: options.tableName,
        kmsKeyArn: options.kmsKeyArn,
      });
    } catch (error) {
      console.error('Error:', error);
      process.exit(1);
    }
  });
program.parse(process.argv);
