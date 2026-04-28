import { RemovalPolicy } from 'aws-cdk-lib';
import {
  AttributeType,
  Table,
  BillingMode,
  ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class JobsTable extends Construct {
  readonly table: Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, 'Table', {
      partitionKey: { name: 'JobId', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'RepoStatusIndex',
      partitionKey: { name: 'RepoFullName', type: AttributeType.STRING },
      sortKey: { name: 'Status', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: 'UserCreatedIndex',
      partitionKey: { name: 'UserId', type: AttributeType.NUMBER },
      sortKey: { name: 'CreatedAt', type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
