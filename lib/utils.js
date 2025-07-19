const {EOL} = require('os');
const {command, commandSync} = require('execa');
const {join, basename, resolve, relative} = require('path');
const {existsSync, readFileSync, writeFileSync} = require('fs-extra');
const {sync} = require('command-exists');
const klawSync = require('klaw-sync');
const {render} = require('ejs');

const isGitRepo = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(() => true)
    .catch(() => false);
}

const windowExists = async (session, window) => {
  try {
    const cmd = session ?
      `tmux list-windows -t ${session} -F #W` :
      `tmux list-windows -F #W`;
    const windows = await command(cmd)
      .then(({stdout}) => stdout)

    return !!windows.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .find(w => w === window);
  } catch (err) {
    return false;
  }
}

const sessionExists = async (name) => {
  try {
    const sessions = await command('tmux list-sessions -F #S')
      .then(({stdout}) => stdout);
    const session = sessions.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .find(s => s === name);
    return !!session;
  } catch (err) {
    return false;
  }
}

const direnvPrefix = () => process.env.DIRENV_DIR ? 'direnv exec / ' : '';

exports.checks = async (flags = {}) => {
  const {requireGitRepo = true, requireTmux = true} = flags;

  if (requireTmux && !sync('tmux')) {
    throw new Error('"tmux" is not available on your system');
  }

  if (!sync('git')) {
    throw new Error('"git" is not available on your system');
  }

  const git = await isGitRepo();
  if (requireGitRepo && !git) {
    throw new Error('should run in git repo');
  }
}

exports.tmuxRunning = () => {
  try {
    commandSync('tmux info');
    return true;
  } catch (err) {
    return false;
  }
}

exports.createWorktree = async (wtd, branch, baseRef, detach) => {
  if (existsSync(wtd)) {
    return;
  }
  const cmd = detach
    ? `git worktree add --detach ${wtd} ${baseRef}`
    : `git worktree add -B ${branch} ${wtd} ${baseRef}`;
  await command(cmd)
    .catch(err => {
      if (err.stderr && err.stderr.match(/^fatal:\s.*is already checked out at/)) {
        const worktreeDir = getWorktreeDirFromBranch(branch)
        throw new Error(`use 'wttw ../${worktreeDir}' to open exsiting worktree.`)
      }
      throw err
    })
}

exports.createTmuxWindow = async (session, window, wtd) => {
  const targetSession = session ? session + ':' : '';
  if (!await windowExists(session, window)) {
    await command(`${direnvPrefix()}tmux new-window -t ${session} -n ${window} -c ${wtd}`);
  }
  await command(`tmux select-window -t ${targetSession + window}`).catch((e) => {});
}

exports.splitTmuxWindow = async (target, wtd, pane) => {
  const prefix = direnvPrefix();
  if (pane === 6) {
    await command(`${prefix}tmux splitw -v -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 33 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 33 -t ${target}.3 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.3 -c ${wtd} && \
                ${prefix}tmux selectp -t ${target}.0`, {shell: true})
  } else {
    await command(`${prefix}tmux splitw -v -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.0 -c ${wtd} && \
                ${prefix}tmux splitw -h -p 50 -t ${target}.2 -c ${wtd} && \
                ${prefix}tmux selectp -t ${target}.0`, {shell: true})
  }
}

exports.branchExists = async (branch) => {
  return await command(`git show-branch ${branch}`)
    .then(() => true)
    .catch(() => false)
}

exports.getTmuxWindowId = async (name) => {
  try {
    const windows = await command('tmux list-windows -F #W:#{window_id}')
      .then(({stdout}) => stdout);
    const window = windows.split(EOL)
      .map(line => line.trim())
      .filter(line => line)
      .map(line => line.split(':'))
      .map(([name, id]) => ({name, id}))
      .find(w => w.name === name);
    return window.id;
  } catch (err) {
    throw new Error(`cannot find window name ${name} on tmux`);
  }
}

const sanitizeBranchName = (branch) => {
  return branch.slice(0, 20).replace(/[-_/]+$/, '')
}

const getWorktreeDirFromBranch = exports.getWorktreeDirFromBranch= branch => {
  // for '<TYPE>/<DESCRIPTION>' branch name convention
  if (branch.indexOf('/') > 0 && !branch.endsWith('/')) {
    const [, window] = branch.split('/');
    if (window.length == 0) {
      throw new Error(`branch name "${branch}" is invalid`);
    }
    return sanitizeBranchName(window);
  // for 'CU-XXX_title_user' convention
  } else if (branch.startsWith('CU-')) {
    const [taskId, _taskTitle, _user] = branch.split('_');
    return taskId;
  // for 'PROJECT-NUM_title_user' or 'PROJECT-NUM-title-user' convention
  } else if (matched = branch.match(/^\w+-\d+/g)) {
    return matched[0];
  } else {
    return sanitizeBranchName(branch);
  }
}

exports.resolveDefaultFiles = cwd => resolve(cwd, '..', 'default_files')

exports.copyDefaultFiles = (defaultFiles, wtd) => {
  if (!existsSync(defaultFiles)) {
    return;
  }

  const paths = klawSync(defaultFiles, {nodir: true, traverseAll: true, filter: (item) => {
    if (basename(item.path) === 'HOOK.js') {
      return false;
    }
    return true;
  }})
  .map(item => item.path)
  .map(path => ({from: path, to: join(wtd, relative(defaultFiles, path))}))

  paths.forEach(({from, to}) => {
    const content = readFileSync(from, 'utf8');
    const rendered = render(content, {branch: basename(wtd)});
    writeFileSync(to, rendered);
  })

  return paths.map(({to}) => to);
}

exports.runHook = (defaultFiles, window, wtd) => {
  const hook = join(defaultFiles, 'HOOK.js');
  if (!existsSync(defaultFiles)) {
    return;
  }

  if (!existsSync(hook)) {
    return;
  }

  require(hook)(window, wtd);
}

exports.rootDir = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(({stdout}) => stdout)
    .catch(() => process.cwd());
}

exports.resolveMainWorktree = async () => {
  return await command('git worktree list')
    .then(({stdout}) => stdout)
    .then(list => list.split(EOL).map(line => line.trim()).filter(line => line)[0])
    .then(main => main.split(' ')[0])
}

const createSession = exports.createSession = async (session, window, wtd) => {
  return await command(`${direnvPrefix()}tmux new-session -d -c ${wtd} -s ${session} -n ${window}`);
}

exports.switchSession = async (session, window, wtd) => {
  if (!await sessionExists(session)) {
    await createSession(session, window, wtd);
  }
  await command(`tmux switch -t ${session}`);
}

exports.showPopup = async (wtd) => {
  const taskPath = join(wtd, '.context', 'TASK.md');
  if (!existsSync(taskPath)) {
    return;
  }

  await command(`tmux popup -d ${wtd} -- /usr/local/bin/bat .context/TASK.md`);
}
