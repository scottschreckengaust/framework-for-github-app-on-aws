import { handleEcho } from './echo';
import { handleHelp } from './help';
import { CommandHandler } from './types';

export { CommandContext, CommandHandler } from './types';

const commands: Record<string, CommandHandler> = {
  help: handleHelp,
  echo: handleEcho,
};

export function getCommandHandler(
  commandName: string,
): CommandHandler | undefined {
  return commands[commandName.toLowerCase()];
}

export function getDefaultHandler(): CommandHandler {
  return handleHelp;
}
