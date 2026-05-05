import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  DefinitionBody,
  LogLevel,
  StateMachine,
  StateMachineType,
  Wait,
  WaitTime,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

export interface CICheckWorkflowProps {
  readonly checkRunStepFunction: IFunction;
}

export class CICheckWorkflow extends Construct {
  readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: CICheckWorkflowProps) {
    super(scope, id);

    const createCheckRun = new LambdaInvoke(this, 'CreateCheckRun', {
      lambdaFunction: props.checkRunStepFunction,
      payload: {
        type: 1,
        value: {
          action: 'create',
          'owner.$': '$.owner',
          'repo.$': '$.repo',
          'headSha.$': '$.headSha',
          'jobId.$': '$.jobId',
          'userId.$': '$.userId',
        },
      },
      resultPath: '$.createResult',
      resultSelector: {
        'checkRunId.$': '$.Payload.checkRunId',
        'jobId.$': '$.Payload.jobId',
      },
    });

    const simulateCI = new Wait(this, 'SimulateCI', {
      time: WaitTime.duration(Duration.seconds(5)),
      comment: 'Simulated CI work (replace with real build/test steps)',
    });

    const completeCheckRun = new LambdaInvoke(this, 'CompleteCheckRun', {
      lambdaFunction: props.checkRunStepFunction,
      payload: {
        type: 1,
        value: {
          action: 'complete',
          'owner.$': '$.owner',
          'repo.$': '$.repo',
          'checkRunId.$': '$.createResult.checkRunId',
          'jobId.$': '$.createResult.jobId',
          'userId.$': '$.userId',
        },
      },
      resultPath: '$.completeResult',
    });

    const definition = createCheckRun.next(simulateCI).next(completeCheckRun);

    const logGroup = new LogGroup(this, 'ExecutionLogs', {
      retention: RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.stateMachine = new StateMachine(this, 'StateMachine', {
      definitionBody: DefinitionBody.fromChainable(definition),
      stateMachineType: StateMachineType.EXPRESS,
      timeout: Duration.minutes(5),
      logs: {
        destination: logGroup,
        level: LogLevel.ALL,
        includeExecutionData: false,
      },
    });
  }
}
