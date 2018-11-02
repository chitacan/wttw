const cmd = require('commander');
const {shell} = require('execa');
const {debug, error} = require('signale');
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
  getWindowNameFromBranch
} = require('./utils');

cmd.version(version)
  .description(description)
  .option('-d --dry-run', 'dry run')

cmd.command('new <branch>')
  .alias('n')
  .description('create new (git) worktree & (tmux) window')
  .option('-r --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p --pane <count>', 'tmux pane count (Default: 6)', 6)
  .action(async (branch, {pane, session, baseRef, parent: {dryRun}}) => {
    try {
      await checks();

      const window = getWindowNameFromBranch(branch);
      const cwd = process.cwd();
      const wtd = resolve(cwd, '..', window);
      const remote = `origin/${branch}`;
      const remoteExists = await branchExists(remote);

      if (baseRef === '' && remoteExists) {
        baseRef = remote;
      }

      if (!tmuxRunning()) {
        await shell(`tmux new-session -d`);
      }

      if (typeof session === 'undefined') {
        session = await shell('tmux display-message -p "#S"')
          .then(({stdout}) => stdout);
      }

      if (dryRun) {
        debug('branch : %s', branch);
        debug('window : %s', window);
        debug('baseRef: %s', baseRef);
        debug('session: %s', session);
        debug('pane   : %s', pane);
        debug('dryRun : %s', dryRun);
        debug('cwd    : %s', cwd);
        debug('wtd    : %s', wtd);
      } else {
        await createWorktree(wtd, branch, baseRef)
        await createTmuxWindow(session, window, wtd)
        await splitTmuxWindow(wtd, +pane)
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
  .option('-m --main <path>', 'main worktree name (Default: master)', 'master')
  .action(async (branch, {main, deleteWorktree, deleteBranch, parent: {dryRun}}) => {
    try {
      await checks();

      if (!branch) {
        branch = await shell('git rev-parse --abbrev-ref HEAD')
          .then(({stdout}) => stdout);
      }

      const window = getWindowNameFromBranch(branch);
      const cwd = process.cwd();
      const wtd = resolve(cwd, '..', window);
      const root = resolve(cwd, '..', main);
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
          await shell(`rm -rf ${wtd}`);
          await shell('git worktree prune', {cwd: root});
        }
        if (deleteBranch) {
          await shell(`git branch -D ${branch}`, {cwd: root});
        }
        await shell(`tmux kill-window -t ${wid}`);
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  });

cmd.command('* <path>')
  .description('open "path" on new tmux window')
  .option('-a --auto-resolve', '')
  .option('-p --pane <count>', 'tmux pane count (Default: 4)', 6)
  .action(async (path, {autoResolve, pane, parent: {dryRun}}) => {
    try {
      checks({requireGitRepo: false});

      const cwd = process.cwd();
      const wtd = resolve(cwd, path);
      const window = basename(wtd);

      if (!tmuxRunning()) {
        await shell(`tmux new-session -d`);
      }

      const session = await shell('tmux display-message -p "#S"')
        .then(({stdout}) => stdout);

      if (dryRun) {
        debug('path   : %s', path);
        debug('cwd    : %s', cwd);
        debug('wtd    : %s', wtd);
        debug('session: %s', session);
        debug('window : %s', window);
      } else {
        await createTmuxWindow(session, window, wtd)
        await splitTmuxWindow(wtd, +pane)
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.parse(process.argv);
