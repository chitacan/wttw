const {EOL} = require('os');
const {command} = require('execa');
const {basename, resolve} = require('path');
const {existsSync} = require('fs-extra');

const isGitRepo = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(() => true)
    .catch(() => false);
}

const sanitizeBranchName = (branch) => {
  return branch.slice(0, 20).replace(/[-_/]+$/, '')
}

const getWorktreeDirFromBranch = exports.getWorktreeDirFromBranch = exports.getWindowNameFromBranch = branch => {
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

exports.isGitRepo = isGitRepo;

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

exports.listWorktrees = async () => {
  return await command('git worktree list')
    .then(({stdout}) => stdout)
    .then(list => list.split(EOL).map(line => line.trim()).filter(line => line))
    .then(list => list.map(line => {
      const [path, hash, branch] = line.split(/\s+/);
      const parsedBranch = branch ? branch.replace(/\[|\]/g, '') : null;
      return {path, hash, branch: parsedBranch};
    }));
}

exports.branchExists = async (branch) => {
  return await command(`git show-branch ${branch}`)
    .then(() => true)
    .catch(() => false)
}

const rootDir = exports.rootDir = async () => {
  return await command('git rev-parse --show-toplevel')
    .then(({stdout}) => stdout)
    .catch(() => process.cwd());
}

exports.resolveProjectName = async () => {
  return await rootDir().then(cwd => basename(resolve(cwd, '..')));
}

exports.resolveMainWorktree = async () => {
  return await command('git worktree list')
    .then(({stdout}) => stdout)
    .then(list => list.split(EOL).map(line => line.trim()).filter(line => line)[0])
    .then(main => main.split(' ')[0])
}
