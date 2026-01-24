const cmd = require('commander');
const {command} = require('execa');
const {debug, error, note} = require('signale');
const {resolve, basename, join} = require('path');
const {version, description} = require('../package');
const {
  checks,
  tmuxRunning,
  createWorktree,
  createTmuxWindow,
  splitTmuxWindow,
  branchExists,
  getTmuxWindowId,
  getWorktreeDirFromBranch,
  copyDefaultFiles,
  copyWorkspaceFile,
  rootDir,
  runHook,
  resolveMainWorktree,
  resolveDefaultFiles,
  createSession,
  switchSession,
  buildCodeURL,
  listWorktrees,
  requestOpenCode
} = require('./utils');

const DEFAULT_PANE_COUNT = 1;

cmd.version(version)
  .description(description)
  .option('-D, --dry-run', 'dry run')

cmd.command('new <branch>')
  .alias('n')
  .description('create new (git) worktree & (tmux) window')
  .option('-t, --tmux', 'open tmux window')
  .option('-c, --code', 'open vscode')
  .option('-r, --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-d, --detach', 'create detached worktree')
  .option('-W, --no-workspace', 'skip copying code-workspace file')
  .action(async (branch, {pane, session, baseRef, detach, workspace, tmux, code, parent: {dryRun}}) => {
    try {
      await checks({requireTmux: tmux});

      const cwd = await rootDir();
      const projectName = basename(cwd);
      const worktreeDir = getWorktreeDirFromBranch(branch);
      const window = `${projectName}@${worktreeDir}`;
      const wtd = resolve(cwd, '..', worktreeDir);
      const remote = `origin/${branch}`;
      const remoteExists = await branchExists(remote);
      const localExists = await branchExists(branch);
      const defaultFiles = resolveDefaultFiles(cwd);
      const mainWorktree = await resolveMainWorktree();
      const workspacesDir = resolve(cwd, '..', 'context', 'workspaces');

      if (baseRef === '' && remoteExists) {
        baseRef = remote;
      } else if (baseRef === '' && localExists) {
        baseRef = branch;
      }

      if (tmux && !tmuxRunning()) {
        await createSession(session, window, wtd);
        note('"tmux a" to attach created session');
      }

      if (tmux && typeof session === 'undefined') {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      if (dryRun) {
        debug('branch            : %s', branch);
        debug('window            : %s', window);
        debug('baseRef           : %s', baseRef);
        debug('session           : %s', session);
        debug('pane              : %s', pane);
        debug('detach            : %s', detach);
        debug('workspace         : %s', workspace);
        debug('dryRun            : %s', dryRun);
        debug('tmux              : %s', tmux);
        debug('cwd               : %s', cwd);
        debug('wtd               : %s', wtd);
        debug('default           : %s', defaultFiles);
        debug('code              : %s', code);
        debug('code-workspace dir: %s', workspacesDir)
      } else {
        await createWorktree(wtd, branch, baseRef, detach)
        copyDefaultFiles(defaultFiles, wtd)
        runHook(defaultFiles, window, wtd)
        if (workspace) copyWorkspaceFile(workspacesDir, mainWorktree, wtd)

        note(`worktree ${branch} (on ${baseRef}) created`);

        if (tmux) {
          await switchSession(session, window, wtd);
          await createTmuxWindow(session, window, wtd)
          await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
        }

        if (code) {
          // do nothing for now
        }
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('clean [branch]')
  .alias('c')
  .description('cleanup worktree')
  .option('-t, --tmux', 'clean tmux window')
  .option('-b, --keep-branch', 'keep branch')
  .option('-w, --keep-worktree', 'keep worktree')
  .action(async (branch, {keepWorktree, keepBranch, tmux, parent: {dryRun}}) => {
    try {
      await checks({requireTmux: tmux});

      if (!branch) {
        branch = await command('git rev-parse --abbrev-ref HEAD')
          .then(({stdout}) => stdout);
      }

      const cwd = await rootDir();
      const projectName = basename(cwd);
      const worktreeDir = getWorktreeDirFromBranch(branch);
      const window = `${projectName}@${worktreeDir}`;
      const wtd = resolve(cwd, '..', window);
      const root = await resolveMainWorktree()

      let wid = null;

      if (tmux) {
        wid = await getTmuxWindowId(window).catch(() => null);
      }

      if (dryRun) {
        debug('branch        : %s', branch);
        debug('keepBranch    : %s', keepBranch);
        debug('keepWorktree  : %s', keepWorktree);
        debug('window        : %s', window);
        debug('dryRun        : %s', dryRun);
        debug('cwd           : %s', cwd);
        debug('wtd           : %s', wtd);
        debug('wid           : %s', wid);
        debug('root          : %s', root);
      } else {
        if (!keepWorktree) {
          await command(`rm -rf ${wtd}`);
          await command('git worktree prune', {cwd: root});
        }
        if (!keepBranch) {
          await command(`git branch -D ${branch}`, {cwd: root});
        }

        if (wid !== null) {
          await command(`tmux kill-window -t ${wid}`);
        }
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  });

cmd.command('default-files')
  .alias('df')
  .description('copy default_files to current directory')
  .action(async () => {
    try {
      await checks({requireTmux: false});

      const wtd = process.cwd();
      const defaultFiles = resolveDefaultFiles(wtd);

      copyDefaultFiles(defaultFiles, wtd)
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('tmux <path>')
  .alias('t')
  .description('open "path" in tmux window')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .action(async (path, {pane, session, parent: {dryRun, code}}) => {
    try {
      await checks({requireGitRepo: false});

      const cwd = await rootDir();
      const wtd = resolve(cwd, path);
      const window = basename(wtd);

      if (!tmuxRunning()) {
        await createSession(session, window, wtd);
        note('"tmux a" to attach created session');
      }

      if (typeof session === 'undefined') {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      if (dryRun) {
        debug('path   : %s', path);
        debug('cwd    : %s', cwd);
        debug('wtd    : %s', wtd);
        debug('pane   : %s', pane);
        debug('session: %s', session);
        debug('window : %s', window);
        debug('code   : %s', code);
      } else {
        await switchSession(session, window, wtd);
        await createTmuxWindow(session, window, wtd)
        await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
        note('"tmux a" to attach created window');
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('open <branch>')
  .alias('o')
  .description('open git worktree in designated machine\'s browser window')
  .option('-h, --host [host]', 'machine to open worktree (Default: cmba-15)', 'cmba-15')
  .option('-p, --profile [profile]', 'profile (Default: Spectral)', 'Spectral')
  .action(async (branch, {host, profile, parent: {dryRun}}) => {
    try {
      await checks({requireGitRepo: true});

      const worktrees = await listWorktrees();

      if (worktrees.find(wt => wt.branch === branch) == null) {
        throw new Error(`worktree "${branch}" does not exist`);
      }

      const cwd = await rootDir();
      const wtd = resolve(cwd, '..', branch);
      const window = basename(wtd);
      const url = buildCodeURL(wtd, window, profile);

      if (dryRun) {
        debug('branch  : %s', branch);
        debug('host    : %s', host);
        debug('profile : %s', profile);
        debug('cwd     : %s', cwd);
        debug('wtd     : %s', wtd);
        debug('url     : %s', url.toString());
      } else {
        await requestOpenCode(url, host);
        note('requested');
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.parse(process.argv);
