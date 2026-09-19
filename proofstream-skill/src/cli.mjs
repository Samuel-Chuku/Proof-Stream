import { install } from './commands/install.mjs';
import { init } from './commands/init.mjs';
import { doctor } from './commands/doctor.mjs';
import { docs } from './commands/docs.mjs';
import { version } from './commands/version.mjs';
import { creativeCheck } from './commands/creative-check.mjs';
import { emit, usage } from './lib/output.mjs';

function parse(argv) {
  const [command = 'help', ...rest] = argv;
  const options = { _: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const value = rest[i];
    if (value === '--json') options.json = true;
    else if (value === '--path') {
      const next = rest[i + 1];
      if (next && !next.startsWith('-')) { options.root = next; i += 1; }
      else options.path = true;
    }
    else if (value === '--network') options.network = true;
    else if (value === '--force') options.force = true;
    else if (value === '--target') options.target = rest[++i];
    else if (value === '--agent') options.agent = rest[++i];
    else if (value === '--path-root' || value === '--root') options.root = rest[++i];
    else if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--version' || value === '-v') options.version = true;
    else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`);
    else options._.push(value);
  }
  return { command, options };
}

export async function main(argv) {
  const { command, options } = parse(argv);
  if (options.version || command === 'version') return emit(await version(options.json), options.json);
  if (options.help || command === 'help') return emit(usage());
  let result;
  if (command === 'install') result = await install(options);
  else if (command === 'init') result = await init(options);
  else if (command === 'doctor') result = await doctor({ root: options.root, network: options.network });
  else if (command === 'docs') result = await docs(options._[0], options);
  else if (command === 'creative-check') result = await creativeCheck(options._[0], options);
  else throw new Error(`Unknown command: ${command}. Run proofstream-skill help.`);
  if (command === 'doctor' && !result.ok) {
    emit(result, options.json);
    process.exitCode = options.network ? 5 : 1;
    return;
  }
  emit(result, options.json);
}
