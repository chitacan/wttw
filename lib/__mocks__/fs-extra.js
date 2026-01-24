exports.existsSync = jest.fn().mockReturnValue(false);

exports.copySync = jest.fn().mockReturnValue(true);

exports.readFileSync = jest.fn().mockReturnValue(true);

exports.writeFileSync = jest.fn().mockReturnValue(true);

exports.ensureDirSync = jest.fn();
