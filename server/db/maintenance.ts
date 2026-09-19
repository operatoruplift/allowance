import fs from 'node:fs';
import {
  backupDatabase,
  validateBackup,
  restoreDatabase,
  approveRestoredJournal,
} from './backup.js';

const [command, first, second, confirmation, ...extra] = process.argv.slice(2);
try {
  if (extra.length) throw new Error('Unexpected arguments.');
  let result: unknown;
  if (command === 'backup' && first && second && !confirmation)
    result = await backupDatabase(first, second);
  else if (command === 'validate' && first && !second) result = await validateBackup(first);
  else if (command === 'restore' && first && second && confirmation === '--lock-signing')
    result = await restoreDatabase(first, second);
  else if (
    command === 'approve-recovery' &&
    first &&
    second &&
    confirmation === '--confirm-reconciled-restore'
  ) {
    if (fs.statSync(second).size > 8192)
      throw new Error('Recovery approval exceeds its size limit.');
    result = approveRestoredJournal(first, JSON.parse(fs.readFileSync(second, 'utf8')));
  } else
    throw new Error(
      'Usage: maintenance backup <database> <new-backup-directory> | validate <backup-directory> | restore <backup-directory> <new-database> --lock-signing | approve-recovery <database> <approval.json> --confirm-reconciled-restore'
    );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(
    `${error instanceof Error && error.name !== 'ZodError' ? error.message : 'Maintenance input failed validation.'}\n`
  );
  process.exitCode = 1;
}
