/**
 * Punto de entrada único de la CLI: `env-manager <acción> [opciones]`.
 *
 * Blueprint §1.7: el comando visible lleva el nombre de la aplicación y las
 * acciones son subcomandos, no binarios con guion. Los resultados van a stdout,
 * el diagnóstico a stderr y cada categoría de error tiene un exit code estable
 * (ver `exitCodes.ts`). Contrato idéntico al de `env_manager/cli/main.py`.
 */
import { createRequire } from 'module';
import * as path from 'path';

import { encryptDotenvFile } from './encrypt.js';
import { decryptDotenvFile } from './decrypt.js';
import * as exitCodes from './exitCodes.js';
import { SecretDestroyError, SecretsError, listKeys, readValueFromStdin, setKey } from './secrets.js';

const PROG = 'env-manager';

/**
 * La versión sale del package.json, no de una constante copiada a mano.
 * §1.5.7: un dato duplicado es un dato que va a mentir.
 */
function readVersion(): string {
  const require = createRequire(import.meta.url);
  // Desde src/cli/ y desde dist/ el package.json queda un nivel más arriba.
  for (const candidate of ['../../package.json', '../package.json']) {
    try {
      const pkg = require(candidate) as { name?: string; version?: string };
      if (pkg.name === '@notoriosti/env-manager' && pkg.version != null) return pkg.version;
    } catch {
      // Se prueba el siguiente candidato.
    }
  }
  return 'unknown';
}

interface ParsedArgs {
  file?: string;
  env?: string;
  key?: string;
  output?: string;
  project?: string;
  force: boolean;
  allowEmpty: boolean;
  format: 'text' | 'json';
  help: boolean;
  /** Posicionales sobrantes, en orden. Los usa `secrets`. */
  positionals: string[];
}

function usage(): string {
  return `Usage: ${PROG} <acción> [opciones]

Environment-aware configuration loader for Notorios apps.

Acciones:
  encrypt <file>            Encrypt a .env file using dotenvx-compatible ECIES encryption
  decrypt <file>            Decrypt an encrypted .env file back to plaintext
  secrets list <secret>     List the key names in the consolidated secret (never values)
  secrets set <secret>      Set one key and destroy previous billable versions (enabled/disabled)

Opciones de encrypt:
  --env <name>         Environment name (writes DOTENV_PRIVATE_KEY_<NAME> in .env.keys)
  --force              Overwrite an existing .env.keys file
  -o, --output <file>  Write encrypted output here instead of modifying the input in place
  --format <text|json> Output format for stdout (default: text)

Opciones de decrypt:
  --env <name>         Environment name (reads DOTENV_PRIVATE_KEY_<NAME> from .env.keys)
  --key <hex>          Private key hex (skips the .env.keys lookup)
  -o, --output <file>  Write decrypted output here instead of modifying the input in place
  --format <text|json> Output format for stdout (default: text)

Opciones de secrets:
  --project <id>       GCP project id (obligatorio)
  --key <name>         Key name inside the JSON payload (obligatorio en set)
  --allow-empty        Allow an empty value for 'secrets set'
  --format <text|json> Output format for stdout (default: text)

  El valor de 'secrets set' se lee de stdin, nunca de argv.

Opciones globales:
  --version          Print the version and exit
  --help             Show this help message`;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    force: false,
    allowEmpty: false,
    format: 'text',
    help: false,
    positionals: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--allow-empty') {
      parsed.allowEmpty = true;
    } else if (arg === '--env' && i + 1 < args.length) {
      parsed.env = args[++i];
    } else if (arg === '--key' && i + 1 < args.length) {
      parsed.key = args[++i];
    } else if (arg === '--project' && i + 1 < args.length) {
      parsed.project = args[++i];
    } else if ((arg === '-o' || arg === '--output') && i + 1 < args.length) {
      parsed.output = args[++i];
    } else if (arg === '--format' && i + 1 < args.length) {
      const value = args[++i];
      if (value !== 'text' && value !== 'json') {
        throw new Error(`--format must be 'text' or 'json', got '${value}'`);
      }
      parsed.format = value;
    } else if (!arg.startsWith('-')) {
      parsed.positionals.push(arg);
      parsed.file ??= arg;
    } else {
      throw new Error(`Unrecognised option '${arg}'`);
    }
  }

  return parsed;
}

function emit(payload: Record<string, unknown>, lines: readonly string[], asJson: boolean): void {
  if (asJson) {
    // stdout solo lleva el resultado. §1.7.
    process.stdout.write(`${JSON.stringify(payload, Object.keys(payload).sort(), 2)}\n`);
    return;
  }
  for (const line of lines) process.stdout.write(`${line}\n`);
}

function fail(message: string, code: number): never {
  process.stderr.write(`Error: ${message}\n`);
  process.exit(code);
}

