/**
 * 
 * @param {Test} test 
 * @returns Generates a hash for test case
 */
module.exports = (test) => {
    let hash = test.suite + test.name;
    if (test.params !== undefined) {
        let keys = [];
        Object.keys(test.params).forEach(function (key) {
            keys.push(key);
        });
        keys.sort();
        let paramStringArray = [];
        keys.forEach(function (key) {
            paramStringArray.push(key + test.params[key]);
        });
        hash += paramStringArray.join('');
    }
    return hash
}