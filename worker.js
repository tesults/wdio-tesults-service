const fs = require('fs')
const path = require('path')
const testHash = require('./testHash')
const testFiles = require('./testFiles')
const shared = require('./shared')

/**
 * Helper function to get the browser/driver object
 * Supports both browser (legacy WDIO) and driver (modern WDIO with Appium)
 */
function getBrowserDriver() {
    if (typeof driver !== 'undefined') {
        return driver;
    }
    if (typeof browser !== 'undefined') {
        return browser;
    }
    return null;
}

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
let startTimes = {}

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

    testParams (pickle) {
        // Support both browser (legacy) and driver (modern WDIO with Appium)
        const browserDriver = getBrowserDriver();
        let params = {}
        if (browserDriver !== null && browserDriver.capabilities !== undefined) {
            const caps = browserDriver.capabilities;
            params["Device/Browser"] = caps.browserName || caps.platformName
        }
        if (pickle !== undefined) {
            params["Example Id"] = pickle.id
        }
        return params
    }

    /**
     *
     * Runs before a Cucumber Scenario.
     * @param {ITestCaseHookParameter} world    world object containing information on pickle and test step
     * @param {Object}                 context  Cucumber World object
     */
     beforeScenario (world, context) {
        let gherkinDocument = world.gherkinDocument
        if (gherkinDocument === undefined) {
            gherkinDocument = {}
        }

        let pickle = world.pickle
        if (pickle === undefined) {
            pickle = {}
        }

        let testCase = {suite: gherkinDocument.feature === undefined ? undefined : gherkinDocument.feature.name, name: pickle.name, params: this.testParams(pickle)}
        const browserDriver = getBrowserDriver();
        if (browserDriver !== null && browserDriver.sessionId !== undefined) {
            const sessionId = browserDriver.sessionId;
            if (supplemental[sessionId] === undefined) {
                supplemental[sessionId] = {current: testHash(testCase)}
            } else {
                let data = supplemental[sessionId]
                data.current = testHash(testCase)
                supplemental[sessionId] = data
            }
        }

        startTimes[testHash(testCase)] = Date.now()
    }
    
    /**
     *
     * Runs after a Cucumber Scenario.
     * @param {ITestCaseHookParameter} world            world object containing information on pickle and test step
     * @param {Object}                 result           results object containing scenario results `{passed: boolean, error: string, duration: number}`
     * @param {boolean}                result.passed    true if scenario has passed
     * @param {string}                 result.error     error stack if scenario failed
     * @param {number}                 result.duration  duration of scenario in milliseconds
     * @param {Object}                 context          Cucumber World object
     */
    afterScenario (world, result, context) {
        if (this.disabled === true) {
            return
        }

        let gherkinDocument = world.gherkinDocument
        if (gherkinDocument === undefined) {
            gherkinDocument = {}
        }

        let pickle = world.pickle
        if (pickle === undefined) {
            pickle = {}
        }

        let now = Date.now()
        let testCase = {
            name: pickle.name,
            suite: gherkinDocument.feature === undefined ? undefined : gherkinDocument.feature.name,
            result: "unknown",
            rawResult: world.result !== undefined ? world.result.status : undefined,
            end: now,
            params: this.testParams(pickle)
        }

        if (world.result !== undefined) {
            if (world.result.status === "PASSED") {
                testCase.result = "pass"
            }
            if (world.result.status === "FAILED") {
                testCase.result = "fail"
            }
        }

        if (result.duration !== undefined) {
            try {
                const duration = Math.trunc(now - startTimes[testHash(testCase)])
                testCase.start = now - duration
                testCase.duration = duration
            } catch (err) {
                // Do not set start and duration in this case
            }
        }

        // Steps
        let steps = []
        if (pickle.steps !== undefined) {
            if (Array.isArray(pickle.steps)) {
                for (let i = 0; i < pickle.steps.length; i++) {
                    let stepRaw = pickle.steps[i]
                    if (stepRaw !== undefined) {
                        let step = {
                            name: stepRaw.keyword,
                            desc: stepRaw.text,
                            result: (i === pickle.steps.length - 1) ? testCase.result : "pass"
                        }
                        steps.push(step)
                    }
                }
            }
        }
        if (steps.length > 0) {
            testCase.steps = steps
        }

        // Support both browser (legacy) and driver (modern WDIO with Appium)
        const browserDriver = getBrowserDriver();
        let sessionId = null;
        if (browserDriver !== null) {
            if (browserDriver.capabilities !== undefined) {
                const caps = browserDriver.capabilities;
                testCase["_Device/Browser Version"] = caps.browserVersion || caps.platformVersion || caps['appium:platformVersion']
            }
            if (browserDriver.sessionId !== undefined) {
                sessionId = browserDriver.sessionId;
            }
        }
        let files = testFiles(this.options.files, testCase.suite, testCase.name)
        if (files.length > 0) {
            testCase.files = files
        }
        if (result.passed !== true) {
            testCase.reason = result.error
        }

        // Supplemental fields
        if (supplemental !== undefined && sessionId !== null) {
            if (supplemental[sessionId] !== undefined) {
                let data = supplemental[sessionId][testHash(testCase)]
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
                supplemental[sessionId].current = undefined
            }
        }
        this.cases.push(testCase)
    }
    

    /**
     * Function to be executed before a test (in Mocha/Jasmine only)
     * @param {Object} test    test object
     * @param {Object} context scope object the test was executed with
     */
    beforeTest (test, context) {
        let testCase = {suite: test.parent, name: test.title, params: this.testParams()}
        if (test.title === undefined && test.parent === undefined
            && test.description !== undefined && test.fullName !== undefined) { // Jasmine
            testCase.name = test.description
            testCase.suite = test.fullName.replace(test.description, "").trim()
        }
        const browserDriver = getBrowserDriver();
        if (browserDriver !== null && browserDriver.sessionId !== undefined) {
            const sessionId = browserDriver.sessionId;
            if (supplemental[sessionId] === undefined) {
                supplemental[sessionId] = {current: testHash(testCase)}
            } else {
                let data = supplemental[sessionId]
                data.current = testHash(testCase)
                supplemental[sessionId] = data
            }
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
        if (error !== undefined) {
            try {
                error = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                }
            } catch (err) {
                // Swallow
            }
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
        if (test.failedExpectations !== undefined) { // Jasmine
            if (Array.isArray(test.failedExpectations)) {
                if (test.failedExpectations.length > 0) {
                    testCase.result = "fail"
                    testCase.reason = test.failedExpectations[0]
                }
            }
        }
        // Support both browser (legacy) and driver (modern WDIO with Appium)
        const browserDriver = getBrowserDriver();
        let sessionId = null;
        if (browserDriver !== null) {
            if (browserDriver.capabilities !== undefined) {
                const caps = browserDriver.capabilities;
                testCase["_Device/Browser Version"] = caps.browserVersion || caps.platformVersion || caps['appium:platformVersion']
            }
            if (browserDriver.sessionId !== undefined) {
                sessionId = browserDriver.sessionId;
            }
        }
        let files = testFiles(this.options.files, test.parent, test.title)
        if (files.length > 0) {
            testCase.files = files
        }
        if (passed !== true) {
            if (error !== undefined && test.title !== undefined) { // Mocha only
                testCase.reason = error
            }
        }
        if (test.data !== undefined) {
            testCase["_wdio_data"] = test.data
        }

        // Supplemental fields
        if (supplemental !== undefined && sessionId !== null) {
            if (supplemental[sessionId] !== undefined) {
                let data = supplemental[sessionId][testHash(testCase)]
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
                supplemental[sessionId].current = undefined
            }
        }
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
        if (this.cases.length === 0) {
            return
        }
        try {
            const browserDriver = typeof driver !== 'undefined' ? driver : (typeof browser !== 'undefined' ? browser : null);
            if (!browserDriver || !browserDriver.sessionId) {
                return
            }
            if (shared === undefined || shared.temp === undefined) {
                console.log("wdio-tesults-service error: shared.temp is not defined")
                return
            }
            const sessionId = browserDriver.sessionId;
            let fileContents = JSON.stringify(this.cases)
            fs.writeFileSync(path.join(shared.temp, sessionId + ".json"), fileContents)
        } catch (err) {
            console.log("wdio-tesults-service error saving test cases: " + err)
        }
    }
    
    afterSession (config, capabilities, specs) {
        if (this.disabled === true) {
            return
        }
        if (this.cases.length === 0) {
            return
        }
        try {
            const browserDriver = typeof driver !== 'undefined' ? driver : (typeof browser !== 'undefined' ? browser : null);
            if (!browserDriver || !browserDriver.sessionId) {
                return
            }
            if (shared === undefined || shared.temp === undefined) {
                console.log("wdio-tesults-service error: shared.temp is not defined")
                return
            }
            const sessionId = browserDriver.sessionId;
            let fileContents = JSON.stringify(this.cases)
            fs.writeFileSync(path.join(shared.temp, sessionId + ".json"), fileContents)
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
        const browserDriver = getBrowserDriver();
        if (browserDriver === null || browserDriver.sessionId === undefined) {
            return undefined
        }
        const sessionId = browserDriver.sessionId;
        if (supplemental[sessionId] === undefined) {
            return undefined
        }
        let testCaseHash = supplemental[sessionId].current
        if (testCaseHash === undefined) {
            return undefined
        }
        return supplemental[sessionId][testCaseHash]
    }

    /**
     * Sets supplemental data for the current test
     * @param {Any} val the new supplemental data
     * @returns void
     */
    static setSupplementalData (val) {
        const browserDriver = getBrowserDriver();
        if (browserDriver === null || browserDriver.sessionId === undefined) {
            return undefined
        }
        const sessionId = browserDriver.sessionId;
        if (supplemental[sessionId] === undefined) {
            return undefined
        }
        let testCaseHash = supplemental[sessionId].current
        if (testCaseHash === undefined) {
            return undefined
        }
        supplemental[sessionId][testCaseHash] = val
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