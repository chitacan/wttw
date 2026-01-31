exports.existsSync = jest.fn().mockReturnValue(false);

exports.copySync = jest.fn().mockReturnValue(true);

exports.readFileSync = jest.fn().mockReturnValue(true);

exports.readJsonSync = jest.fn().mockReturnValue(null);

exports.writeFileSync = jest.fn().mockReturnValue(true);

exports.writeJsonSync = jest.fn();

exports.ensureDirSync = jest.fn();
