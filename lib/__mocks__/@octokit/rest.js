const mockOctokit = {
  actions: {
    listRepoWorkflows: jest.fn().mockResolvedValue({data: {workflows: []}}),
    listSelfHostedRunnersForRepo: jest.fn().mockResolvedValue({data: {runners: []}}),
    createWorkflowDispatch: jest.fn().mockResolvedValue({}),
  }
};

const Octokit = jest.fn().mockImplementation(() => mockOctokit);

exports.Octokit = Octokit;
exports.__mockOctokit = mockOctokit;
