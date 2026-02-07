const cmd = require('commander');
const {command} = require('execa');
const {debug, error, note} = require('signale');
const {resolve, basename, join, dirname} = require('path');
const {copySync, ensureDirSync} = require('fs-extra');
const {homedir} = require('os');
const {version, description} = require('../package');
const {getConfig, setConfig, requireConfig, loadTemplate, loadProjectConfig, getProjectConfig, setProjectConfig} = require('./config');
const {
  getWorktreeDirFromBranch,
  createWorktree,
  listWorktrees,
  branchExists,
  rootDir,
  resolveProjectName,
  resolveMainWorktree,
} = require('./git');
const {
  tmuxRunning,
  createTmuxWindow,
  splitTmuxWindow,
  getTmuxWindowId,
  createSession,
  switchSession,
} = require('./tmux');
const {
  checks,
  copyDefaultFiles,
  copyWorkspaceFile,
  runHook,
  resolveDefaultFiles,
  buildCodeURL,
  requestOpenCode,
} = require('./utils');

cmd.version(version)
  .description(description)
  .option('-D, --dry-run', 'dry run')

cmd.command('new <branches...>')
  .alias('n')
  .description('create new worktrees & tmux windows')
  .option('-t, --tmux', 'open tmux window (Default: config tmux)')
  .option('-r, --base-ref [ref]', 'base ref new branch based at', '')
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-p, --pane <count>', 'tmux pane count (Default: config paneCount)')
  .option('-d, --detach', 'create detached worktree')
  .option('-W, --no-workspace', 'skip copying code-workspace file')
  .option('-f, --focus', 'focus created tmux window')
  .option('-c, --cmd <command>', 'command to run in each pane after creation (Default: config cmd)')
  .action(async (branches, {pane: paneOpt, session, baseRef: baseRefOpt, detach, workspace, tmux: tmuxOpt, cmd: cmdOpt, focus, parent: {dryRun}}) => {
    try {
      const cwd = await rootDir();
      const config = loadProjectConfig(cwd);
      let tmux = tmuxOpt ?? config.tmux;
      let cmd = cmdOpt ?? config.cmd;
      let pane = paneOpt ?? config.paneCount;

      await checks({requireTmux: tmux});

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
  .option('-p, --pane <count>', 'tmux pane count (Default: config paneCount)')
  .option('-s, --session [session]', 'session name for tmux window (Default: current session)')
  .option('-f, --focus', 'focus created tmux window')
  .option('-c, --cmd <command>', 'command to run in each pane after creation (Default: config cmd)')
  .action(async (branches, {pane: paneOpt, session, focus, cmd: cmdOpt, parent: {dryRun}}) => {
    try {
      await checks({requireGitRepo: true});

      const cwd = await rootDir();
      const config = loadProjectConfig(cwd);
      let cmd = cmdOpt ?? config.cmd;
      let pane = paneOpt ?? config.paneCount;
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
  .option('-h, --host [host]', 'machine to open worktree (Default: config github.host)')
  .option('-p, --profile [profile]', 'vscode profile (Default: config vscode.profile)')
  .action(async (branch, {host: hostOpt, profile: profileOpt, parent: {dryRun}}) => {
    try {
      await checks({requireGitRepo: true});

      const cwd = await rootDir();
      const host = hostOpt ?? getProjectConfig(cwd, 'github.host');
      const profile = profileOpt ?? getProjectConfig(cwd, 'vscode.profile');
      if (!host) requireConfig('github.host');
      if (!profile) requireConfig('vscode.profile');

      const worktrees = await listWorktrees();
      if (worktrees.find(wt => wt.branch === branch) == null) {
        throw new Error(`worktree "${branch}" does not exist`);
      }

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

cmd.command('template <template-name>')
  .alias('tp')
  .description('create tmux windows from a template')
  .on('--help', () => {
    console.log('');
    console.log('  Template file: ~/.config/wttw/<template-name>.json');
    console.log('');
    console.log('  Example:');
    console.log('');
    console.log('    {');
    console.log('      "session": "my-session",');
    console.log('      "windows": [');
    console.log('        { "name": "editor", "path": "~/projects/app", "pane": 4, "cmd": "vim" },');
    console.log('        { "name": "server", "path": "~/projects/app" },');
    console.log('        { "name": "logs", "path": "/var/log", "cmd": "tail -f syslog" }');
    console.log('      ]');
    console.log('    }');
    console.log('');
    console.log('  Fields:');
    console.log('    session          session name (optional, default: current session)');
    console.log('    windows[].name   window name (required)');
    console.log('    windows[].path   working directory (required)');
    console.log('    windows[].pane   pane count (optional, default: config paneCount)');
    console.log('    windows[].cmd    command to run (optional)');
  })
  .action(async (templateName, {parent: {dryRun}}) => {
    try {
      await checks({requireGitRepo: false});

      const template = loadTemplate(templateName);
      const {windows = []} = template;
      let {session} = template;
      let paneCount;
      try {
        const cwd = await rootDir();
        paneCount = loadProjectConfig(cwd).paneCount;
      } catch {
        paneCount = getConfig('paneCount');
      }

      if (windows.length === 0) {
        throw new Error('template has no windows defined');
      }

      const resolvePath = (p) => p.replace(/^~/, homedir());
      const firstWindow = windows[0];

      if (!tmuxRunning()) {
        if (!session) session = templateName;
        await createSession(session, firstWindow.name, resolvePath(firstWindow.path));
        note('"tmux a" to attach created session');
      }

      if (!session) {
        session = await command('tmux display-message -p #S')
          .then(({stdout}) => stdout);
      }

      for (const w of windows) {
        if (dryRun) {
          debug('=== %s ===', w.name);
          debug('path   : %s', w.path);
          debug('pane   : %s', w.pane || paneCount);
          debug('cmd    : %s', w.cmd || '');
          debug('session: %s', session);
        } else {
          const wtd = resolvePath(w.path);
          await createTmuxWindow(session, w.name, wtd, false, w.cmd || '')
          await splitTmuxWindow(`${session}:${w.name}`, wtd, w.pane || paneCount)
        }
      }

      if (!dryRun) {
        note(`template "${templateName}" applied`);
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('config [key] [value]')
  .alias('cf')
  .description('get or set config values')
  .on('--help', () => {
    console.log('');
    console.log('  Fields:');
    console.log('    paneCount   default tmux pane count (default: 1)');
    console.log('    tmux               open tmux window by default (boolean)');
    console.log('    cmd                command to run in each pane after creation');
    console.log('    github.host        machine name for open command');
    console.log('    github.owner       GitHub repository owner');
    console.log('    github.repo        GitHub repository name');
    console.log('    github.ref         GitHub ref for workflow dispatch');
    console.log('    vscode.baseUrl     base URL for VS Code tunnel');
    console.log('    vscode.tunnelName  VS Code tunnel name');
    console.log('    vscode.profile     VS Code profile name');
    console.log('    arcSpaceName       Arc space name for open command');
    console.log('');
    console.log('  Config files:');
    console.log('    global    ~/.config/wttw/config.json');
    console.log('    worktree  <git-root>/../context/wttw.json');
    console.log('');
    console.log('  In a git repo, get reads merged config (global + worktree)');
    console.log('  and set writes to the worktree config file.');
  })
  .action(async (key, value) => {
    try {
      let cwd;
      try {
        cwd = await rootDir();
      } catch {
        // not in a git repo, use global config
      }

      if (!key) {
        const config = cwd ? loadProjectConfig(cwd) : getConfig();
        console.log(JSON.stringify(config, null, 2));
      } else if (value === undefined) {
        const val = cwd ? getProjectConfig(cwd, key) : getConfig(key);
        if (val !== undefined) {
          console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : val);
        }
      } else {
        // parse number values
        const parsed = Number(value);
        const v = isNaN(parsed) ? value : parsed;
        if (cwd) {
          setProjectConfig(cwd, key, v);
        } else {
          setConfig(key, v);
        }
        note(`${key} = ${value}`);
      }
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.command('install-completion')
  .alias('ic')
  .description('install fish shell completion')
  .action(() => {
    try {
      const src = resolve(__dirname, '..', 'completions', 'wttw.fish');
      const dest = join(homedir(), '.config', 'fish', 'completions', 'wttw.fish');
      ensureDirSync(dirname(dest));
      copySync(src, dest);
      note(`completion installed to ${dest}`);
    } catch (err) {
      error(err);
      process.exit(1);
    }
  })

cmd.parse(process.argv);
