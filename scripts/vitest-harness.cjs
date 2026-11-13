'use strict';

const assert = require('assert');

const suites = [];
let currentSuite = { name: 'root', tests: [], beforeEachFns: [], afterEachFns: [] };
suites.push(currentSuite);

function describe(name, fn) {
  const prevSuite = currentSuite;
  const suite = {
    name: prevSuite.name === 'root' ? name : `${prevSuite.name} > ${name}`,
    tests: [],
    beforeEachFns: [...prevSuite.beforeEachFns],
    afterEachFns: [...prevSuite.afterEachFns],
  };
  suites.push(suite);
  currentSuite = suite;
  fn();
  currentSuite = prevSuite;
}

function it(name, fn) {
  currentSuite.tests.push({
    name,
    fn,
    beforeEachFns: [...currentSuite.beforeEachFns],
    afterEachFns: [...currentSuite.afterEachFns],
  });
}

const test = it;

function beforeEach(fn) {
  currentSuite.beforeEachFns.push(fn);
}

function afterEach(fn) {
  currentSuite.afterEachFns.push(fn);
}

function createExpect(actual, isNot = false) {
  const check = (cond, msg) => {
    const pass = isNot ? !cond : cond;
    if (!pass) {
      throw new assert.AssertionError({ message: msg, actual });
    }
  };

  return {
    get not() {
      return createExpect(actual, !isNot);
    },
    toBe(expected) {
      check(Object.is(actual, expected), `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to be ${JSON.stringify(expected)}`);
    },
    toEqual(expected) {
      let eq = false;
      try {
        assert.deepStrictEqual(actual, expected);
        eq = true;
      } catch {
        eq = false;
      }
      check(eq, `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to deep-equal ${JSON.stringify(expected)}`);
    },
    toContain(item) {
      const has = typeof actual === 'string'
        ? actual.includes(item)
        : Array.isArray(actual) && actual.includes(item);
      check(has, `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to contain ${JSON.stringify(item)}`);
    },
    toMatch(pattern) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
      check(regex.test(String(actual)), `Expected ${String(actual)} ${isNot ? 'not ' : ''}to match ${ String(pattern) }`);
    },
    toBeTruthy() {
      check(Boolean(actual), `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to be truthy`);
    },
    toBeFalsy() {
      check(!actual, `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to be falsy`);
    },
    toBeDefined() {
      check(actual !== undefined, `Expected value ${isNot ? 'not ' : ''}to be defined`);
    },
    toBeUndefined() {
      check(actual === undefined, `Expected value ${isNot ? 'not ' : ''}to be undefined`);
    },
    toBeNull() {
      check(actual === null, `Expected ${JSON.stringify(actual)} ${isNot ? 'not ' : ''}to be null`);
    },
    toBeGreaterThan(num) {
      check(typeof actual === 'number' && actual > num, `Expected ${actual} ${isNot ? 'not ' : ''}to be > ${num}`);
    },
    toBeGreaterThanOrEqual(num) {
      check(typeof actual === 'number' && actual >= num, `Expected ${actual} ${isNot ? 'not ' : ''}to be >= ${num}`);
    },
    toBeLessThan(num) {
      check(typeof actual === 'number' && actual < num, `Expected ${actual} ${isNot ? 'not ' : ''}to be < ${num}`);
    },
    toBeLessThanOrEqual(num) {
      check(typeof actual === 'number' && actual <= num, `Expected ${actual} ${isNot ? 'not ' : ''}to be <= ${num}`);
    },
    toHaveLength(len) {
      const actualLen = actual && typeof actual.length === 'number' ? actual.length : -1;
      check(actualLen === len, `Expected length ${actualLen} ${isNot ? 'not ' : ''}to be ${len}`);
    },
    toHaveProperty(prop, val) {
      const has = actual !== null && actual !== undefined && prop in Object(actual);
      if (val !== undefined) {
        check(has && Object(actual)[prop] === val, `Expected property ${prop} to equal ${val}`);
      } else {
        check(has, `Expected object to have property ${prop}`);
      }
    },
    toThrow(expectedMsg) {
      let threw = false;
      let errObj = null;
      try {
        actual();
      } catch (e) {
        threw = true;
        errObj = e;
      }
      if (!isNot && expectedMsg) {
        const msg = errObj && errObj.message ? errObj.message : String(errObj);
        const matches = typeof expectedMsg === 'string' ? msg.includes(expectedMsg) : expectedMsg.test(msg);
        check(threw && matches, `Expected function to throw matching ${expectedMsg}, got ${msg}`);
      } else {
        check(threw, `Expected function ${isNot ? 'not ' : ''}to throw`);
      }
    },
    get resolves() {
      return {
        async toBe(expected) {
          const val = await actual;
          createExpect(val, isNot).toBe(expected);
        },
        async toEqual(expected) {
          const val = await actual;
          createExpect(val, isNot).toEqual(expected);
        },
      };
    },
    get rejects() {
      return {
        async toThrow(expectedMsg) {
          let threw = false;
          let errObj = null;
          try {
            await actual;
          } catch (e) {
            threw = true;
            errObj = e;
          }
          if (!threw) {
            throw new assert.AssertionError({ message: 'Expected promise to reject, but it resolved' });
          }
          if (expectedMsg) {
            const msg = errObj && errObj.message ? errObj.message : String(errObj);
            const matches = typeof expectedMsg === 'string' ? msg.includes(expectedMsg) : expectedMsg.test(msg);
            if (!matches) {
              throw new assert.AssertionError({ message: `Expected rejection message '${msg}' to match '${expectedMsg}'` });
            }
          }
        },
      };
    },
  };
}

function expect(actual) {
  return createExpect(actual, false);
}

const vi = {
  fn(impl) {
    const calls = [];
    const mockFn = (...args) => {
      calls.push(args);
      return impl ? impl(...args) : undefined;
    };
    mockFn.mock = { calls };
    return mockFn;
  },
  spyOn(obj, method) {
    const orig = obj[method];
    const calls = [];
    obj[method] = function (...args) {
      calls.push(args);
      return orig.apply(this, args);
    };
    obj[method].mockRestore = () => {
      obj[method] = orig;
    };
    return obj[method];
  },
};

function resetHarness() {
  suites.length = 0;
  currentSuite = { name: 'root', tests: [], beforeEachFns: [], afterEachFns: [] };
  suites.push(currentSuite);
}

function getRegisteredSuites() {
  return suites;
}

module.exports = {
  describe,
  it,
  test,
  expect,
  beforeEach,
  afterEach,
  vi,
  resetHarness,
  getRegisteredSuites,
};
