require('dotenv').config();

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/genesis';
// migrate-mongo quer a URL sem o database e o nome separado
const match = uri.match(/^(mongodb(?:\+srv)?:\/\/[^/]+)\/([^?]+)(\?.*)?$/);

module.exports = {
  mongodb: {
    url: match ? match[1] + (match[3] || '') : uri,
    databaseName: match ? match[2] : 'genesis',
    options: {},
  },
  migrationsDir: 'migrations',
  changelogCollectionName: 'migrations_changelog',
  migrationFileExtension: '.js',
  useFileHash: false,
  moduleSystem: 'commonjs',
};
