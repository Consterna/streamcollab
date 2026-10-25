// Mutation testing of the timecode engine and the NLE exporters, where a wrong frame or field is
// silent: every surviving mutant is a change no test notices.
// Not a dependency of the project (its typed-rest-client pins a qs with open advisories), so it is
// installed for the run only:
//   npm install --no-save @stryker-mutator/core@10.1.1 @stryker-mutator/vitest-runner@10.1.1
//   npx stryker run
// The GitHub workflow "Mutation testing" does the same on demand.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.stryker.mts', related: false },
  mutate: ['packages/shared/src/timecode/**/*.ts', 'packages/shared/src/exporters/**/*.ts'],
  coverageAnalysis: 'perTest',
  // Static mutants (the framerate table) rerun every test, property tests included. Under the default
  // timeout they ended as Timeout or Survived depending on machine load (scores from 87.6 to 93.7 % on
  // the same code); with 60 s each one finishes, and two runs give the same result for every mutant.
  timeoutMS: 60_000,
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  tempDirName: '.stryker-tmp',
};
