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
  requestOpenCode,
  resolveProjectName
} = require('./utils');

const DEFAULT_PANE_COUNT = 1;

cmd.version(version)
  .description(description)
  .option('-D, --dry-run', 'dry run')

cmd.command('new <branches...>')
  .alias('n')
  .description('create new worktrees & tmux windows')
  .option('-t, --tmux', 'open tmux window')
  .option('-r, --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-d, --detach', 'create detached worktree')
  .option('-W, --no-workspace', 'skip copying code-workspace file')
  .option('-f, --focus', 'focus created tmux window')
  .option('-c, --cmd <command>', 'command to run in each pane after creation')
  .action(async (branches, {pane, session, baseRef: baseRefOpt, detach, workspace, tmux, cmd, focus, parent: {dryRun}}) => {
    try {
      await checks({requireTmux: tmux});

      const cwd = await rootDir();
      const projectName = await resolveProjectName();
      const defaultFiles = resolveDefaultFiles(cwd);
      const mainWorktree = await resolveMainWorktree();
      const workspacesDir = resolve(cwd, '..', 'context', 'workspaces');

      // session setup (once, based on first branch)
      const firstWorktreeDir = getWorktreeDirFromBranch(branches[0]);
      const firstWindow = `${projectName}#${firstWorktreeDir}`;
      const firstWtd = resolve(cwd, '..', firstWorktreeDir);

      if (tmux && !tmuxRunning()) {
        await createSession(session, firstWindow, firstWtd);
        note('"tmux a" to attach created session');
      }

      if (tmux && typeof session === 'undefined') {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      for (const branch of branches) {
        const worktreeDir = getWorktreeDirFromBranch(branch);
        const window = `${projectName}#${worktreeDir}`;
        const wtd = resolve(cwd, '..', worktreeDir);
        const remote = `origin/${branch}`;
        const remoteExists = await branchExists(remote);
        const localExists = await branchExists(branch);

        let baseRef = baseRefOpt;
        if (baseRef === '' && remoteExists) {
          baseRef = remote;
        } else if (baseRef === '' && localExists) {
          baseRef = branch;
        }

        if (dryRun) {
          debug('=== %s ===', branch);
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
          debug('cmd               : %s', cmd);
          debug('focus             : %s', focus);
          debug('code-workspace dir: %s', workspacesDir)
        } else {
          await createWorktree(wtd, branch, baseRef, detach)
          copyDefaultFiles(defaultFiles, wtd)
          runHook(defaultFiles, window, wtd)
          if (workspace) copyWorkspaceFile(workspacesDir, mainWorktree, wtd)

          note(`worktree ${branch} (on ${baseRef}) created`);

          if (tmux) {
            await switchSession(session, window, wtd);
            await createTmuxWindow(session, window, wtd, focus, cmd)
            await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
          }
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
      const projectName = await resolveProjectName();
      const worktreeDir = getWorktreeDirFromBranch(branch);
      const window = `${projectName}#${worktreeDir}`;
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

cmd.command('tmux <branches...>')
  .alias('t')
  .description('open worktrees in tmux windows')
  .option('-p, --pane <count>', 'tmux pane count', DEFAULT_PANE_COUNT)
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-f, --focus', 'focus created tmux window')
  .option('-c, --cmd <command>', 'command to run in each pane after creation')
  .action(async (branches, {pane, session, focus, cmd, parent: {dryRun}}) => {
    try {
      await checks({requireGitRepo: true});

      const cwd = await rootDir();
      const worktrees = await listWorktrees();
      const projectName = await resolveProjectName();

      // validate all branches exist as worktrees
      for (const branch of branches) {
        if (worktrees.find(wt => wt.branch === branch) == null) {
          throw new Error(`worktree "${branch}" does not exist`);
        }
      }

      // session setup (once, based on first branch)
      const firstWtd = resolve(cwd, '..', branches[0]);
      const firstWindow = `${projectName}#${basename(firstWtd)}`;

      if (!tmuxRunning()) {
        await createSession(session, firstWindow, firstWtd);
        note('"tmux a" to attach created session');
      }

      if (typeof session === 'undefined') {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      for (const branch of branches) {
        const wtd = resolve(cwd, '..', branch);
        const window = `${projectName}#${branch}`;

        if (dryRun) {
          debug('=== %s ===', branch);
          debug('cwd    : %s', cwd);
          debug('wtd    : %s', wtd);
          debug('pane   : %s', pane);
          debug('session: %s', session);
          debug('window : %s', window);
          debug('focus  : %s', focus);
          debug('cmd    : %s', cmd);
        } else {
          await switchSession(session, window, wtd);
          await createTmuxWindow(session, window, wtd, focus, cmd)
          await splitTmuxWindow(`${session}:${window}`, wtd, +pane)
        }
      }

      if (!dryRun) {
        note('"tmux a" to attach created window');
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('open <branch>')
  .alias('o')
  .description('open worktree in designated machine\'s browser window')
  .option('-h, --host [host]', 'machine to open worktree (Default: cmba-15)', 'cmba-15')
  .option('-p, --profile [profile]', 'profile (Default: spectral)', 'spectral')
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
