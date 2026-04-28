import { CommandHandler } from './types';
import { handleHelp } from './help';
import { handleEcho } from './echo';

export { CommandContext, CommandHandler } from './types';

const commands: Record<string, CommandHandler> = {
  help: handleHelp,
  echo: handleEcho,
};

export function getCommandHandler(commandName: string): CommandHandler | undefined {
  return commands[commandName.toLowerCase()];
}

export function getDefaultHandler(): CommandHandler {
  return handleHelp;
}
