const fs = require('fs')
const path = require('path')
/**
 * 
 * @param {String} suite 
 * @param {String} name 
 * @returns Array of files for the test case
 */
module.exports = (filesDir, suite, name) => {
    let files = [];
    if (filesDir !== undefined) {
      try {
        const filesPath = path.join(filesDir, suite, name);
        fs.readdirSync(filesPath).forEach(function (file) {
          if (file !== ".DS_Store") { // Exclude os files
            files.push(path.join(filesPath, file));
          }
        });
      } catch (err) { 
        if (err.code === 'ENOENT') {
          // Normal scenario where no files present
        } else {
          console.log('Tesults error reading case files.')
          console.log(err)
        }
      }
    }
    return files;
}