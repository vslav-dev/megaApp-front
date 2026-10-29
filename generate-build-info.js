const { execSync } = require('child_process');
const fs = require('fs');

const getLatestGitCommitHash = () => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch (e) {
    return 'unknown';
  }
};

const getLatestGitCommitDateTime = () => {
  try {
    const timestamp = execSync('git show -s --format=%ci HEAD').toString().trim();
    return new Date(timestamp).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' });
  } catch (e) {
    return 'unknown';
  }
};

const buildInfo = {
  commitHash: getLatestGitCommitHash(),
  commitDateTime: getLatestGitCommitDateTime(),
};

fs.writeFileSync('./src/assets/build-info.json', JSON.stringify(buildInfo, null, 2));
console.log('Build info generated successfully');
