export interface CommandContext {
  args: string;
  token: string;
  owner: string;
  repo: string;
  issueNumber: number;
  sender: string;
  userId: number;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;
