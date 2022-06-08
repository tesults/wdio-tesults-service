const fs = require('fs')
const path = require('path')
const testHash = require('./testHash')
const testFiles = require('./testFiles')
const shared = require('./shared')

/**
 * supplemental data structure
 * 
 * {
 *      <sessionId#1> : {
 *          current: <testHash>
 *          <testHash#1>: {description: <description>, steps: <steps>, files: <files>, _Custom: <custom>}
 *          <testHash#2>: {description: <description>, steps: <steps>, files: <files>, _Custom: <custom>}
 *          ...
 *      },
 *      <sessionId#2> : {
 *          current: <testHash>
 *          <testHash#1>: {description: <description>, steps: <steps>, files: <files>, _Custom: <custom>}
 *          <testHash#2>: {description: <description>, steps: <steps>, files: <files>, _Custom: <custom>}
 *          ...
 *      },
 *      ...
 * }
 */
let supplemental = {}

module.exports = class TesultsWorkerService {
    /**
     * `serviceOptions` contains all options specific to the service
     * e.g. if defined as follows:
     *
     * ```
     * services: [['custom', { foo: 'bar' }]]
     * ```
     *
     * the `serviceOptions` parameter will be: `{ foo: 'bar' }`
     */
    constructor (serviceOptions, capabilities, config) {
        this.options = serviceOptions
        this.cases = []
        this.disabled = false
        if (this.options.target === undefined) {
            this.disabled = true
        }
    }

    testParams () {
        return {
            "Device/Browser": browser.capabilities.browserName
        }
    }

    

    /**
     * Function to be executed before a test (in Mocha/Jasmine only)
     * @param {Object} test    test object
     * @param {Object} context scope object the test was executed with
     */
    beforeTest (test, context) {
        let testCase = {suite: test.parent, name: test.title, params: this.testParams()}
        if (supplemental[browser.sessionId] === undefined) {
            supplemental[browser.sessionId] = {current: testHash(testCase)}
        } else {
            let data = supplemental[browser.sessionId]
            data.current = testHash(testCase)
            supplemental[browser.sessionId] = data
        }
    }

    /**
     * Function to be executed after a test (in Mocha/Jasmine only)
     * @param {Object}  test             test object
     * @param {Object}  context          scope object the test was executed with
     * @param {Error}   result.error     error object in case the test fails, otherwise `undefined`
     * @param {Any}     result.result    return object of test function
     * @param {Number}  result.duration  duration of test
     * @param {Boolean} result.passed    true if test has passed, otherwise false
     * @param {Object}  result.retries   informations to spec related retries, e.g. `{ attempts: 0, limit: 0 }`
     */
    afterTest (test, context, { error, result, duration, passed, retries }) {
        if (this.disabled === true) {
            return
        }
        let now = Date.now()
        let testCase = {
            name: test.title,
            suite: test.parent,
            result: passed ? "pass" : "fail",
            reason: passed ? undefined : error,
            start: now - duration,
            end: now,
            duration: duration,
            _cid: test.cid,
            _uid: test.uid,
            _type: test.type,
            _returned: result,
            params: this.testParams()
        }
        if (test.title === undefined && test.parent === undefined
            && test.description !== undefined && test.fullName !== undefined) { // Jasmine
            testCase.name = test.description
            testCase.suite = test.fullName.replace(test.description, "").trim()
        }
        testCase["_Device/Browser Version"] = browser.capabilities.browserVersion
        let files = testFiles(this.options.files, test.parent, test.title)
        if (files.length > 0) {
            testCase.files = files
        }
        if (passed !== true) {
            if (error !== undefined) {
                testCase.reason = error
            }
        }
        if (test.data !== undefined) {
            testCase["_wdio_data"] = test.data
        }
        
        // Supplemental fields
        if (supplemental !== undefined) {
            if (supplemental[browser.sessionId] !== undefined) {
                let data = supplemental[browser.sessionId][testHash(testCase)]
                if (data !== undefined) {
                    if (data.desc !== undefined) {
                        testCase.desc = data.desc
                    }
                    if (data.steps !== undefined) {
                        testCase.steps = data.steps
                    }
                    if (data.files !== undefined) {
                        testCase.files = data.files
                    }
                    Object.keys(data).forEach((key) => {
                        if (key.startsWith("_")) {
                            testCase[key] = data[key]
                        }
                    })
                }
            }
        }
        supplemental[browser.sessionId].current = undefined
        this.cases.push(testCase)
    }

   
    /**
     * Gets executed after all tests are done. You still have access to all global variables from
     * the test.
     * @param {Number} result 0 - test pass, 1 - test fail
     * @param {Array.<Object>} capabilities list of capabilities details
     * @param {Array.<String>} specs List of spec file paths that ran
     */
    after (result, capabilities, specs) {
        if (this.disabled === true) {
            return
        }
        try {
            let fileContents = JSON.stringify(this.cases)
            fs.writeFileSync(path.join(shared.temp, browser.sessionId + ".json"), fileContents)
        } catch (err) {
            console.log("wdio-tesults-service error saving test cases: " + err)
        }
    }

    // Supplemental reporter functions (description, custom, step and file)

    /**
     * Gets supplemental data for the current test
     * @returns supplementalData
     */
    static getSupplementalData () {
        if (supplemental[browser.sessionId] === undefined) {
            return undefined
        }
        let testCaseHash = supplemental[browser.sessionId].current
        if (testCaseHash === undefined) {
            return undefined
        }
        return supplemental[browser.sessionId][testCaseHash]
    }

    /**
     * Sets supplemental data for the current test
     * @param {Any} val the new supplemental data
     * @returns void
     */
    static setSupplementalData (val) {
        if (supplemental[browser.sessionId] === undefined) {
            return undefined
        }
        let testCaseHash = supplemental[browser.sessionId].current
        if (testCaseHash === undefined) {
            return undefined
        }
        supplemental[browser.sessionId][testCaseHash] = val
    }

    /**
     * Set description for test case
     * @param {String} val the description
     * @returns void
     */
    static description(val) {
        if (val === undefined) {
            return
        }
        let data = this.getSupplementalData()
        if (data === undefined) {
            this.setSupplementalData({desc: val})
        } else {
            data.desc = val
            this.setSupplementalData(data)
        }
    }

    /**
     * Set a custom field for test case
     * @param {String} key the name of the custom field
     * @param {Any} val the value for the custom field
     * @returns void
     */
    static custom (key, val) {
        if (key === undefined || val === undefined) {
            return
        }
        let data = this.getSupplementalData()
        let newData = {}
        if (data !== undefined) {
            newData = data
        }
        newData["_" + key] = val
        this.setSupplementalData(newData)
    }

    /**
     * Set a step for test case
     * @param {Object} step step object consisting of a name and result (pass|fail|unknown) 
     * and optional description and reason (for failure) properties
     * @returns void
     */
    static step (step) {
        if (step === undefined) {
            return
        }
        if (step.description !== undefined) {
            step.desc = step.description
            delete step.description
        }
        let data = this.getSupplementalData()
        let newData = {}
        if (data === undefined) {
            newData = {steps: [step]}
        } else {
            newData = data
            let steps = newData.steps
            if (steps === undefined) {
                newData.steps = [step]
            } else {
                // deduplication start
                // Removed due to user feedback - repeated steps should be permitted
                // Note that removing deduplication will mean that on retries, steps will be repeated in output
                /*let newDataStepsIndex = {}
                for (let i = 0; i < newData.steps.length; i++) {
                    let newDataStep = newData.steps[i]
                    newDataStepsIndex[newDataStep.name] = i
                }
                if (newDataStepsIndex[step.name] !== undefined) {
                    newData.steps.splice(newDataStepsIndex[step.name])
                }*/
                // deduplication end
                newData.steps.push(step)
            }
        }
        this.setSupplementalData(newData)
    }

    /**
     * Associate a file to test case
     * @param {String} file absolute path to a file to associate to the test case
     * @returns void
     */
    static file (file) {
        if (file === undefined) {
            return
        }
        let data = this.getSupplementalData()
        let newData = {}
        if (data === undefined) {
            newData = {files: [file]}
        } else {
            newData = data
            let files = newData.files
            if (files === undefined) {
                newData.files = [file]
            } else {
                newData.files.push(file)
            }
        }
        newData.files = [...new Set(newData.files)]; // deduplication
        this.setSupplementalData(newData)
    }
}