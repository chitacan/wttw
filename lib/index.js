const cmd = require('commander');
const {shell, shellSync} = require('execa');
const {info, debug, success, error} = require('signale');
const {resolve} = require('path');
const {sync} = require('command-exists');
const {existsSync} = require('fs');
const {version, description} = require('../package');

const checks = (flags = {}) => {
  const {requireGitRepo = true} = flags;

  if (!sync('tmux')) {
    throw new Error('"tmux" is not available on your system');
  }

  if (!sync('git')) {
    throw new Error('"git" is not available on your system');
  }

  if (requireGitRepo && !existsSync(resolve(process.cwd(), '.git'))) {
    throw new Error('should run in git repo');
  }
}

const tmuxRunning = () => {
  try {
    shellSync('tmux info &> /dev/null');
    return true;
  } catch (err) {
    return false;
  }
}

const createWorktree = async (wtd, branch, baseRef) => {
  await shell(`git worktree add ${wtd} -B ${branch} ${baseRef}`);
}

const createTmuxWindow = async (session, window, wtd) => {
  await shell(`tmux new-window -t ${session} -n ${window} -c ${wtd}`);
  await shell(`tmux select-window -t ${window}`).catch();
}

const splitTmuxWindow = async (wtd, pane) => {
  if (pane === 4) {
    await shell(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 2 -c ${wtd} && \
                tmux selectp -t 0`)
  } else {
    await shell(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 3 -c ${wtd} && \
                tmux splitw -h -p 50 -t 3 -c ${wtd} && \
                tmux selectp -t 0`)
  }
}

cmd.version(version)
  .description(description)
  .option('-d --dry-run', 'dry run')

cmd.command('new <branch>')
  .alias('n')
  .description('create new (git) worktree & (tmux) window')
  .option('-r --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s --session [session]', 'session name to create tmux window (Default: current session)')
  .option('-p --pane <count>', 'tmux pane count (Default: 4)', 4)
  .action(async (branch, {pane, session, baseRef, parent: {dryRun}}) => {
    try {
      checks();

      // for 'riiid/www' branch style '<PREFIX>/<SUFFIX>'
      const [window] = branch.split('/');
      const cwd = process.cwd();
      const wtd = resolve(cwd, '..', window);

      if (!tmuxRunning()) {
        await shell(`tmux new-session -d`);
      }
      if (typeof session === 'undefined') {
        session = await shell('tmux display-message -p "#S"').then(({stdout}) => stdout);
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
  .option('-m --main <path>', 'main worktree name (Default: master)', 'master')
  .action(async (branch, {main, deleteBranch, parent: {dryRun}}) => {
    try {
      checks();

      if (!branch) {
        branch = await shell('git rev-parse --abbrev-ref HEAD').then(({stdout}) => stdout);
      }

      const [window] = branch.split('/');
      const cwd = process.cwd();
      const wtd = resolve(cwd, '..', window);
      const root = resolve(cwd, '..', main);

      if (dryRun) {
        debug('branch      : %s', branch);
        debug('deleteBranch: %s', deleteBranch);
        debug('window      : %s', window);
        debug('dryRun      : %s', dryRun);
        debug('cwd         : %s', cwd);
        debug('wtd         : %s', wtd);
        debug('root        : %s', root);
      } else {
        await shell(`rm -rf ${wtd}`);
        await shell('git worktree prune', {cwd: root});
        if (deleteBranch) {
          await shell(`git branch -D ${branch}`, {cwd: root});
        }
        await shell(`tmux kill-window -t ${window}`);
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  });

cmd.command('* <path>')
  .action(async (path, {parent: {dryRun}}) => {
    checks({requireGitRepo: false});

    const cwd = process.cwd();
    const wtd = resolve(cwd, '..', window);

    if (dryRun) {
      debug('path: %s', path);
      debug('cwd : %s', cwd);
      debug('wtd : %s', wtd);
    }
  })

cmd.parse(process.argv);
