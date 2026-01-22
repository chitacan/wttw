const cmd = require('commander');
const {command} = require('execa');
const {debug, error, note} = require('signale');
const {resolve, basename} = require('path');
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
  showPopup
} = require('./utils');

const DEFAULT_PANE_COUNT = 1;

cmd.version(version)
  .description(description)
  .option('-D, --dry-run', 'dry run')
  .option('-t, --tmux', 'run with tmux');

cmd.command('new <branch>')
  .alias('n')
  .description('create new (git) worktree & (tmux) window')
  .option('-r, --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-d, --detach', 'create detached worktree')
  .option('-W, --no-workspace', 'skip copying code-workspace file')
  .action(async (branch, {pane, session, baseRef, detach, workspace, parent: {dryRun, tmux}}) => {
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
        debug('code-workspace dir: %s', workspacesDir)
      } else {
        if (tmux) {
          await switchSession(session, window, wtd);
          await createWorktree(wtd, branch, baseRef, detach)
          await createTmuxWindow(session, window, wtd)
          await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
          copyDefaultFiles(defaultFiles, wtd)
          if (workspace) copyWorkspaceFile(workspacesDir, mainWorktree, wtd)
          runHook(defaultFiles, window, wtd)
          await showPopup(wtd)
        } else {
          await createWorktree(wtd, branch, baseRef, detach)
          copyDefaultFiles(defaultFiles, wtd)
          if (workspace) copyWorkspaceFile(workspacesDir, mainWorktree, wtd)
          runHook(defaultFiles, window, wtd)
          note(`worktree ${branch} (on ${baseRef}) created`);
        }
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('clean [branch]')
  .alias('c')
  .description('cleanup worktree & window')
  .option('-b, --keep-branch', 'keep branch')
  .option('-w, --keep-worktree', 'keep worktree')
  .action(async (branch, {main, keepWorktree, keepBranch, parent: {dryRun, tmux}}) => {
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
      const wid = await getTmuxWindowId(window).catch(() => null);

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

cmd.command('open <path>')
  .alias('o')
  .description('open "path" on new tmux window')
  .option('-a, --auto-resolve', '')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .action(async (path, {autoResolve, pane, session, parent: {dryRun, tmux}}) => {
    try {
      checks({requireGitRepo: false});

      const cwd = await rootDir();
      const wtd = resolve(cwd, path);
      const window = basename(wtd);

      if (tmux && !tmuxRunning()) {
        await createSession(session, window, wtd);
        note('"tmux a" to attach created session');
      }

      if (tmux && typeof session === 'undefined') {
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
      } else {
        if (tmux) {
          await switchSession(session, window, wtd);
          await createTmuxWindow(session, window, wtd)
          await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
          note('"tmux a" to attach created window');
        } else {
          error('open command requires -t/--tmux option');
        }
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.parse(process.argv);
