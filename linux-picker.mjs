import { execFile } from 'node:child_process';

export async function chooseLinuxPath(title, pickFile = false, run = execFile) {
  const candidates = [
    ['zenity', ['--file-selection', '--title=' + title, ...(pickFile ? ['--file-filter=SKILL.md | SKILL.md'] : ['--directory'])]],
    ['kdialog', ['--title', title, ...(pickFile ? ['--getopenfilename', '.', 'SKILL.md'] : ['--getexistingdirectory', '.'])]],
  ];
  for (const [command, args] of candidates) {
    const result = await new Promise(resolve => {
      run(command, args, { encoding: 'utf8' }, (error, stdout) => resolve({ error, stdout }));
    });
    if (!result.error) return result.stdout.replace(/[\r\n]+$/, '');
    // Both dialogs use exit code 1 when the user cancels.
    if (result.error.code === 1) return '';
    if (result.error.code !== 'ENOENT') {
      throw new Error('Could not open the folder picker. Use a Linux desktop session or paste the path into the dialog.');
    }
  }
  throw new Error('Linux browsing requires Zenity or KDialog. Install one using your package manager, or paste the path into the dialog.');
}
