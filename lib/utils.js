// Session Outliner
// Copyright (C) 2014, Josef Schmeißer
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

"use strict";

// ****************************************************************************

function InvalidOperationError(message) {
  this.name = "InvalidOperationError";
  this.message = message || "Invalid operation for current state.";
}
InvalidOperationError.prototype = new Error();
InvalidOperationError.prototype.constructor = InvalidOperationError;
module.exports.InvalidOperationError = InvalidOperationError;

function FailedAssertionError(message) {
  this.name = "FailedAssertion";
  this.message = message || "Assertion failed.";
}
FailedAssertionError.prototype = new Error();
FailedAssertionError.prototype.constructor = FailedAssertionError;
module.exports.FailedAssertionError = FailedAssertionError;

// ****************************************************************************

function assert(condition, message) {
    if (!condition) {
        console.error("Failed assertion: " + message);
        console.trace();

        throw new FailedAssertionError(message);
    }
}
module.exports.assert = assert;

function printException(e) {
    if (e instanceof FailedAssertionError) {
        console.error("Caught FailedAssertionError.");
    } else {
        console.error("Message: " +
                      e.name + ": " + e.message + "\n" +
                      "Stack:" + e.stack);
    }
}

function handleException(e) {
    printException(e);
}
module.exports.handleException = handleException;

function clone(obj) {
    // trivial case
    if (obj == null || typeof obj != "object") {
        return obj;
    } else if (Array.isArray(obj)) {
        let copy = [ ];

        for (let i = 0, len = obj.length; i < len; ++i) {
            copy.push(clone(obj[i]));
        }

        return copy;
    } else {
        let copy = { };

        for (let key in obj) {
            if (obj.hasOwnProperty(key)) {
                copy[key] = clone(obj[key]);
            }
        }

        return copy;
    }
}
module.exports.clone = clone;

function isEmpty(obj) {
    for (let key in obj) {
        return false;
    }

    return true;
}
module.exports.isEmpty = isEmpty;

function printArgs(args) {
   let argsArray = Array.slice(args);

   argsArray.forEach(function(value, i) {
       console.log("value[" + i + "]:", value);
   });
}
module.exports.printArgs = printArgs;
