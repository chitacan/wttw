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
  getWindowNameFromBranch,
  copyDefaultFiles,
  updateDefaultFiles,
  rootDir,
  runHook,
  resolveMainWorktree,
  resolveDefaultFiles,
  createSession,
  switchSession,
  showPopup
} = require('./utils');

const DEFAULT_PANE_COUNT = 4

cmd.version(version)
  .description(description)
  .option('-d --dry-run', 'dry run')
  .option('-t --no-tmux', 'run without tmux')

cmd.command('new <branch>')
  .alias('n')
  .description('create new (git) worktree & (tmux) window')
  .option('-r --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .action(async (branch, {pane, session, baseRef, parent: {dryRun, tmux}}) => {
    try {
      await checks({requireTmux: tmux});

      const window = getWindowNameFromBranch(branch);
      const cwd = await rootDir();
      const wtd = resolve(cwd, '..', window);
      const remote = `origin/${branch}`;
      const remoteExists = await branchExists(remote);
      const localExists = await branchExists(branch);
      const defaultFiles = resolveDefaultFiles(cwd);

      if (baseRef === '' && remoteExists) {
        baseRef = remote;
      } else if (baseRef === '' && localExists) {
        baseRef = branch;
      }

      if (tmux && !tmuxRunning()) {
        await createSession(session, window, wtd);
        note('"tmux a" to attach created session');
      }

      if (typeof session === 'undefined') {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      if (dryRun) {
        debug('branch : %s', branch);
        debug('window : %s', window);
        debug('baseRef: %s', baseRef);
        debug('session: %s', session);
        debug('pane   : %s', pane);
        debug('dryRun : %s', dryRun);
        debug('tmux   : %s', tmux);
        debug('cwd    : %s', cwd);
        debug('wtd    : %s', wtd);
        debug('default: %s', defaultFiles);
      } else {
        if (tmux) {
          await switchSession(session, window, wtd);
          await createWorktree(wtd, branch, baseRef)
          await createTmuxWindow(session, window, wtd)
          await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
          copyDefaultFiles(defaultFiles, wtd)
          runHook(defaultFiles, window, wtd)
          await showPopup(wtd)
        } else {
          await createWorktree(wtd, branch, baseRef)
          copyDefaultFiles(defaultFiles, wtd)
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
  .option('-b --delete-branch', 'delete branch')
  .option('-w --delete-worktree', 'delete worktree')
  .action(async (branch, {main, deleteWorktree, deleteBranch, parent: {dryRun, tmux}}) => {
    try {
      await checks({requireTmux: tmux});

      if (!branch) {
        branch = await command('git rev-parse --abbrev-ref HEAD')
          .then(({stdout}) => stdout);
      }

      const window = getWindowNameFromBranch(branch);
      const cwd = await rootDir();
      const wtd = resolve(cwd, '..', window);
      const root = await resolveMainWorktree()
      const wid = await getTmuxWindowId(window);

      if (dryRun) {
        debug('branch        : %s', branch);
        debug('deleteBranch  : %s', deleteBranch);
        debug('deleteWorktree: %s', deleteWorktree);
        debug('window        : %s', window);
        debug('dryRun        : %s', dryRun);
        debug('cwd           : %s', cwd);
        debug('wtd           : %s', wtd);
        debug('wid           : %s', wid);
        debug('root          : %s', root);
      } else {
        if (deleteWorktree) {
          await command(`rm -rf ${wtd}`);
          await command('git worktree prune', {cwd: root});
        }
        if (deleteBranch) {
          await command(`git branch -D ${branch}`, {cwd: root});
        }
        await command(`tmux kill-window -t ${wid}`);
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  });

cmd.command('default-files')
  .alias('df')
  .description('update & fetch default_files')
  .option('-f --fetch', 'fetch "../.default_files" to current worktree')
  .option('-u --update', 'update current worktree default files to "../.default_files"')
  .action(async ({fetch, update}) => {
    try {
      await checks({requireTmux: false});

      const wtd = process.cwd();
      const defaultFiles = resolveDefaultFiles(wtd);

      if (update) {
        updateDefaultFiles(defaultFiles, wtd)
      } else {
        copyDefaultFiles(defaultFiles, wtd)
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('open <path>')
  .alias('o')
  .description('open "path" on new tmux window')
  .option('-a --auto-resolve', '')
  .option('-p --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-s --session [session]', 'session name for tmux window (Default: current session)')
  .action(async (path, {autoResolve, pane, session, parent: {dryRun}}) => {
    try {
      checks({requireGitRepo: false});

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

cmd.parse(process.argv);
