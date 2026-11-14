import assert from "node:assert/strict";
import * as real from "node:crypto";
import { receiverToken } from "./token.js";

const valid = /^[a-f0-9]{32}$/;
assert.match(receiverToken(real), valid);
assert.notEqual(receiverToken(real), receiverToken(real));
// Herdr shim: randomBytes(...).toString("hex") is empty and randomUUID throws.
const shim = { randomBytes: () => ({ toString: () => "" }), randomUUID() { throw new Error("no"); }, webcrypto: real.webcrypto };
assert.match(receiverToken(shim), valid);
// Everything but Math.random broken.
assert.match(receiverToken({ randomBytes: () => ({ toString: () => "" }), randomUUID: () => "", webcrypto: {} }), valid);
// Short or non-hex results are rejected, not passed through.
assert.match(receiverToken({ randomUUID: () => "zz", randomBytes: () => ({ toString: () => "abc" }), webcrypto: real.webcrypto }), valid);
console.log("token.check ok");
