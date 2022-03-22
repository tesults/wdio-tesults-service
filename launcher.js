const fs = require('fs')
const path = require('path')
const tesults = require('tesults')
const testHash = require('./testHash')
const testFiles = require('./testFiles')
const shared = require("./shared")

module.exports = class TesultsLauncherService {
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
        this.disabled = false
        this.complete = true
        if (this.options.target === undefined) {
            this.disabled = true
            console.log("Target option not supplied. Tesults disabled.")
        }
    }
    // If a hook returns a promise, WebdriverIO will wait until that promise is resolved to continue.
    async onPrepare(config, capabilities) {
        // Before all workers launch
        try {
            fs.rmSync(shared.temp, {recursive: true})
        } catch (err) {
            console.log("wdio-tesults-service error removing temp directory: " + err)
        }
        try {
            fs.mkdirSync(shared.temp)
            fs.writeFileSync(path.join(shared.temp, "README.txt"), "This directory is created by wdio-tesults-service and can be safely deleted. The directory will be automatically generated again when required.")
        } catch (err) {
            console.log("wdio-tesults-service error creating temp directory: " + err)
        }
    }

    async onComplete(exitCode, config, capabilities) {
        // After the workers shutdown
        if (this.disabled === true) {
            return
        }
        let cases = []
        let casesRetries = {}
        let files = fs.readdirSync(shared.temp)
        for (let i = 0; i < files.length; i++) {
            let file = files[i]
            let casesString = ""
            let casesArray = []
            try {
                casesString = fs.readFileSync(path.join(shared.temp, file), {encoding: 'utf8'})
                casesArray = JSON.parse(casesString)
            } catch (err) {
                continue
            }            
            if (Array.isArray(casesArray)) {
                for (let j = 0; j < casesArray.length; j++) {
                    let testCase = casesArray[j]
                    let testCaseHash = testHash(testCase)
                    if (casesRetries[testCaseHash] === undefined) {
                        testCase["_Retries"] = 0
                        casesRetries[testCaseHash] = {retries: 0, index: cases.length}
                        cases.push(testCase)
                    } else {
                        let retries = casesRetries[testCaseHash]
                        let retryNum = retries.retries + 1
                        testCase["_Retries"] = retryNum
                        casesRetries[testCaseHash] = {retries: retryNum, index: retries.index}
                        if (cases[retries.index].end < testCase.end) {
                            cases[retries.index] = testCase
                        } else {
                            let c = cases[retries.index]
                            c["_Retries"] = retryNum
                            cases[retries.index] = c
                        }
                    }
                }
            }
        }
        let build = this.options.build
        if (build !== undefined) {
            if (build.name !== undefined) {
                build.rawResult = build.result
                if (build.result !== "pass" && build.result !== "fail") {
                    build.result = "unknown"
                }
                build.suite = "[build]"
                if (build.files === undefined) {
                    let buildCaseFiles = testFiles(this.options.files, build.suite, build.name)
                    if (buildCaseFiles.length > 0) {
                        build.files = buildCaseFiles   
                    }
                }
                if (build.description !== undefined) {
                    build.desc = build.description
                    delete build.description
                }
                cases.push(build)
            }
        }
        
        let data = {
            target: this.options.target,
            results: {
                cases: cases
            }
        }

        console.log("Tesults results upload...\n")
        return new Promise((resolve, reject) => {
            tesults.results(data, function (err, response) {
                if (err) {
                    console.log('Tesults library error, failed to upload.');
                    return reject('Tesults library error, failed to upload.');
                } else {
                    console.log('Success: ' + response.success);
                    console.log('Message: ' + response.message);
                    console.log('Warnings: ' + response.warnings.length);
                    console.log('Errors: ' + response.errors.length);
                    resolve();
                }
            });
        });
    }
}