async function runEncrypt(args: ParsedArgs): Promise<void> {
  if (args.file === undefined) {
    process.stderr.write(`Error: No file path provided\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }

  let result;
  try {
    result = await encryptDotenvFile({
      filePath: args.file,
      env: args.env,
      force: args.force,
      outputPath: args.output,
    });
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error), exitCodes.OPERATION);
  }

  const out = args.output ?? args.file;
  const keysPath = path.join(path.dirname(out), '.env.keys');
  emit(
    {
      action: 'encrypt',
      input: args.file,
      output: out,
      keys: keysPath,
      encrypted: result.encryptedCount,
      skipped: result.skippedCount,
      publicKey: result.publicKeyHex,
    },
    [
      `Encrypted ${result.encryptedCount} value(s), skipped ${result.skippedCount} already-encrypted value(s)`,
      `Public key:  ${result.publicKeyHex}`,
      `Private key written to ${keysPath}`,
    ],
    args.format === 'json',
  );
}

async function runDecrypt(args: ParsedArgs): Promise<void> {
  if (args.file === undefined) {
    process.stderr.write(`Error: No file path provided\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }

  let result;
  try {
    result = await decryptDotenvFile(
      { filePath: args.file, privateKeyHex: args.key, outputPath: args.output },
      args.env,
    );
  } catch (error: unknown) {
    fail(error instanceof Error ? error.message : String(error), exitCodes.OPERATION);
  }

  const out = args.output ?? args.file;
  emit(
    {
      action: 'decrypt',
      input: args.file,
      output: out,
      decrypted: result.decryptedCount,
      skipped: result.skippedCount,
    },
    [
      `Decrypted ${result.decryptedCount} value(s), skipped ${result.skippedCount} plaintext value(s)`,
    ],
    args.format === 'json',
  );
}

async function runSecrets(args: ParsedArgs): Promise<void> {
  const [subAction, secretName] = args.positionals;

  if (subAction !== 'list' && subAction !== 'set') {
    process.stderr.write(
      `Error: 'secrets' needs a sub-action: list or set\n${usage()}\n`,
    );
    process.exit(exitCodes.USAGE);
  }
  if (secretName === undefined) {
    process.stderr.write(`Error: No secret name provided\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }
  if (args.project === undefined) {
    process.stderr.write(`Error: --project is required\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }
  if (subAction === 'set' && args.key === undefined) {
    process.stderr.write(`Error: --key is required for 'secrets set'\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }

  try {
    if (subAction === 'list') {
      const keys = await listKeys(args.project, secretName);
      emit(
        { action: 'secrets.list', secret: secretName, keys },
        [`${keys.length} key(s) in '${secretName}':`, ...keys.map((k) => `  ${k}`)],
        args.format === 'json',
      );
      return;
    }

    const value = await readValueFromStdin(process.stdin, { allowEmpty: args.allowEmpty });
    const result = await setKey(args.project, secretName, args.key as string, value);

    const lines = result.unchanged
      ? [
          `'${args.key}' already had that value in '${secretName}'. No new version created.`,
        ]
      : [
          `Set '${args.key}' in '${secretName}'.`,
          `Created ${result.createdVersion}`,
          `Destroyed ${result.destroyedVersions.length} previous version(s)`,
        ];
    emit({ action: 'secrets.set', ...result }, lines, args.format === 'json');
  } catch (error: unknown) {
    if (error instanceof SecretDestroyError) fail(error.message, exitCodes.REMOTE);
    if (error instanceof SecretsError) fail(error.message, exitCodes.OPERATION);
    fail(
      `Secret Manager call failed: ${error instanceof Error ? error.message : String(error)}`,
      exitCodes.REMOTE,
    );
  }
}

export async function dispatch(argv: readonly string[]): Promise<void> {
  if (argv.includes('--version')) {
    process.stdout.write(`${readVersion()}\n`);
    process.exit(exitCodes.OK);
  }

  const [action, ...rest] = argv;

  if (action === undefined || action === '--help' || action === '-h') {
    // Sin acción es error de uso; --help explícito es éxito.
    const stream = action === undefined ? process.stderr : process.stdout;
    stream.write(`${usage()}\n`);
    process.exit(action === undefined ? exitCodes.USAGE : exitCodes.OK);
  }

  if (action !== 'encrypt' && action !== 'decrypt' && action !== 'secrets') {
    process.stderr.write(`Error: Unknown action '${action}'\n${usage()}\n`);
    process.exit(exitCodes.USAGE);
  }

  let args: ParsedArgs;
  try {
    args = parseArgs(rest);
  } catch (error: unknown) {
    process.stderr.write(
      `Error: ${error instanceof Error ? error.message : String(error)}\n${usage()}\n`,
    );
    process.exit(exitCodes.USAGE);
  }

  if (
    args.allowEmpty &&
    (action !== 'secrets' || args.positionals[0] !== 'set')
  ) {
    process.stderr.write(
      `Error: --allow-empty is only valid for 'secrets set'\n${usage()}\n`,
    );
    process.exit(exitCodes.USAGE);
  }

  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(exitCodes.OK);
  }

  if (action === 'encrypt') await runEncrypt(args);
  else if (action === 'decrypt') await runDecrypt(args);
  else await runSecrets(args);

  process.exit(exitCodes.OK);
}

const isMain =
  process.argv[1] != null &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('/env-manager') ||
    process.argv[1].endsWith('\\env-manager') ||
    process.argv[1].endsWith('/main.js'));

if (isMain) {
  dispatch(process.argv.slice(2));
}
