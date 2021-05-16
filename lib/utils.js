const {EOL} = require('os');
const {command, commandSync} = require('execa');
const {info, error} = require('signale');
const {join, basename, resolve} = require('path');
const {existsSync, copySync} = require('fs-extra');
const {sync} = require('command-exists');

const isGitRepo = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(() => true)
    .catch(() => false);
}

exports.checks = async (flags = {}) => {
  const {requireGitRepo = true} = flags;

  if (!sync('tmux')) {
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

exports.createWorktree = async (wtd, branch, baseRef) => {
  if (existsSync(wtd)) {
    return;
  }
  await command(`git worktree add -B ${branch} ${wtd} ${baseRef}`)
    .catch(err => {
      if (err.stderr && err.stderr.match(/^fatal:\s.*is already checked out at/)) {
        const window = getWindowNameFromBranch(branch)
        throw new Error(`use 'wttw ../${window}' to open exsiting worktree.`)
      }
      throw err
    })
}

exports.createTmuxWindow = async (window, wtd) => {
  await command(`tmux new-window -n ${window} -c ${wtd}`);
  await command(`tmux select-window -t ${window}`).catch(() => {});
}

exports.splitTmuxWindow = async (wtd, pane) => {
  if (pane === 4) {
    await command(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 2 -c ${wtd} && \
                tmux selectp -t 0`, {shell: true})
  } else if (pane === 6) {
    await command(`tmux splitw -v -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 0 -c ${wtd} && \
                tmux splitw -h -p 50 -t 0 -c ${wtd} && \
                tmux splitw -h -p 33 -t 3 -c ${wtd} && \
                tmux splitw -h -p 50 -t 3 -c ${wtd} && \
                tmux selectp -t 0`, {shell: true})
  }
}

exports.branchExists = async (branch) => {
  return await command(`git show-branch ${branch}`)
    .then(() => true)
    .catch(() => false)
}

exports.getTmuxWindowId = async (name) => {
  try {
    const windows = await command('tmux list-windows -F "#W:#{window_id}"')
      .then(({stdout}) => stdout);
    const window = windows.split(EOL)
      .map(line => line.split(':'))
      .map(([name, id]) => ({name, id}))
      .find(w => w.name === name);
    return window.id;
  } catch (err) {
    throw new Error(`cannot find window name ${name} on tmux`);
  }
}

const getWindowNameFromBranch = exports.getWindowNameFromBranch = branch => {
  if (branch.indexOf('/') > 0) {
    // for branch style '<TYPE>/<DESCRIPTION>'
    const [, window] = branch.split('/');
    return window;
  }
  return branch;
}

exports.resolveDefaultFiles = cwd => resolve(cwd, '..', '.default_files')

exports.copyDefaultFiles = (defaultFiles, wtd) => {
  if (!existsSync(defaultFiles)) {
    return;
  }

  copySync(defaultFiles, wtd, {filter: file => {
    if (basename(file) === 'HOOK.js') {
      return false
    }
    return true
  }});
}

exports.updateDefaultFiles = (defaultFiles, wtd) => {
  if (!existsSync(defaultFiles)) {
    return;
  }

  copySync(wtd, defaultFiles, {filter: (src, dst) => {
    return existsSync(dst)
  }});
}

exports.runHook = (defaultFiles, window, wtd) => {
  const hook = join(defaultFiles, 'HOOK.js');
  if (!existsSync(defaultFiles)) {
    return;
  }

  if (!existsSync(hook)) {
    return;
  }

  require(hook)(window, wtd)
}

exports.rootDir = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(({stdout}) => stdout)
    .catch(() => process.cwd());
}

exports.resolveMainWorktree = async () => {
  return await command('git worktree list')
    .then(({stdout}) => stdout)
    .then(list => list.split(EOL)[0])
    .then(main => main.split(' ')[0])
}
