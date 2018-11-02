# wttw

<kbd><img width="400" src="https://user-images.githubusercontent.com/286950/44774937-5e07dc00-abaf-11e8-8adf-f91685358699.gif"/></kbd>

create new git worktree in tmux window.

## installation

```
$ npm install -g wttw
```

## how it works?

```sh
$ tree
project
├── .default_files
│   └── default_file
└── master
    ├── .git
    └── files1

$ wttw new new_branch
$ tree
project
├── .default_files
│   └── default_file
├── new_branch
│   ├── .git
│   ├── default_file
│   └── file1
└── master
    ├── .git
    └── files1
```
