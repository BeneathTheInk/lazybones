/* Lazybones / (c) 2014 Beneath the Ink, Inc. / MIT License / Version 0.3.0 */
(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.Lazybones = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/* # Lazybones */

var merge = require("plain-merge"),
	Promise = require("pouchdb/extras/promise"),
	PouchError = require("pouchdb/lib/deps/errors");

function noop(){}

/* ## PouchDB Plugin
 *
 * This is the PouchDB plugin method that attaches a `lazybones()` method to newly created PouchDB instances. The `lazybones()` will create a sync method (with options) that is tied directly to the database it was called on.
 *
 * ```js
 * PouchDB.plugin(Lazybones());
 * var db = new PouchDB("mydb");
 * db.lazybones(); // returns a sync function
 * ```
 */
var Lazybones = module.exports = function(gdef) {
	return { lazybones: function(defaults) {
		var db = this;
		return function(method, model, options) {
			options = merge.defaults({}, options, defaults, gdef, { database: db });
			return Lazybones.sync.call(this, method, model, options);
		}
	} };
}

var methodMap = {
	create: "post",
	update: "put",
	patch: "put",
	delete: "remove"
};

/* ## Options & Defaults
 *
 * These are the default options used by Lazybones. Modify this variable to change the default options globally.
 */
Lazybones.defaults = {
	success: noop,
	error: noop,

	/* #### options.changes
	 *
	 * This property determines if sync uses the changes feed when fetching data. This forces sync into an alternate mode that avoids Backbone's `success` and `error` callbacks and updates the
	 */
	changes: false,

	/* #### options.query
	 *
	 * This property can be a map function or the id of a view. This is what gets passed as the first argument to `db.query()`.
	 */
	query: null,

	/* #### options.rowKey
	 *
	 * The key to extract from view rows on query fetches.
	 */
	rowKey: "doc",

	/* #### options.options
	 *
	 * These are specific options for each PouchDB method.
	 */
	options: {
		get: {},
		query: { include_docs: true, returnDocs: false },
		allDocs: { include_docs: true },
		changes: { returnDocs: false }
	},

	/* #### options.fetch()
	 *
	 * This method controls how the sync function will fetch data. The method currently handles normal gets and queries.
	 */
	fetch: function(model, db, options) {
		// a single model
		if (!isCollection(model)) return db.get(model.id, options.options.get);

		// process query requests
		if (options.query) return db.query(options.query, options.options.query);

		// regular collection fetch
		return db.allDocs(options.options.allDocs);
	},

	/* #### options.process()
	 *
	 * This method parses the result from PouchDB before sending it to Backbone.
	 */
	process: function(res, method, model, options) {
		// parse non-document responses
		if (res._id == null && res._rev == null) {
			// write result
			if (method !== "read") return { _id: res.id, _rev: res.rev };

			// view result
			if (res.rows != null) {
				if (isCollection(model)) return res.rows.map(function(row) {
					return row[options.rowKey];
				});

				// grab just the first row for models
				return res.rows.length ? res.rows[0][options.rowKey] : null;
			}
		}

		return res;
	}
};

/* ## Sync
 *
 * This is the heart of Lazybones. Use it wherever `Backbone.sync` is used.
 */
Lazybones.sync = function(method, model, options) {
	var self, dbMethod, db, onChange, promise, chgopts, processed, processPromise;

	// resolve method and database
	self = this;
	options = merge.defaults({}, options, getSyncOptions(model), Lazybones.defaults);
	method = method.toLowerCase().trim();
	db = getDatabase(options) || getDatabase(model);
	if (db == null) throw new Error("Missing PouchDB database.");

	// deal with writes
	if (method !== "read") {
		promise = db[methodMap[method]](model.toJSON(), options.options[methodMap[method]]);
	}

	// deal with normal reads
	else if (!options.changes) {
		promise = options.fetch.call(self, model, db, options);
		if (promise == null || typeof promise.then !== "function") {
			promise = Promise.resolve(promise);
		}
	}

	// deal with changes feed reads
	else {
		promise = db.changes(merge.defaults({
			include_docs: true
		}, options.changes, options.options.changes));

		onChange = function(row) {
			model.set(row.doc, merge.extend({ remove: false }, options));
		}

		promise.on("create", onChange);
		promise.on("update", onChange);

		promise.on("delete", function(row) {
			var m = !isCollection(model) ? model : model.remove(row.id, options);
			if (m) m.set(row.doc, options);
		});

		// return the changes object immediately
		return promise;
	}

	// create a promise so sync promise waits for backbone to write to model
	processPromise = new Promise(function(resolve, reject) {
		var success = options.success,
			error = options.error;

		options.success = function() {
			success.apply(this, arguments);
			resolve();
		};

		options.error = function(err) {
			error.apply(this, arguments);
			reject(err);
		};
	});

	// process the result into something that backbone can use
	// and ship result to success and error callbacks
	promise.then(function(res) {
		return options.process.call(self, res, method, model, options);
	}).then(options.success, options.error);

	// trigger the request event
	model.trigger('request', model, db, options);

	// return the original promise with the original result
	return Promise.all([ promise, processPromise ])
	.then(function(res) { return res[0]; });
}

var isCollection =
Lazybones.isCollection = function(v) {
	return v != null &&
		Array.isArray(v.models) &&
		typeof v.model === "function" &&
		typeof v.add === "function" &&
		typeof v.remove === "function";
}

Lazybones.isModel = function(val) {
	return val != null &&
		typeof val.cid === "string" &&
		typeof val.attributes === "object" &&
		typeof val.get === "function" &&
		typeof val.set === "function";
}

function getSyncOptions(m) {
	return m && (lookup(m, ["syncOptions","sync_options"]) || getSyncOptions(m.collection));
}

function getDatabase(m) {
	return m && (lookup(m, ["pouch","pouchdb","db","database"]) || getDatabase(m.collection));
}

function lookup(o, keys) {
	var v, i;
	for (i in keys) {
		v = o[keys[i]];
		if (typeof v === "function") {
			return v.call(o, Array.prototype.slice.call(arguments, 2));
		}
		if (typeof v !== "undefined") return v;
	}
}

},{"plain-merge":3,"pouchdb/extras/promise":6,"pouchdb/lib/deps/errors":7}],2:[function(require,module,exports){

},{}],3:[function(require,module,exports){
var isObject = require("is-plain-object");
var hasOwn = Object.prototype.hasOwnProperty;
var slice = Array.prototype.slice;

var merge = module.exports = function(obj, val, safe) {
	if (isObject(obj) && isObject(val)) {
		for (var k in val) {
			if (hasOwn.call(val, k)) obj[k] = merge(obj[k], val[k], safe);
		}

		return obj;
	}

	return safe && typeof obj !== "undefined" ? obj : val;
}

// keeping it DRY
function mergeAll(safe, obj) {
	var args = slice.call(arguments, 2);
	for (var i = 0; i < args.length; i++) {
		obj = merge(obj, args[i], safe);
	}
	return obj;
}

merge.extend = mergeAll.bind(null, false);
merge.defaults = mergeAll.bind(null, true);

},{"is-plain-object":4}],4:[function(require,module,exports){
/*!
 * is-plain-object <https://github.com/jonschlinkert/is-plain-object>
 *
 * Copyright (c) 2014-2015, Jon Schlinkert.
 * Licensed under the MIT License.
 */

'use strict';

var isObject = require('isobject');

function isObjectObject(o) {
  return isObject(o) === true
    && Object.prototype.toString.call(o) === '[object Object]';
}

module.exports = function isPlainObject(o) {
  var ctor,prot;
  
  if (isObjectObject(o) === false) return false;
  
  // If has modified constructor
  ctor = o.constructor;
  if (typeof ctor !== 'function') return false;
  
  // If has modified prototype
  prot = ctor.prototype;
  if (isObjectObject(prot) === false) return false;
  
  // If constructor does not have an Object-specific method
  if (prot.hasOwnProperty('isPrototypeOf') === false) {
    return false;
  }
  
  // Most likely a plain Object
  return true;
};

},{"isobject":5}],5:[function(require,module,exports){
/*!
 * isobject <https://github.com/jonschlinkert/isobject>
 *
 * Copyright (c) 2014-2015, Jon Schlinkert.
 * Licensed under the MIT License.
 */

'use strict';

module.exports = function isObject(o) {
  return o != null && typeof o === 'object'
    && !Array.isArray(o);
};
},{}],6:[function(require,module,exports){
'use strict';

// allow external plugins to require('pouchdb/extras/promise')
module.exports = require('../lib/deps/promise');
},{"../lib/deps/promise":8}],7:[function(require,module,exports){
"use strict";

var inherits = require('inherits');
inherits(PouchError, Error);

function PouchError(opts) {
  Error.call(opts.reason);
  this.status = opts.status;
  this.name = opts.error;
  this.message = opts.reason;
  this.error = true;
}

PouchError.prototype.toString = function () {
  return JSON.stringify({
    status: this.status,
    name: this.name,
    message: this.message
  });
};

exports.UNAUTHORIZED = new PouchError({
  status: 401,
  error: 'unauthorized',
  reason: "Name or password is incorrect."
});

exports.MISSING_BULK_DOCS = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: "Missing JSON list of 'docs'"
});

exports.MISSING_DOC = new PouchError({
  status: 404,
  error: 'not_found',
  reason: 'missing'
});

exports.REV_CONFLICT = new PouchError({
  status: 409,
  error: 'conflict',
  reason: 'Document update conflict'
});

exports.INVALID_ID = new PouchError({
  status: 400,
  error: 'invalid_id',
  reason: '_id field must contain a string'
});

exports.MISSING_ID = new PouchError({
  status: 412,
  error: 'missing_id',
  reason: '_id is required for puts'
});

exports.RESERVED_ID = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Only reserved document ids may start with underscore.'
});

exports.NOT_OPEN = new PouchError({
  status: 412,
  error: 'precondition_failed',
  reason: 'Database not open'
});

exports.UNKNOWN_ERROR = new PouchError({
  status: 500,
  error: 'unknown_error',
  reason: 'Database encountered an unknown error'
});

exports.BAD_ARG = new PouchError({
  status: 500,
  error: 'badarg',
  reason: 'Some query argument is invalid'
});

exports.INVALID_REQUEST = new PouchError({
  status: 400,
  error: 'invalid_request',
  reason: 'Request was invalid'
});

exports.QUERY_PARSE_ERROR = new PouchError({
  status: 400,
  error: 'query_parse_error',
  reason: 'Some query parameter is invalid'
});

exports.DOC_VALIDATION = new PouchError({
  status: 500,
  error: 'doc_validation',
  reason: 'Bad special document member'
});

exports.BAD_REQUEST = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Something wrong with the request'
});

exports.NOT_AN_OBJECT = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Document must be a JSON object'
});

exports.DB_MISSING = new PouchError({
  status: 404,
  error: 'not_found',
  reason: 'Database not found'
});

exports.IDB_ERROR = new PouchError({
  status: 500,
  error: 'indexed_db_went_bad',
  reason: 'unknown'
});

exports.WSQ_ERROR = new PouchError({
  status: 500,
  error: 'web_sql_went_bad',
  reason: 'unknown'
});

exports.LDB_ERROR = new PouchError({
  status: 500,
  error: 'levelDB_went_went_bad',
  reason: 'unknown'
});

exports.FORBIDDEN = new PouchError({
  status: 403,
  error: 'forbidden',
  reason: 'Forbidden by design doc validate_doc_update function'
});

exports.INVALID_REV = new PouchError({
  status: 400,
  error: 'bad_request',
  reason: 'Invalid rev format'
});

exports.FILE_EXISTS = new PouchError({
  status: 412,
  error: 'file_exists',
  reason: 'The database could not be created, the file already exists.'
});

exports.MISSING_STUB = new PouchError({
  status: 412,
  error: 'missing_stub'
});

exports.error = function (error, reason, name) {
  function CustomPouchError(reason) {
    // inherit error properties from our parent error manually
    // so as to allow proper JSON parsing.
    /* jshint ignore:start */
    for (var p in error) {
      if (typeof error[p] !== 'function') {
        this[p] = error[p];
      }
    }
    /* jshint ignore:end */
    if (name !== undefined) {
      this.name = name;
    }
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
  CustomPouchError.prototype = PouchError.prototype;
  return new CustomPouchError(reason);
};

// Find one of the errors defined above based on the value
// of the specified property.
// If reason is provided prefer the error matching that reason.
// This is for differentiating between errors with the same name and status,
// eg, bad_request.
exports.getErrorTypeByProp = function (prop, value, reason) {
  var errors = exports;
  var keys = Object.keys(errors).filter(function (key) {
    var error = errors[key];
    return typeof error !== 'function' && error[prop] === value;
  });
  var key = reason && keys.filter(function (key) {
        var error = errors[key];
        return error.message === reason;
      })[0] || keys[0];
  return (key) ? errors[key] : null;
};

exports.generateErrorFromResponse = function (res) {
  var error, errName, errType, errMsg, errReason;
  var errors = exports;

  errName = (res.error === true && typeof res.name === 'string') ?
              res.name :
              res.error;
  errReason = res.reason;
  errType = errors.getErrorTypeByProp('name', errName, errReason);

  if (res.missing ||
      errReason === 'missing' ||
      errReason === 'deleted' ||
      errName === 'not_found') {
    errType = errors.MISSING_DOC;
  } else if (errName === 'doc_validation') {
    // doc validation needs special treatment since
    // res.reason depends on the validation error.
    // see utils.js
    errType = errors.DOC_VALIDATION;
    errMsg = errReason;
  } else if (errName === 'bad_request' && errType.message !== errReason) {
    // if bad_request error already found based on reason don't override.

    // attachment errors.
    if (errReason.indexOf('unknown stub attachment') === 0) {
      errType = errors.MISSING_STUB;
      errMsg = errReason;
    } else {
      errType = errors.BAD_REQUEST;
    }
  }

  // fallback to error by statys or unknown error.
  if (!errType) {
    errType = errors.getErrorTypeByProp('status', res.status, errReason) ||
                errors.UNKNOWN_ERROR;
  }

  error = errors.error(errType, errReason, errName);

  // Keep custom message.
  if (errMsg) {
    error.message = errMsg;
  }

  // Keep helpful response data in our error messages.
  if (res.id) {
    error.id = res.id;
  }
  if (res.status) {
    error.status = res.status;
  }
  if (res.statusText) {
    error.name = res.statusText;
  }
  if (res.missing) {
    error.missing = res.missing;
  }

  return error;
};

},{"inherits":9}],8:[function(require,module,exports){
'use strict';

if (typeof Promise === 'function') {
  module.exports = Promise;
} else {
  module.exports = require('bluebird');
}
},{"bluebird":13}],9:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],10:[function(require,module,exports){
'use strict';

module.exports = INTERNAL;

function INTERNAL() {}
},{}],11:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = all;
function all(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var values = new Array(len);
  var resolved = 0;
  var i = -1;
  var promise = new Promise(INTERNAL);
  
  while (++i < len) {
    allResolver(iterable[i], i);
  }
  return promise;
  function allResolver(value, i) {
    resolve(value).then(resolveFromAll, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
    function resolveFromAll(outValue) {
      values[i] = outValue;
      if (++resolved === len & !called) {
        called = true;
        handlers.resolve(promise, values);
      }
    }
  }
}
},{"./INTERNAL":10,"./handlers":12,"./promise":14,"./reject":17,"./resolve":18}],12:[function(require,module,exports){
'use strict';
var tryCatch = require('./tryCatch');
var resolveThenable = require('./resolveThenable');
var states = require('./states');

exports.resolve = function (self, value) {
  var result = tryCatch(getThen, value);
  if (result.status === 'error') {
    return exports.reject(self, result.value);
  }
  var thenable = result.value;

  if (thenable) {
    resolveThenable.safely(self, thenable);
  } else {
    self.state = states.FULFILLED;
    self.outcome = value;
    var i = -1;
    var len = self.queue.length;
    while (++i < len) {
      self.queue[i].callFulfilled(value);
    }
  }
  return self;
};
exports.reject = function (self, error) {
  self.state = states.REJECTED;
  self.outcome = error;
  var i = -1;
  var len = self.queue.length;
  while (++i < len) {
    self.queue[i].callRejected(error);
  }
  return self;
};

function getThen(obj) {
  // Make sure we only access the accessor once as required by the spec
  var then = obj && obj.then;
  if (obj && typeof obj === 'object' && typeof then === 'function') {
    return function appyThen() {
      then.apply(obj, arguments);
    };
  }
}

},{"./resolveThenable":19,"./states":20,"./tryCatch":21}],13:[function(require,module,exports){
module.exports = exports = require('./promise');

exports.resolve = require('./resolve');
exports.reject = require('./reject');
exports.all = require('./all');
exports.race = require('./race');

},{"./all":11,"./promise":14,"./race":16,"./reject":17,"./resolve":18}],14:[function(require,module,exports){
'use strict';

var unwrap = require('./unwrap');
var INTERNAL = require('./INTERNAL');
var resolveThenable = require('./resolveThenable');
var states = require('./states');
var QueueItem = require('./queueItem');

module.exports = Promise;
function Promise(resolver) {
  if (!(this instanceof Promise)) {
    return new Promise(resolver);
  }
  if (typeof resolver !== 'function') {
    throw new TypeError('resolver must be a function');
  }
  this.state = states.PENDING;
  this.queue = [];
  this.outcome = void 0;
  if (resolver !== INTERNAL) {
    resolveThenable.safely(this, resolver);
  }
}

Promise.prototype['catch'] = function (onRejected) {
  return this.then(null, onRejected);
};
Promise.prototype.then = function (onFulfilled, onRejected) {
  if (typeof onFulfilled !== 'function' && this.state === states.FULFILLED ||
    typeof onRejected !== 'function' && this.state === states.REJECTED) {
    return this;
  }
  var promise = new Promise(INTERNAL);
  if (this.state !== states.PENDING) {
    var resolver = this.state === states.FULFILLED ? onFulfilled : onRejected;
    unwrap(promise, resolver, this.outcome);
  } else {
    this.queue.push(new QueueItem(promise, onFulfilled, onRejected));
  }

  return promise;
};

},{"./INTERNAL":10,"./queueItem":15,"./resolveThenable":19,"./states":20,"./unwrap":22}],15:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var unwrap = require('./unwrap');

module.exports = QueueItem;
function QueueItem(promise, onFulfilled, onRejected) {
  this.promise = promise;
  if (typeof onFulfilled === 'function') {
    this.onFulfilled = onFulfilled;
    this.callFulfilled = this.otherCallFulfilled;
  }
  if (typeof onRejected === 'function') {
    this.onRejected = onRejected;
    this.callRejected = this.otherCallRejected;
  }
}
QueueItem.prototype.callFulfilled = function (value) {
  handlers.resolve(this.promise, value);
};
QueueItem.prototype.otherCallFulfilled = function (value) {
  unwrap(this.promise, this.onFulfilled, value);
};
QueueItem.prototype.callRejected = function (value) {
  handlers.reject(this.promise, value);
};
QueueItem.prototype.otherCallRejected = function (value) {
  unwrap(this.promise, this.onRejected, value);
};

},{"./handlers":12,"./unwrap":22}],16:[function(require,module,exports){
'use strict';
var Promise = require('./promise');
var reject = require('./reject');
var resolve = require('./resolve');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = race;
function race(iterable) {
  if (Object.prototype.toString.call(iterable) !== '[object Array]') {
    return reject(new TypeError('must be an array'));
  }

  var len = iterable.length;
  var called = false;
  if (!len) {
    return resolve([]);
  }

  var i = -1;
  var promise = new Promise(INTERNAL);

  while (++i < len) {
    resolver(iterable[i]);
  }
  return promise;
  function resolver(value) {
    resolve(value).then(function (response) {
      if (!called) {
        called = true;
        handlers.resolve(promise, response);
      }
    }, function (error) {
      if (!called) {
        called = true;
        handlers.reject(promise, error);
      }
    });
  }
}

},{"./INTERNAL":10,"./handlers":12,"./promise":14,"./reject":17,"./resolve":18}],17:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = reject;

function reject(reason) {
	var promise = new Promise(INTERNAL);
	return handlers.reject(promise, reason);
}
},{"./INTERNAL":10,"./handlers":12,"./promise":14}],18:[function(require,module,exports){
'use strict';

var Promise = require('./promise');
var INTERNAL = require('./INTERNAL');
var handlers = require('./handlers');
module.exports = resolve;

var FALSE = handlers.resolve(new Promise(INTERNAL), false);
var NULL = handlers.resolve(new Promise(INTERNAL), null);
var UNDEFINED = handlers.resolve(new Promise(INTERNAL), void 0);
var ZERO = handlers.resolve(new Promise(INTERNAL), 0);
var EMPTYSTRING = handlers.resolve(new Promise(INTERNAL), '');

function resolve(value) {
  if (value) {
    if (value instanceof Promise) {
      return value;
    }
    return handlers.resolve(new Promise(INTERNAL), value);
  }
  var valueType = typeof value;
  switch (valueType) {
    case 'boolean':
      return FALSE;
    case 'undefined':
      return UNDEFINED;
    case 'object':
      return NULL;
    case 'number':
      return ZERO;
    case 'string':
      return EMPTYSTRING;
  }
}
},{"./INTERNAL":10,"./handlers":12,"./promise":14}],19:[function(require,module,exports){
'use strict';
var handlers = require('./handlers');
var tryCatch = require('./tryCatch');
function safelyResolveThenable(self, thenable) {
  // Either fulfill, reject or reject with error
  var called = false;
  function onError(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.reject(self, value);
  }

  function onSuccess(value) {
    if (called) {
      return;
    }
    called = true;
    handlers.resolve(self, value);
  }

  function tryToUnwrap() {
    thenable(onSuccess, onError);
  }
  
  var result = tryCatch(tryToUnwrap);
  if (result.status === 'error') {
    onError(result.value);
  }
}
exports.safely = safelyResolveThenable;
},{"./handlers":12,"./tryCatch":21}],20:[function(require,module,exports){
// Lazy man's symbols for states

exports.REJECTED = ['REJECTED'];
exports.FULFILLED = ['FULFILLED'];
exports.PENDING = ['PENDING'];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = tryCatch;

function tryCatch(func, value) {
  var out = {};
  try {
    out.value = func(value);
    out.status = 'success';
  } catch (e) {
    out.status = 'error';
    out.value = e;
  }
  return out;
}
},{}],22:[function(require,module,exports){
'use strict';

var immediate = require('immediate');
var handlers = require('./handlers');
module.exports = unwrap;

function unwrap(promise, func, value) {
  immediate(function () {
    var returnValue;
    try {
      returnValue = func(value);
    } catch (e) {
      return handlers.reject(promise, e);
    }
    if (returnValue === promise) {
      handlers.reject(promise, new TypeError('Cannot resolve promise with itself'));
    } else {
      handlers.resolve(promise, returnValue);
    }
  });
}
},{"./handlers":12,"immediate":23}],23:[function(require,module,exports){
'use strict';
var types = [
  require('./nextTick'),
  require('./mutation.js'),
  require('./messageChannel'),
  require('./stateChange'),
  require('./timeout')
];
var draining;
var queue = [];
//named nextTick for less confusing stack traces
function nextTick() {
  draining = true;
  var i, oldQueue;
  var len = queue.length;
  while (len) {
    oldQueue = queue;
    queue = [];
    i = -1;
    while (++i < len) {
      oldQueue[i]();
    }
    len = queue.length;
  }
  draining = false;
}
var scheduleDrain;
var i = -1;
var len = types.length;
while (++ i < len) {
  if (types[i] && types[i].test && types[i].test()) {
    scheduleDrain = types[i].install(nextTick);
    break;
  }
}
module.exports = immediate;
function immediate(task) {
  if (queue.push(task) === 1 && !draining) {
    scheduleDrain();
  }
}
},{"./messageChannel":24,"./mutation.js":25,"./nextTick":2,"./stateChange":26,"./timeout":27}],24:[function(require,module,exports){
(function (global){
'use strict';

exports.test = function () {
  if (global.setImmediate) {
    // we can only get here in IE10
    // which doesn't handel postMessage well
    return false;
  }
  return typeof global.MessageChannel !== 'undefined';
};

exports.install = function (func) {
  var channel = new global.MessageChannel();
  channel.port1.onmessage = func;
  return function () {
    channel.port2.postMessage(0);
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],25:[function(require,module,exports){
(function (global){
'use strict';
//based off rsvp https://github.com/tildeio/rsvp.js
//license https://github.com/tildeio/rsvp.js/blob/master/LICENSE
//https://github.com/tildeio/rsvp.js/blob/master/lib/rsvp/asap.js

var Mutation = global.MutationObserver || global.WebKitMutationObserver;

exports.test = function () {
  return Mutation;
};

exports.install = function (handle) {
  var called = 0;
  var observer = new Mutation(handle);
  var element = global.document.createTextNode('');
  observer.observe(element, {
    characterData: true
  });
  return function () {
    element.data = (called = ++called % 2);
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],26:[function(require,module,exports){
(function (global){
'use strict';

exports.test = function () {
  return 'document' in global && 'onreadystatechange' in global.document.createElement('script');
};

exports.install = function (handle) {
  return function () {

    // Create a <script> element; its readystatechange event will be fired asynchronously once it is inserted
    // into the document. Do so, thus queuing up the task. Remember to clean up once it's been called.
    var scriptEl = global.document.createElement('script');
    scriptEl.onreadystatechange = function () {
      handle();

      scriptEl.onreadystatechange = null;
      scriptEl.parentNode.removeChild(scriptEl);
      scriptEl = null;
    };
    global.document.documentElement.appendChild(scriptEl);

    return handle;
  };
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],27:[function(require,module,exports){
'use strict';
exports.test = function () {
  return true;
};

exports.install = function (t) {
  return function () {
    setTimeout(t, 0);
  };
};
},{}]},{},[1])(1)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvbGF6eWJvbmVzLmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVzb2x2ZS9lbXB0eS5qcyIsIm5vZGVfbW9kdWxlcy9wbGFpbi1tZXJnZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wbGFpbi1tZXJnZS9ub2RlX21vZHVsZXMvaXMtcGxhaW4tb2JqZWN0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BsYWluLW1lcmdlL25vZGVfbW9kdWxlcy9pcy1wbGFpbi1vYmplY3Qvbm9kZV9tb2R1bGVzL2lzb2JqZWN0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvZXh0cmFzL3Byb21pc2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9lcnJvcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wcm9taXNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9JTlRFUk5BTC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL2FsbC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL2hhbmRsZXJzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9wcm9taXNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcXVldWVJdGVtLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmFjZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3JlamVjdC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Jlc29sdmUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9yZXNvbHZlVGhlbmFibGUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9zdGF0ZXMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi90cnlDYXRjaC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Vud3JhcC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL21lc3NhZ2VDaGFubmVsLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9tdXRhdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvc3RhdGVDaGFuZ2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL3RpbWVvdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xPQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qICMgTGF6eWJvbmVzICovXG5cbnZhciBtZXJnZSA9IHJlcXVpcmUoXCJwbGFpbi1tZXJnZVwiKSxcblx0UHJvbWlzZSA9IHJlcXVpcmUoXCJwb3VjaGRiL2V4dHJhcy9wcm9taXNlXCIpLFxuXHRQb3VjaEVycm9yID0gcmVxdWlyZShcInBvdWNoZGIvbGliL2RlcHMvZXJyb3JzXCIpO1xuXG5mdW5jdGlvbiBub29wKCl7fVxuXG4vKiAjIyBQb3VjaERCIFBsdWdpblxuICpcbiAqIFRoaXMgaXMgdGhlIFBvdWNoREIgcGx1Z2luIG1ldGhvZCB0aGF0IGF0dGFjaGVzIGEgYGxhenlib25lcygpYCBtZXRob2QgdG8gbmV3bHkgY3JlYXRlZCBQb3VjaERCIGluc3RhbmNlcy4gVGhlIGBsYXp5Ym9uZXMoKWAgd2lsbCBjcmVhdGUgYSBzeW5jIG1ldGhvZCAod2l0aCBvcHRpb25zKSB0aGF0IGlzIHRpZWQgZGlyZWN0bHkgdG8gdGhlIGRhdGFiYXNlIGl0IHdhcyBjYWxsZWQgb24uXG4gKlxuICogYGBganNcbiAqIFBvdWNoREIucGx1Z2luKExhenlib25lcygpKTtcbiAqIHZhciBkYiA9IG5ldyBQb3VjaERCKFwibXlkYlwiKTtcbiAqIGRiLmxhenlib25lcygpOyAvLyByZXR1cm5zIGEgc3luYyBmdW5jdGlvblxuICogYGBgXG4gKi9cbnZhciBMYXp5Ym9uZXMgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdkZWYpIHtcblx0cmV0dXJuIHsgbGF6eWJvbmVzOiBmdW5jdGlvbihkZWZhdWx0cykge1xuXHRcdHZhciBkYiA9IHRoaXM7XG5cdFx0cmV0dXJuIGZ1bmN0aW9uKG1ldGhvZCwgbW9kZWwsIG9wdGlvbnMpIHtcblx0XHRcdG9wdGlvbnMgPSBtZXJnZS5kZWZhdWx0cyh7fSwgb3B0aW9ucywgZGVmYXVsdHMsIGdkZWYsIHsgZGF0YWJhc2U6IGRiIH0pO1xuXHRcdFx0cmV0dXJuIExhenlib25lcy5zeW5jLmNhbGwodGhpcywgbWV0aG9kLCBtb2RlbCwgb3B0aW9ucyk7XG5cdFx0fVxuXHR9IH07XG59XG5cbnZhciBtZXRob2RNYXAgPSB7XG5cdGNyZWF0ZTogXCJwb3N0XCIsXG5cdHVwZGF0ZTogXCJwdXRcIixcblx0cGF0Y2g6IFwicHV0XCIsXG5cdGRlbGV0ZTogXCJyZW1vdmVcIlxufTtcblxuLyogIyMgT3B0aW9ucyAmIERlZmF1bHRzXG4gKlxuICogVGhlc2UgYXJlIHRoZSBkZWZhdWx0IG9wdGlvbnMgdXNlZCBieSBMYXp5Ym9uZXMuIE1vZGlmeSB0aGlzIHZhcmlhYmxlIHRvIGNoYW5nZSB0aGUgZGVmYXVsdCBvcHRpb25zIGdsb2JhbGx5LlxuICovXG5MYXp5Ym9uZXMuZGVmYXVsdHMgPSB7XG5cdHN1Y2Nlc3M6IG5vb3AsXG5cdGVycm9yOiBub29wLFxuXG5cdC8qICMjIyMgb3B0aW9ucy5jaGFuZ2VzXG5cdCAqXG5cdCAqIFRoaXMgcHJvcGVydHkgZGV0ZXJtaW5lcyBpZiBzeW5jIHVzZXMgdGhlIGNoYW5nZXMgZmVlZCB3aGVuIGZldGNoaW5nIGRhdGEuIFRoaXMgZm9yY2VzIHN5bmMgaW50byBhbiBhbHRlcm5hdGUgbW9kZSB0aGF0IGF2b2lkcyBCYWNrYm9uZSdzIGBzdWNjZXNzYCBhbmQgYGVycm9yYCBjYWxsYmFja3MgYW5kIHVwZGF0ZXMgdGhlXG5cdCAqL1xuXHRjaGFuZ2VzOiBmYWxzZSxcblxuXHQvKiAjIyMjIG9wdGlvbnMucXVlcnlcblx0ICpcblx0ICogVGhpcyBwcm9wZXJ0eSBjYW4gYmUgYSBtYXAgZnVuY3Rpb24gb3IgdGhlIGlkIG9mIGEgdmlldy4gVGhpcyBpcyB3aGF0IGdldHMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byBgZGIucXVlcnkoKWAuXG5cdCAqL1xuXHRxdWVyeTogbnVsbCxcblxuXHQvKiAjIyMjIG9wdGlvbnMucm93S2V5XG5cdCAqXG5cdCAqIFRoZSBrZXkgdG8gZXh0cmFjdCBmcm9tIHZpZXcgcm93cyBvbiBxdWVyeSBmZXRjaGVzLlxuXHQgKi9cblx0cm93S2V5OiBcImRvY1wiLFxuXG5cdC8qICMjIyMgb3B0aW9ucy5vcHRpb25zXG5cdCAqXG5cdCAqIFRoZXNlIGFyZSBzcGVjaWZpYyBvcHRpb25zIGZvciBlYWNoIFBvdWNoREIgbWV0aG9kLlxuXHQgKi9cblx0b3B0aW9uczoge1xuXHRcdGdldDoge30sXG5cdFx0cXVlcnk6IHsgaW5jbHVkZV9kb2NzOiB0cnVlLCByZXR1cm5Eb2NzOiBmYWxzZSB9LFxuXHRcdGFsbERvY3M6IHsgaW5jbHVkZV9kb2NzOiB0cnVlIH0sXG5cdFx0Y2hhbmdlczogeyByZXR1cm5Eb2NzOiBmYWxzZSB9XG5cdH0sXG5cblx0LyogIyMjIyBvcHRpb25zLmZldGNoKClcblx0ICpcblx0ICogVGhpcyBtZXRob2QgY29udHJvbHMgaG93IHRoZSBzeW5jIGZ1bmN0aW9uIHdpbGwgZmV0Y2ggZGF0YS4gVGhlIG1ldGhvZCBjdXJyZW50bHkgaGFuZGxlcyBub3JtYWwgZ2V0cyBhbmQgcXVlcmllcy5cblx0ICovXG5cdGZldGNoOiBmdW5jdGlvbihtb2RlbCwgZGIsIG9wdGlvbnMpIHtcblx0XHQvLyBhIHNpbmdsZSBtb2RlbFxuXHRcdGlmICghaXNDb2xsZWN0aW9uKG1vZGVsKSkgcmV0dXJuIGRiLmdldChtb2RlbC5pZCwgb3B0aW9ucy5vcHRpb25zLmdldCk7XG5cblx0XHQvLyBwcm9jZXNzIHF1ZXJ5IHJlcXVlc3RzXG5cdFx0aWYgKG9wdGlvbnMucXVlcnkpIHJldHVybiBkYi5xdWVyeShvcHRpb25zLnF1ZXJ5LCBvcHRpb25zLm9wdGlvbnMucXVlcnkpO1xuXG5cdFx0Ly8gcmVndWxhciBjb2xsZWN0aW9uIGZldGNoXG5cdFx0cmV0dXJuIGRiLmFsbERvY3Mob3B0aW9ucy5vcHRpb25zLmFsbERvY3MpO1xuXHR9LFxuXG5cdC8qICMjIyMgb3B0aW9ucy5wcm9jZXNzKClcblx0ICpcblx0ICogVGhpcyBtZXRob2QgcGFyc2VzIHRoZSByZXN1bHQgZnJvbSBQb3VjaERCIGJlZm9yZSBzZW5kaW5nIGl0IHRvIEJhY2tib25lLlxuXHQgKi9cblx0cHJvY2VzczogZnVuY3Rpb24ocmVzLCBtZXRob2QsIG1vZGVsLCBvcHRpb25zKSB7XG5cdFx0Ly8gcGFyc2Ugbm9uLWRvY3VtZW50IHJlc3BvbnNlc1xuXHRcdGlmIChyZXMuX2lkID09IG51bGwgJiYgcmVzLl9yZXYgPT0gbnVsbCkge1xuXHRcdFx0Ly8gd3JpdGUgcmVzdWx0XG5cdFx0XHRpZiAobWV0aG9kICE9PSBcInJlYWRcIikgcmV0dXJuIHsgX2lkOiByZXMuaWQsIF9yZXY6IHJlcy5yZXYgfTtcblxuXHRcdFx0Ly8gdmlldyByZXN1bHRcblx0XHRcdGlmIChyZXMucm93cyAhPSBudWxsKSB7XG5cdFx0XHRcdGlmIChpc0NvbGxlY3Rpb24obW9kZWwpKSByZXR1cm4gcmVzLnJvd3MubWFwKGZ1bmN0aW9uKHJvdykge1xuXHRcdFx0XHRcdHJldHVybiByb3dbb3B0aW9ucy5yb3dLZXldO1xuXHRcdFx0XHR9KTtcblxuXHRcdFx0XHQvLyBncmFiIGp1c3QgdGhlIGZpcnN0IHJvdyBmb3IgbW9kZWxzXG5cdFx0XHRcdHJldHVybiByZXMucm93cy5sZW5ndGggPyByZXMucm93c1swXVtvcHRpb25zLnJvd0tleV0gOiBudWxsO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiByZXM7XG5cdH1cbn07XG5cbi8qICMjIFN5bmNcbiAqXG4gKiBUaGlzIGlzIHRoZSBoZWFydCBvZiBMYXp5Ym9uZXMuIFVzZSBpdCB3aGVyZXZlciBgQmFja2JvbmUuc3luY2AgaXMgdXNlZC5cbiAqL1xuTGF6eWJvbmVzLnN5bmMgPSBmdW5jdGlvbihtZXRob2QsIG1vZGVsLCBvcHRpb25zKSB7XG5cdHZhciBzZWxmLCBkYk1ldGhvZCwgZGIsIG9uQ2hhbmdlLCBwcm9taXNlLCBjaGdvcHRzLCBwcm9jZXNzZWQsIHByb2Nlc3NQcm9taXNlO1xuXG5cdC8vIHJlc29sdmUgbWV0aG9kIGFuZCBkYXRhYmFzZVxuXHRzZWxmID0gdGhpcztcblx0b3B0aW9ucyA9IG1lcmdlLmRlZmF1bHRzKHt9LCBvcHRpb25zLCBnZXRTeW5jT3B0aW9ucyhtb2RlbCksIExhenlib25lcy5kZWZhdWx0cyk7XG5cdG1ldGhvZCA9IG1ldGhvZC50b0xvd2VyQ2FzZSgpLnRyaW0oKTtcblx0ZGIgPSBnZXREYXRhYmFzZShvcHRpb25zKSB8fCBnZXREYXRhYmFzZShtb2RlbCk7XG5cdGlmIChkYiA9PSBudWxsKSB0aHJvdyBuZXcgRXJyb3IoXCJNaXNzaW5nIFBvdWNoREIgZGF0YWJhc2UuXCIpO1xuXG5cdC8vIGRlYWwgd2l0aCB3cml0ZXNcblx0aWYgKG1ldGhvZCAhPT0gXCJyZWFkXCIpIHtcblx0XHRwcm9taXNlID0gZGJbbWV0aG9kTWFwW21ldGhvZF1dKG1vZGVsLnRvSlNPTigpLCBvcHRpb25zLm9wdGlvbnNbbWV0aG9kTWFwW21ldGhvZF1dKTtcblx0fVxuXG5cdC8vIGRlYWwgd2l0aCBub3JtYWwgcmVhZHNcblx0ZWxzZSBpZiAoIW9wdGlvbnMuY2hhbmdlcykge1xuXHRcdHByb21pc2UgPSBvcHRpb25zLmZldGNoLmNhbGwoc2VsZiwgbW9kZWwsIGRiLCBvcHRpb25zKTtcblx0XHRpZiAocHJvbWlzZSA9PSBudWxsIHx8IHR5cGVvZiBwcm9taXNlLnRoZW4gIT09IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0cHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShwcm9taXNlKTtcblx0XHR9XG5cdH1cblxuXHQvLyBkZWFsIHdpdGggY2hhbmdlcyBmZWVkIHJlYWRzXG5cdGVsc2Uge1xuXHRcdHByb21pc2UgPSBkYi5jaGFuZ2VzKG1lcmdlLmRlZmF1bHRzKHtcblx0XHRcdGluY2x1ZGVfZG9jczogdHJ1ZVxuXHRcdH0sIG9wdGlvbnMuY2hhbmdlcywgb3B0aW9ucy5vcHRpb25zLmNoYW5nZXMpKTtcblxuXHRcdG9uQ2hhbmdlID0gZnVuY3Rpb24ocm93KSB7XG5cdFx0XHRtb2RlbC5zZXQocm93LmRvYywgbWVyZ2UuZXh0ZW5kKHsgcmVtb3ZlOiBmYWxzZSB9LCBvcHRpb25zKSk7XG5cdFx0fVxuXG5cdFx0cHJvbWlzZS5vbihcImNyZWF0ZVwiLCBvbkNoYW5nZSk7XG5cdFx0cHJvbWlzZS5vbihcInVwZGF0ZVwiLCBvbkNoYW5nZSk7XG5cblx0XHRwcm9taXNlLm9uKFwiZGVsZXRlXCIsIGZ1bmN0aW9uKHJvdykge1xuXHRcdFx0dmFyIG0gPSAhaXNDb2xsZWN0aW9uKG1vZGVsKSA/IG1vZGVsIDogbW9kZWwucmVtb3ZlKHJvdy5pZCwgb3B0aW9ucyk7XG5cdFx0XHRpZiAobSkgbS5zZXQocm93LmRvYywgb3B0aW9ucyk7XG5cdFx0fSk7XG5cblx0XHQvLyByZXR1cm4gdGhlIGNoYW5nZXMgb2JqZWN0IGltbWVkaWF0ZWx5XG5cdFx0cmV0dXJuIHByb21pc2U7XG5cdH1cblxuXHQvLyBjcmVhdGUgYSBwcm9taXNlIHNvIHN5bmMgcHJvbWlzZSB3YWl0cyBmb3IgYmFja2JvbmUgdG8gd3JpdGUgdG8gbW9kZWxcblx0cHJvY2Vzc1Byb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcblx0XHR2YXIgc3VjY2VzcyA9IG9wdGlvbnMuc3VjY2Vzcyxcblx0XHRcdGVycm9yID0gb3B0aW9ucy5lcnJvcjtcblxuXHRcdG9wdGlvbnMuc3VjY2VzcyA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0c3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuXHRcdFx0cmVzb2x2ZSgpO1xuXHRcdH07XG5cblx0XHRvcHRpb25zLmVycm9yID0gZnVuY3Rpb24oZXJyKSB7XG5cdFx0XHRlcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuXHRcdFx0cmVqZWN0KGVycik7XG5cdFx0fTtcblx0fSk7XG5cblx0Ly8gcHJvY2VzcyB0aGUgcmVzdWx0IGludG8gc29tZXRoaW5nIHRoYXQgYmFja2JvbmUgY2FuIHVzZVxuXHQvLyBhbmQgc2hpcCByZXN1bHQgdG8gc3VjY2VzcyBhbmQgZXJyb3IgY2FsbGJhY2tzXG5cdHByb21pc2UudGhlbihmdW5jdGlvbihyZXMpIHtcblx0XHRyZXR1cm4gb3B0aW9ucy5wcm9jZXNzLmNhbGwoc2VsZiwgcmVzLCBtZXRob2QsIG1vZGVsLCBvcHRpb25zKTtcblx0fSkudGhlbihvcHRpb25zLnN1Y2Nlc3MsIG9wdGlvbnMuZXJyb3IpO1xuXG5cdC8vIHRyaWdnZXIgdGhlIHJlcXVlc3QgZXZlbnRcblx0bW9kZWwudHJpZ2dlcigncmVxdWVzdCcsIG1vZGVsLCBkYiwgb3B0aW9ucyk7XG5cblx0Ly8gcmV0dXJuIHRoZSBvcmlnaW5hbCBwcm9taXNlIHdpdGggdGhlIG9yaWdpbmFsIHJlc3VsdFxuXHRyZXR1cm4gUHJvbWlzZS5hbGwoWyBwcm9taXNlLCBwcm9jZXNzUHJvbWlzZSBdKVxuXHQudGhlbihmdW5jdGlvbihyZXMpIHsgcmV0dXJuIHJlc1swXTsgfSk7XG59XG5cbnZhciBpc0NvbGxlY3Rpb24gPVxuTGF6eWJvbmVzLmlzQ29sbGVjdGlvbiA9IGZ1bmN0aW9uKHYpIHtcblx0cmV0dXJuIHYgIT0gbnVsbCAmJlxuXHRcdEFycmF5LmlzQXJyYXkodi5tb2RlbHMpICYmXG5cdFx0dHlwZW9mIHYubW9kZWwgPT09IFwiZnVuY3Rpb25cIiAmJlxuXHRcdHR5cGVvZiB2LmFkZCA9PT0gXCJmdW5jdGlvblwiICYmXG5cdFx0dHlwZW9mIHYucmVtb3ZlID09PSBcImZ1bmN0aW9uXCI7XG59XG5cbkxhenlib25lcy5pc01vZGVsID0gZnVuY3Rpb24odmFsKSB7XG5cdHJldHVybiB2YWwgIT0gbnVsbCAmJlxuXHRcdHR5cGVvZiB2YWwuY2lkID09PSBcInN0cmluZ1wiICYmXG5cdFx0dHlwZW9mIHZhbC5hdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiICYmXG5cdFx0dHlwZW9mIHZhbC5nZXQgPT09IFwiZnVuY3Rpb25cIiAmJlxuXHRcdHR5cGVvZiB2YWwuc2V0ID09PSBcImZ1bmN0aW9uXCI7XG59XG5cbmZ1bmN0aW9uIGdldFN5bmNPcHRpb25zKG0pIHtcblx0cmV0dXJuIG0gJiYgKGxvb2t1cChtLCBbXCJzeW5jT3B0aW9uc1wiLFwic3luY19vcHRpb25zXCJdKSB8fCBnZXRTeW5jT3B0aW9ucyhtLmNvbGxlY3Rpb24pKTtcbn1cblxuZnVuY3Rpb24gZ2V0RGF0YWJhc2UobSkge1xuXHRyZXR1cm4gbSAmJiAobG9va3VwKG0sIFtcInBvdWNoXCIsXCJwb3VjaGRiXCIsXCJkYlwiLFwiZGF0YWJhc2VcIl0pIHx8IGdldERhdGFiYXNlKG0uY29sbGVjdGlvbikpO1xufVxuXG5mdW5jdGlvbiBsb29rdXAobywga2V5cykge1xuXHR2YXIgdiwgaTtcblx0Zm9yIChpIGluIGtleXMpIHtcblx0XHR2ID0gb1trZXlzW2ldXTtcblx0XHRpZiAodHlwZW9mIHYgPT09IFwiZnVuY3Rpb25cIikge1xuXHRcdFx0cmV0dXJuIHYuY2FsbChvLCBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpKTtcblx0XHR9XG5cdFx0aWYgKHR5cGVvZiB2ICE9PSBcInVuZGVmaW5lZFwiKSByZXR1cm4gdjtcblx0fVxufVxuIixudWxsLCJ2YXIgaXNPYmplY3QgPSByZXF1aXJlKFwiaXMtcGxhaW4tb2JqZWN0XCIpO1xudmFyIGhhc093biA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG52YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5cbnZhciBtZXJnZSA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ob2JqLCB2YWwsIHNhZmUpIHtcblx0aWYgKGlzT2JqZWN0KG9iaikgJiYgaXNPYmplY3QodmFsKSkge1xuXHRcdGZvciAodmFyIGsgaW4gdmFsKSB7XG5cdFx0XHRpZiAoaGFzT3duLmNhbGwodmFsLCBrKSkgb2JqW2tdID0gbWVyZ2Uob2JqW2tdLCB2YWxba10sIHNhZmUpO1xuXHRcdH1cblxuXHRcdHJldHVybiBvYmo7XG5cdH1cblxuXHRyZXR1cm4gc2FmZSAmJiB0eXBlb2Ygb2JqICE9PSBcInVuZGVmaW5lZFwiID8gb2JqIDogdmFsO1xufVxuXG4vLyBrZWVwaW5nIGl0IERSWVxuZnVuY3Rpb24gbWVyZ2VBbGwoc2FmZSwgb2JqKSB7XG5cdHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpO1xuXHRmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3MubGVuZ3RoOyBpKyspIHtcblx0XHRvYmogPSBtZXJnZShvYmosIGFyZ3NbaV0sIHNhZmUpO1xuXHR9XG5cdHJldHVybiBvYmo7XG59XG5cbm1lcmdlLmV4dGVuZCA9IG1lcmdlQWxsLmJpbmQobnVsbCwgZmFsc2UpO1xubWVyZ2UuZGVmYXVsdHMgPSBtZXJnZUFsbC5iaW5kKG51bGwsIHRydWUpO1xuIiwiLyohXG4gKiBpcy1wbGFpbi1vYmplY3QgPGh0dHBzOi8vZ2l0aHViLmNvbS9qb25zY2hsaW5rZXJ0L2lzLXBsYWluLW9iamVjdD5cbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTQtMjAxNSwgSm9uIFNjaGxpbmtlcnQuXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgTUlUIExpY2Vuc2UuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgaXNPYmplY3QgPSByZXF1aXJlKCdpc29iamVjdCcpO1xuXG5mdW5jdGlvbiBpc09iamVjdE9iamVjdChvKSB7XG4gIHJldHVybiBpc09iamVjdChvKSA9PT0gdHJ1ZVxuICAgICYmIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChvKSA9PT0gJ1tvYmplY3QgT2JqZWN0XSc7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNQbGFpbk9iamVjdChvKSB7XG4gIHZhciBjdG9yLHByb3Q7XG4gIFxuICBpZiAoaXNPYmplY3RPYmplY3QobykgPT09IGZhbHNlKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBJZiBoYXMgbW9kaWZpZWQgY29uc3RydWN0b3JcbiAgY3RvciA9IG8uY29uc3RydWN0b3I7XG4gIGlmICh0eXBlb2YgY3RvciAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gSWYgaGFzIG1vZGlmaWVkIHByb3RvdHlwZVxuICBwcm90ID0gY3Rvci5wcm90b3R5cGU7XG4gIGlmIChpc09iamVjdE9iamVjdChwcm90KSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIElmIGNvbnN0cnVjdG9yIGRvZXMgbm90IGhhdmUgYW4gT2JqZWN0LXNwZWNpZmljIG1ldGhvZFxuICBpZiAocHJvdC5oYXNPd25Qcm9wZXJ0eSgnaXNQcm90b3R5cGVPZicpID09PSBmYWxzZSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBcbiAgLy8gTW9zdCBsaWtlbHkgYSBwbGFpbiBPYmplY3RcbiAgcmV0dXJuIHRydWU7XG59O1xuIiwiLyohXG4gKiBpc29iamVjdCA8aHR0cHM6Ly9naXRodWIuY29tL2pvbnNjaGxpbmtlcnQvaXNvYmplY3Q+XG4gKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LTIwMTUsIEpvbiBTY2hsaW5rZXJ0LlxuICogTGljZW5zZWQgdW5kZXIgdGhlIE1JVCBMaWNlbnNlLlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc09iamVjdChvKSB7XG4gIHJldHVybiBvICE9IG51bGwgJiYgdHlwZW9mIG8gPT09ICdvYmplY3QnXG4gICAgJiYgIUFycmF5LmlzQXJyYXkobyk7XG59OyIsIid1c2Ugc3RyaWN0JztcblxuLy8gYWxsb3cgZXh0ZXJuYWwgcGx1Z2lucyB0byByZXF1aXJlKCdwb3VjaGRiL2V4dHJhcy9wcm9taXNlJylcbm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi4vbGliL2RlcHMvcHJvbWlzZScpOyIsIlwidXNlIHN0cmljdFwiO1xuXG52YXIgaW5oZXJpdHMgPSByZXF1aXJlKCdpbmhlcml0cycpO1xuaW5oZXJpdHMoUG91Y2hFcnJvciwgRXJyb3IpO1xuXG5mdW5jdGlvbiBQb3VjaEVycm9yKG9wdHMpIHtcbiAgRXJyb3IuY2FsbChvcHRzLnJlYXNvbik7XG4gIHRoaXMuc3RhdHVzID0gb3B0cy5zdGF0dXM7XG4gIHRoaXMubmFtZSA9IG9wdHMuZXJyb3I7XG4gIHRoaXMubWVzc2FnZSA9IG9wdHMucmVhc29uO1xuICB0aGlzLmVycm9yID0gdHJ1ZTtcbn1cblxuUG91Y2hFcnJvci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XG4gICAgc3RhdHVzOiB0aGlzLnN0YXR1cyxcbiAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgbWVzc2FnZTogdGhpcy5tZXNzYWdlXG4gIH0pO1xufTtcblxuZXhwb3J0cy5VTkFVVEhPUklaRUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAxLFxuICBlcnJvcjogJ3VuYXV0aG9yaXplZCcsXG4gIHJlYXNvbjogXCJOYW1lIG9yIHBhc3N3b3JkIGlzIGluY29ycmVjdC5cIlxufSk7XG5cbmV4cG9ydHMuTUlTU0lOR19CVUxLX0RPQ1MgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiBcIk1pc3NpbmcgSlNPTiBsaXN0IG9mICdkb2NzJ1wiXG59KTtcblxuZXhwb3J0cy5NSVNTSU5HX0RPQyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDQsXG4gIGVycm9yOiAnbm90X2ZvdW5kJyxcbiAgcmVhc29uOiAnbWlzc2luZydcbn0pO1xuXG5leHBvcnRzLlJFVl9DT05GTElDVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDksXG4gIGVycm9yOiAnY29uZmxpY3QnLFxuICByZWFzb246ICdEb2N1bWVudCB1cGRhdGUgY29uZmxpY3QnXG59KTtcblxuZXhwb3J0cy5JTlZBTElEX0lEID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdpbnZhbGlkX2lkJyxcbiAgcmVhc29uOiAnX2lkIGZpZWxkIG11c3QgY29udGFpbiBhIHN0cmluZydcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfSUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDEyLFxuICBlcnJvcjogJ21pc3NpbmdfaWQnLFxuICByZWFzb246ICdfaWQgaXMgcmVxdWlyZWQgZm9yIHB1dHMnXG59KTtcblxuZXhwb3J0cy5SRVNFUlZFRF9JRCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdPbmx5IHJlc2VydmVkIGRvY3VtZW50IGlkcyBtYXkgc3RhcnQgd2l0aCB1bmRlcnNjb3JlLidcbn0pO1xuXG5leHBvcnRzLk5PVF9PUEVOID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQxMixcbiAgZXJyb3I6ICdwcmVjb25kaXRpb25fZmFpbGVkJyxcbiAgcmVhc29uOiAnRGF0YWJhc2Ugbm90IG9wZW4nXG59KTtcblxuZXhwb3J0cy5VTktOT1dOX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICd1bmtub3duX2Vycm9yJyxcbiAgcmVhc29uOiAnRGF0YWJhc2UgZW5jb3VudGVyZWQgYW4gdW5rbm93biBlcnJvcidcbn0pO1xuXG5leHBvcnRzLkJBRF9BUkcgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2JhZGFyZycsXG4gIHJlYXNvbjogJ1NvbWUgcXVlcnkgYXJndW1lbnQgaXMgaW52YWxpZCdcbn0pO1xuXG5leHBvcnRzLklOVkFMSURfUkVRVUVTVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnaW52YWxpZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnUmVxdWVzdCB3YXMgaW52YWxpZCdcbn0pO1xuXG5leHBvcnRzLlFVRVJZX1BBUlNFX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdxdWVyeV9wYXJzZV9lcnJvcicsXG4gIHJlYXNvbjogJ1NvbWUgcXVlcnkgcGFyYW1ldGVyIGlzIGludmFsaWQnXG59KTtcblxuZXhwb3J0cy5ET0NfVkFMSURBVElPTiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnZG9jX3ZhbGlkYXRpb24nLFxuICByZWFzb246ICdCYWQgc3BlY2lhbCBkb2N1bWVudCBtZW1iZXInXG59KTtcblxuZXhwb3J0cy5CQURfUkVRVUVTVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdTb21ldGhpbmcgd3Jvbmcgd2l0aCB0aGUgcmVxdWVzdCdcbn0pO1xuXG5leHBvcnRzLk5PVF9BTl9PQkpFQ1QgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2JhZF9yZXF1ZXN0JyxcbiAgcmVhc29uOiAnRG9jdW1lbnQgbXVzdCBiZSBhIEpTT04gb2JqZWN0J1xufSk7XG5cbmV4cG9ydHMuREJfTUlTU0lORyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDQsXG4gIGVycm9yOiAnbm90X2ZvdW5kJyxcbiAgcmVhc29uOiAnRGF0YWJhc2Ugbm90IGZvdW5kJ1xufSk7XG5cbmV4cG9ydHMuSURCX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICdpbmRleGVkX2RiX3dlbnRfYmFkJyxcbiAgcmVhc29uOiAndW5rbm93bidcbn0pO1xuXG5leHBvcnRzLldTUV9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnd2ViX3NxbF93ZW50X2JhZCcsXG4gIHJlYXNvbjogJ3Vua25vd24nXG59KTtcblxuZXhwb3J0cy5MREJfRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2xldmVsREJfd2VudF93ZW50X2JhZCcsXG4gIHJlYXNvbjogJ3Vua25vd24nXG59KTtcblxuZXhwb3J0cy5GT1JCSURERU4gPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAzLFxuICBlcnJvcjogJ2ZvcmJpZGRlbicsXG4gIHJlYXNvbjogJ0ZvcmJpZGRlbiBieSBkZXNpZ24gZG9jIHZhbGlkYXRlX2RvY191cGRhdGUgZnVuY3Rpb24nXG59KTtcblxuZXhwb3J0cy5JTlZBTElEX1JFViA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdJbnZhbGlkIHJldiBmb3JtYXQnXG59KTtcblxuZXhwb3J0cy5GSUxFX0VYSVNUUyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAnZmlsZV9leGlzdHMnLFxuICByZWFzb246ICdUaGUgZGF0YWJhc2UgY291bGQgbm90IGJlIGNyZWF0ZWQsIHRoZSBmaWxlIGFscmVhZHkgZXhpc3RzLidcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfU1RVQiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAnbWlzc2luZ19zdHViJ1xufSk7XG5cbmV4cG9ydHMuZXJyb3IgPSBmdW5jdGlvbiAoZXJyb3IsIHJlYXNvbiwgbmFtZSkge1xuICBmdW5jdGlvbiBDdXN0b21Qb3VjaEVycm9yKHJlYXNvbikge1xuICAgIC8vIGluaGVyaXQgZXJyb3IgcHJvcGVydGllcyBmcm9tIG91ciBwYXJlbnQgZXJyb3IgbWFudWFsbHlcbiAgICAvLyBzbyBhcyB0byBhbGxvdyBwcm9wZXIgSlNPTiBwYXJzaW5nLlxuICAgIC8qIGpzaGludCBpZ25vcmU6c3RhcnQgKi9cbiAgICBmb3IgKHZhciBwIGluIGVycm9yKSB7XG4gICAgICBpZiAodHlwZW9mIGVycm9yW3BdICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHRoaXNbcF0gPSBlcnJvcltwXTtcbiAgICAgIH1cbiAgICB9XG4gICAgLyoganNoaW50IGlnbm9yZTplbmQgKi9cbiAgICBpZiAobmFtZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIH1cbiAgICBpZiAocmVhc29uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMucmVhc29uID0gcmVhc29uO1xuICAgIH1cbiAgfVxuICBDdXN0b21Qb3VjaEVycm9yLnByb3RvdHlwZSA9IFBvdWNoRXJyb3IucHJvdG90eXBlO1xuICByZXR1cm4gbmV3IEN1c3RvbVBvdWNoRXJyb3IocmVhc29uKTtcbn07XG5cbi8vIEZpbmQgb25lIG9mIHRoZSBlcnJvcnMgZGVmaW5lZCBhYm92ZSBiYXNlZCBvbiB0aGUgdmFsdWVcbi8vIG9mIHRoZSBzcGVjaWZpZWQgcHJvcGVydHkuXG4vLyBJZiByZWFzb24gaXMgcHJvdmlkZWQgcHJlZmVyIHRoZSBlcnJvciBtYXRjaGluZyB0aGF0IHJlYXNvbi5cbi8vIFRoaXMgaXMgZm9yIGRpZmZlcmVudGlhdGluZyBiZXR3ZWVuIGVycm9ycyB3aXRoIHRoZSBzYW1lIG5hbWUgYW5kIHN0YXR1cyxcbi8vIGVnLCBiYWRfcmVxdWVzdC5cbmV4cG9ydHMuZ2V0RXJyb3JUeXBlQnlQcm9wID0gZnVuY3Rpb24gKHByb3AsIHZhbHVlLCByZWFzb24pIHtcbiAgdmFyIGVycm9ycyA9IGV4cG9ydHM7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoZXJyb3JzKS5maWx0ZXIoZnVuY3Rpb24gKGtleSkge1xuICAgIHZhciBlcnJvciA9IGVycm9yc1trZXldO1xuICAgIHJldHVybiB0eXBlb2YgZXJyb3IgIT09ICdmdW5jdGlvbicgJiYgZXJyb3JbcHJvcF0gPT09IHZhbHVlO1xuICB9KTtcbiAgdmFyIGtleSA9IHJlYXNvbiAmJiBrZXlzLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgIHZhciBlcnJvciA9IGVycm9yc1trZXldO1xuICAgICAgICByZXR1cm4gZXJyb3IubWVzc2FnZSA9PT0gcmVhc29uO1xuICAgICAgfSlbMF0gfHwga2V5c1swXTtcbiAgcmV0dXJuIChrZXkpID8gZXJyb3JzW2tleV0gOiBudWxsO1xufTtcblxuZXhwb3J0cy5nZW5lcmF0ZUVycm9yRnJvbVJlc3BvbnNlID0gZnVuY3Rpb24gKHJlcykge1xuICB2YXIgZXJyb3IsIGVyck5hbWUsIGVyclR5cGUsIGVyck1zZywgZXJyUmVhc29uO1xuICB2YXIgZXJyb3JzID0gZXhwb3J0cztcblxuICBlcnJOYW1lID0gKHJlcy5lcnJvciA9PT0gdHJ1ZSAmJiB0eXBlb2YgcmVzLm5hbWUgPT09ICdzdHJpbmcnKSA/XG4gICAgICAgICAgICAgIHJlcy5uYW1lIDpcbiAgICAgICAgICAgICAgcmVzLmVycm9yO1xuICBlcnJSZWFzb24gPSByZXMucmVhc29uO1xuICBlcnJUeXBlID0gZXJyb3JzLmdldEVycm9yVHlwZUJ5UHJvcCgnbmFtZScsIGVyck5hbWUsIGVyclJlYXNvbik7XG5cbiAgaWYgKHJlcy5taXNzaW5nIHx8XG4gICAgICBlcnJSZWFzb24gPT09ICdtaXNzaW5nJyB8fFxuICAgICAgZXJyUmVhc29uID09PSAnZGVsZXRlZCcgfHxcbiAgICAgIGVyck5hbWUgPT09ICdub3RfZm91bmQnKSB7XG4gICAgZXJyVHlwZSA9IGVycm9ycy5NSVNTSU5HX0RPQztcbiAgfSBlbHNlIGlmIChlcnJOYW1lID09PSAnZG9jX3ZhbGlkYXRpb24nKSB7XG4gICAgLy8gZG9jIHZhbGlkYXRpb24gbmVlZHMgc3BlY2lhbCB0cmVhdG1lbnQgc2luY2VcbiAgICAvLyByZXMucmVhc29uIGRlcGVuZHMgb24gdGhlIHZhbGlkYXRpb24gZXJyb3IuXG4gICAgLy8gc2VlIHV0aWxzLmpzXG4gICAgZXJyVHlwZSA9IGVycm9ycy5ET0NfVkFMSURBVElPTjtcbiAgICBlcnJNc2cgPSBlcnJSZWFzb247XG4gIH0gZWxzZSBpZiAoZXJyTmFtZSA9PT0gJ2JhZF9yZXF1ZXN0JyAmJiBlcnJUeXBlLm1lc3NhZ2UgIT09IGVyclJlYXNvbikge1xuICAgIC8vIGlmIGJhZF9yZXF1ZXN0IGVycm9yIGFscmVhZHkgZm91bmQgYmFzZWQgb24gcmVhc29uIGRvbid0IG92ZXJyaWRlLlxuXG4gICAgLy8gYXR0YWNobWVudCBlcnJvcnMuXG4gICAgaWYgKGVyclJlYXNvbi5pbmRleE9mKCd1bmtub3duIHN0dWIgYXR0YWNobWVudCcpID09PSAwKSB7XG4gICAgICBlcnJUeXBlID0gZXJyb3JzLk1JU1NJTkdfU1RVQjtcbiAgICAgIGVyck1zZyA9IGVyclJlYXNvbjtcbiAgICB9IGVsc2Uge1xuICAgICAgZXJyVHlwZSA9IGVycm9ycy5CQURfUkVRVUVTVDtcbiAgICB9XG4gIH1cblxuICAvLyBmYWxsYmFjayB0byBlcnJvciBieSBzdGF0eXMgb3IgdW5rbm93biBlcnJvci5cbiAgaWYgKCFlcnJUeXBlKSB7XG4gICAgZXJyVHlwZSA9IGVycm9ycy5nZXRFcnJvclR5cGVCeVByb3AoJ3N0YXR1cycsIHJlcy5zdGF0dXMsIGVyclJlYXNvbikgfHxcbiAgICAgICAgICAgICAgICBlcnJvcnMuVU5LTk9XTl9FUlJPUjtcbiAgfVxuXG4gIGVycm9yID0gZXJyb3JzLmVycm9yKGVyclR5cGUsIGVyclJlYXNvbiwgZXJyTmFtZSk7XG5cbiAgLy8gS2VlcCBjdXN0b20gbWVzc2FnZS5cbiAgaWYgKGVyck1zZykge1xuICAgIGVycm9yLm1lc3NhZ2UgPSBlcnJNc2c7XG4gIH1cblxuICAvLyBLZWVwIGhlbHBmdWwgcmVzcG9uc2UgZGF0YSBpbiBvdXIgZXJyb3IgbWVzc2FnZXMuXG4gIGlmIChyZXMuaWQpIHtcbiAgICBlcnJvci5pZCA9IHJlcy5pZDtcbiAgfVxuICBpZiAocmVzLnN0YXR1cykge1xuICAgIGVycm9yLnN0YXR1cyA9IHJlcy5zdGF0dXM7XG4gIH1cbiAgaWYgKHJlcy5zdGF0dXNUZXh0KSB7XG4gICAgZXJyb3IubmFtZSA9IHJlcy5zdGF0dXNUZXh0O1xuICB9XG4gIGlmIChyZXMubWlzc2luZykge1xuICAgIGVycm9yLm1pc3NpbmcgPSByZXMubWlzc2luZztcbiAgfVxuXG4gIHJldHVybiBlcnJvcjtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbmlmICh0eXBlb2YgUHJvbWlzZSA9PT0gJ2Z1bmN0aW9uJykge1xuICBtb2R1bGUuZXhwb3J0cyA9IFByb21pc2U7XG59IGVsc2Uge1xuICBtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJ2JsdWViaXJkJyk7XG59IiwiaWYgKHR5cGVvZiBPYmplY3QuY3JlYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gIC8vIGltcGxlbWVudGF0aW9uIGZyb20gc3RhbmRhcmQgbm9kZS5qcyAndXRpbCcgbW9kdWxlXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICBjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDdG9yLnByb3RvdHlwZSwge1xuICAgICAgY29uc3RydWN0b3I6IHtcbiAgICAgICAgdmFsdWU6IGN0b3IsXG4gICAgICAgIGVudW1lcmFibGU6IGZhbHNlLFxuICAgICAgICB3cml0YWJsZTogdHJ1ZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG4gIH07XG59IGVsc2Uge1xuICAvLyBvbGQgc2Nob29sIHNoaW0gZm9yIG9sZCBicm93c2Vyc1xuICBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGluaGVyaXRzKGN0b3IsIHN1cGVyQ3Rvcikge1xuICAgIGN0b3Iuc3VwZXJfID0gc3VwZXJDdG9yXG4gICAgdmFyIFRlbXBDdG9yID0gZnVuY3Rpb24gKCkge31cbiAgICBUZW1wQ3Rvci5wcm90b3R5cGUgPSBzdXBlckN0b3IucHJvdG90eXBlXG4gICAgY3Rvci5wcm90b3R5cGUgPSBuZXcgVGVtcEN0b3IoKVxuICAgIGN0b3IucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gY3RvclxuICB9XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gSU5URVJOQUw7XG5cbmZ1bmN0aW9uIElOVEVSTkFMKCkge30iLCIndXNlIHN0cmljdCc7XG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJy4vcHJvbWlzZScpO1xudmFyIHJlamVjdCA9IHJlcXVpcmUoJy4vcmVqZWN0Jyk7XG52YXIgcmVzb2x2ZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZScpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xubW9kdWxlLmV4cG9ydHMgPSBhbGw7XG5mdW5jdGlvbiBhbGwoaXRlcmFibGUpIHtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChpdGVyYWJsZSkgIT09ICdbb2JqZWN0IEFycmF5XScpIHtcbiAgICByZXR1cm4gcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ211c3QgYmUgYW4gYXJyYXknKSk7XG4gIH1cblxuICB2YXIgbGVuID0gaXRlcmFibGUubGVuZ3RoO1xuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGlmICghbGVuKSB7XG4gICAgcmV0dXJuIHJlc29sdmUoW10pO1xuICB9XG5cbiAgdmFyIHZhbHVlcyA9IG5ldyBBcnJheShsZW4pO1xuICB2YXIgcmVzb2x2ZWQgPSAwO1xuICB2YXIgaSA9IC0xO1xuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcbiAgXG4gIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICBhbGxSZXNvbHZlcihpdGVyYWJsZVtpXSwgaSk7XG4gIH1cbiAgcmV0dXJuIHByb21pc2U7XG4gIGZ1bmN0aW9uIGFsbFJlc29sdmVyKHZhbHVlLCBpKSB7XG4gICAgcmVzb2x2ZSh2YWx1ZSkudGhlbihyZXNvbHZlRnJvbUFsbCwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGZ1bmN0aW9uIHJlc29sdmVGcm9tQWxsKG91dFZhbHVlKSB7XG4gICAgICB2YWx1ZXNbaV0gPSBvdXRWYWx1ZTtcbiAgICAgIGlmICgrK3Jlc29sdmVkID09PSBsZW4gJiAhY2FsbGVkKSB7XG4gICAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICAgIGhhbmRsZXJzLnJlc29sdmUocHJvbWlzZSwgdmFsdWVzKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG52YXIgdHJ5Q2F0Y2ggPSByZXF1aXJlKCcuL3RyeUNhdGNoJyk7XG52YXIgcmVzb2x2ZVRoZW5hYmxlID0gcmVxdWlyZSgnLi9yZXNvbHZlVGhlbmFibGUnKTtcbnZhciBzdGF0ZXMgPSByZXF1aXJlKCcuL3N0YXRlcycpO1xuXG5leHBvcnRzLnJlc29sdmUgPSBmdW5jdGlvbiAoc2VsZiwgdmFsdWUpIHtcbiAgdmFyIHJlc3VsdCA9IHRyeUNhdGNoKGdldFRoZW4sIHZhbHVlKTtcbiAgaWYgKHJlc3VsdC5zdGF0dXMgPT09ICdlcnJvcicpIHtcbiAgICByZXR1cm4gZXhwb3J0cy5yZWplY3Qoc2VsZiwgcmVzdWx0LnZhbHVlKTtcbiAgfVxuICB2YXIgdGhlbmFibGUgPSByZXN1bHQudmFsdWU7XG5cbiAgaWYgKHRoZW5hYmxlKSB7XG4gICAgcmVzb2x2ZVRoZW5hYmxlLnNhZmVseShzZWxmLCB0aGVuYWJsZSk7XG4gIH0gZWxzZSB7XG4gICAgc2VsZi5zdGF0ZSA9IHN0YXRlcy5GVUxGSUxMRUQ7XG4gICAgc2VsZi5vdXRjb21lID0gdmFsdWU7XG4gICAgdmFyIGkgPSAtMTtcbiAgICB2YXIgbGVuID0gc2VsZi5xdWV1ZS5sZW5ndGg7XG4gICAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgICAgc2VsZi5xdWV1ZVtpXS5jYWxsRnVsZmlsbGVkKHZhbHVlKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHNlbGY7XG59O1xuZXhwb3J0cy5yZWplY3QgPSBmdW5jdGlvbiAoc2VsZiwgZXJyb3IpIHtcbiAgc2VsZi5zdGF0ZSA9IHN0YXRlcy5SRUpFQ1RFRDtcbiAgc2VsZi5vdXRjb21lID0gZXJyb3I7XG4gIHZhciBpID0gLTE7XG4gIHZhciBsZW4gPSBzZWxmLnF1ZXVlLmxlbmd0aDtcbiAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgIHNlbGYucXVldWVbaV0uY2FsbFJlamVjdGVkKGVycm9yKTtcbiAgfVxuICByZXR1cm4gc2VsZjtcbn07XG5cbmZ1bmN0aW9uIGdldFRoZW4ob2JqKSB7XG4gIC8vIE1ha2Ugc3VyZSB3ZSBvbmx5IGFjY2VzcyB0aGUgYWNjZXNzb3Igb25jZSBhcyByZXF1aXJlZCBieSB0aGUgc3BlY1xuICB2YXIgdGhlbiA9IG9iaiAmJiBvYmoudGhlbjtcbiAgaWYgKG9iaiAmJiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgdGhlbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmdW5jdGlvbiBhcHB5VGhlbigpIHtcbiAgICAgIHRoZW4uYXBwbHkob2JqLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vcHJvbWlzZScpO1xuXG5leHBvcnRzLnJlc29sdmUgPSByZXF1aXJlKCcuL3Jlc29sdmUnKTtcbmV4cG9ydHMucmVqZWN0ID0gcmVxdWlyZSgnLi9yZWplY3QnKTtcbmV4cG9ydHMuYWxsID0gcmVxdWlyZSgnLi9hbGwnKTtcbmV4cG9ydHMucmFjZSA9IHJlcXVpcmUoJy4vcmFjZScpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdW53cmFwID0gcmVxdWlyZSgnLi91bndyYXAnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciByZXNvbHZlVGhlbmFibGUgPSByZXF1aXJlKCcuL3Jlc29sdmVUaGVuYWJsZScpO1xudmFyIHN0YXRlcyA9IHJlcXVpcmUoJy4vc3RhdGVzJyk7XG52YXIgUXVldWVJdGVtID0gcmVxdWlyZSgnLi9xdWV1ZUl0ZW0nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBQcm9taXNlO1xuZnVuY3Rpb24gUHJvbWlzZShyZXNvbHZlcikge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgUHJvbWlzZSkpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZXIpO1xuICB9XG4gIGlmICh0eXBlb2YgcmVzb2x2ZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdyZXNvbHZlciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB0aGlzLnN0YXRlID0gc3RhdGVzLlBFTkRJTkc7XG4gIHRoaXMucXVldWUgPSBbXTtcbiAgdGhpcy5vdXRjb21lID0gdm9pZCAwO1xuICBpZiAocmVzb2x2ZXIgIT09IElOVEVSTkFMKSB7XG4gICAgcmVzb2x2ZVRoZW5hYmxlLnNhZmVseSh0aGlzLCByZXNvbHZlcik7XG4gIH1cbn1cblxuUHJvbWlzZS5wcm90b3R5cGVbJ2NhdGNoJ10gPSBmdW5jdGlvbiAob25SZWplY3RlZCkge1xuICByZXR1cm4gdGhpcy50aGVuKG51bGwsIG9uUmVqZWN0ZWQpO1xufTtcblByb21pc2UucHJvdG90eXBlLnRoZW4gPSBmdW5jdGlvbiAob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgaWYgKHR5cGVvZiBvbkZ1bGZpbGxlZCAhPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZXMuRlVMRklMTEVEIHx8XG4gICAgdHlwZW9mIG9uUmVqZWN0ZWQgIT09ICdmdW5jdGlvbicgJiYgdGhpcy5zdGF0ZSA9PT0gc3RhdGVzLlJFSkVDVEVEKSB7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG4gIGlmICh0aGlzLnN0YXRlICE9PSBzdGF0ZXMuUEVORElORykge1xuICAgIHZhciByZXNvbHZlciA9IHRoaXMuc3RhdGUgPT09IHN0YXRlcy5GVUxGSUxMRUQgPyBvbkZ1bGZpbGxlZCA6IG9uUmVqZWN0ZWQ7XG4gICAgdW53cmFwKHByb21pc2UsIHJlc29sdmVyLCB0aGlzLm91dGNvbWUpO1xuICB9IGVsc2Uge1xuICAgIHRoaXMucXVldWUucHVzaChuZXcgUXVldWVJdGVtKHByb21pc2UsIG9uRnVsZmlsbGVkLCBvblJlamVjdGVkKSk7XG4gIH1cblxuICByZXR1cm4gcHJvbWlzZTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG52YXIgdW53cmFwID0gcmVxdWlyZSgnLi91bndyYXAnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBRdWV1ZUl0ZW07XG5mdW5jdGlvbiBRdWV1ZUl0ZW0ocHJvbWlzZSwgb25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgdGhpcy5wcm9taXNlID0gcHJvbWlzZTtcbiAgaWYgKHR5cGVvZiBvbkZ1bGZpbGxlZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMub25GdWxmaWxsZWQgPSBvbkZ1bGZpbGxlZDtcbiAgICB0aGlzLmNhbGxGdWxmaWxsZWQgPSB0aGlzLm90aGVyQ2FsbEZ1bGZpbGxlZDtcbiAgfVxuICBpZiAodHlwZW9mIG9uUmVqZWN0ZWQgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLm9uUmVqZWN0ZWQgPSBvblJlamVjdGVkO1xuICAgIHRoaXMuY2FsbFJlamVjdGVkID0gdGhpcy5vdGhlckNhbGxSZWplY3RlZDtcbiAgfVxufVxuUXVldWVJdGVtLnByb3RvdHlwZS5jYWxsRnVsZmlsbGVkID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIGhhbmRsZXJzLnJlc29sdmUodGhpcy5wcm9taXNlLCB2YWx1ZSk7XG59O1xuUXVldWVJdGVtLnByb3RvdHlwZS5vdGhlckNhbGxGdWxmaWxsZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgdW53cmFwKHRoaXMucHJvbWlzZSwgdGhpcy5vbkZ1bGZpbGxlZCwgdmFsdWUpO1xufTtcblF1ZXVlSXRlbS5wcm90b3R5cGUuY2FsbFJlamVjdGVkID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIGhhbmRsZXJzLnJlamVjdCh0aGlzLnByb21pc2UsIHZhbHVlKTtcbn07XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLm90aGVyQ2FsbFJlamVjdGVkID0gZnVuY3Rpb24gKHZhbHVlKSB7XG4gIHVud3JhcCh0aGlzLnByb21pc2UsIHRoaXMub25SZWplY3RlZCwgdmFsdWUpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgcmVqZWN0ID0gcmVxdWlyZSgnLi9yZWplY3QnKTtcbnZhciByZXNvbHZlID0gcmVxdWlyZSgnLi9yZXNvbHZlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJhY2U7XG5mdW5jdGlvbiByYWNlKGl0ZXJhYmxlKSB7XG4gIGlmIChPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoaXRlcmFibGUpICE9PSAnW29iamVjdCBBcnJheV0nKSB7XG4gICAgcmV0dXJuIHJlamVjdChuZXcgVHlwZUVycm9yKCdtdXN0IGJlIGFuIGFycmF5JykpO1xuICB9XG5cbiAgdmFyIGxlbiA9IGl0ZXJhYmxlLmxlbmd0aDtcbiAgdmFyIGNhbGxlZCA9IGZhbHNlO1xuICBpZiAoIWxlbikge1xuICAgIHJldHVybiByZXNvbHZlKFtdKTtcbiAgfVxuXG4gIHZhciBpID0gLTE7XG4gIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoSU5URVJOQUwpO1xuXG4gIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICByZXNvbHZlcihpdGVyYWJsZVtpXSk7XG4gIH1cbiAgcmV0dXJuIHByb21pc2U7XG4gIGZ1bmN0aW9uIHJlc29sdmVyKHZhbHVlKSB7XG4gICAgcmVzb2x2ZSh2YWx1ZSkudGhlbihmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgIGlmICghY2FsbGVkKSB7XG4gICAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICAgIGhhbmRsZXJzLnJlc29sdmUocHJvbWlzZSwgcmVzcG9uc2UpO1xuICAgICAgfVxuICAgIH0sIGZ1bmN0aW9uIChlcnJvcikge1xuICAgICAgaWYgKCFjYWxsZWQpIHtcbiAgICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgaGFuZGxlcnMucmVqZWN0KHByb21pc2UsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgUHJvbWlzZSA9IHJlcXVpcmUoJy4vcHJvbWlzZScpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xubW9kdWxlLmV4cG9ydHMgPSByZWplY3Q7XG5cbmZ1bmN0aW9uIHJlamVjdChyZWFzb24pIHtcblx0dmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG5cdHJldHVybiBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgcmVhc29uKTtcbn0iLCIndXNlIHN0cmljdCc7XG5cbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJlc29sdmU7XG5cbnZhciBGQUxTRSA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCBmYWxzZSk7XG52YXIgTlVMTCA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCBudWxsKTtcbnZhciBVTkRFRklORUQgPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgdm9pZCAwKTtcbnZhciBaRVJPID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIDApO1xudmFyIEVNUFRZU1RSSU5HID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksICcnKTtcblxuZnVuY3Rpb24gcmVzb2x2ZSh2YWx1ZSkge1xuICBpZiAodmFsdWUpIHtcbiAgICBpZiAodmFsdWUgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIHJldHVybiBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgdmFsdWUpO1xuICB9XG4gIHZhciB2YWx1ZVR5cGUgPSB0eXBlb2YgdmFsdWU7XG4gIHN3aXRjaCAodmFsdWVUeXBlKSB7XG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gRkFMU0U7XG4gICAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICAgIHJldHVybiBVTkRFRklORUQ7XG4gICAgY2FzZSAnb2JqZWN0JzpcbiAgICAgIHJldHVybiBOVUxMO1xuICAgIGNhc2UgJ251bWJlcic6XG4gICAgICByZXR1cm4gWkVSTztcbiAgICBjYXNlICdzdHJpbmcnOlxuICAgICAgcmV0dXJuIEVNUFRZU1RSSU5HO1xuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xudmFyIHRyeUNhdGNoID0gcmVxdWlyZSgnLi90cnlDYXRjaCcpO1xuZnVuY3Rpb24gc2FmZWx5UmVzb2x2ZVRoZW5hYmxlKHNlbGYsIHRoZW5hYmxlKSB7XG4gIC8vIEVpdGhlciBmdWxmaWxsLCByZWplY3Qgb3IgcmVqZWN0IHdpdGggZXJyb3JcbiAgdmFyIGNhbGxlZCA9IGZhbHNlO1xuICBmdW5jdGlvbiBvbkVycm9yKHZhbHVlKSB7XG4gICAgaWYgKGNhbGxlZCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjYWxsZWQgPSB0cnVlO1xuICAgIGhhbmRsZXJzLnJlamVjdChzZWxmLCB2YWx1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiBvblN1Y2Nlc3ModmFsdWUpIHtcbiAgICBpZiAoY2FsbGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNhbGxlZCA9IHRydWU7XG4gICAgaGFuZGxlcnMucmVzb2x2ZShzZWxmLCB2YWx1ZSk7XG4gIH1cblxuICBmdW5jdGlvbiB0cnlUb1Vud3JhcCgpIHtcbiAgICB0aGVuYWJsZShvblN1Y2Nlc3MsIG9uRXJyb3IpO1xuICB9XG4gIFxuICB2YXIgcmVzdWx0ID0gdHJ5Q2F0Y2godHJ5VG9VbndyYXApO1xuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgIG9uRXJyb3IocmVzdWx0LnZhbHVlKTtcbiAgfVxufVxuZXhwb3J0cy5zYWZlbHkgPSBzYWZlbHlSZXNvbHZlVGhlbmFibGU7IiwiLy8gTGF6eSBtYW4ncyBzeW1ib2xzIGZvciBzdGF0ZXNcblxuZXhwb3J0cy5SRUpFQ1RFRCA9IFsnUkVKRUNURUQnXTtcbmV4cG9ydHMuRlVMRklMTEVEID0gWydGVUxGSUxMRUQnXTtcbmV4cG9ydHMuUEVORElORyA9IFsnUEVORElORyddO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHRyeUNhdGNoO1xuXG5mdW5jdGlvbiB0cnlDYXRjaChmdW5jLCB2YWx1ZSkge1xuICB2YXIgb3V0ID0ge307XG4gIHRyeSB7XG4gICAgb3V0LnZhbHVlID0gZnVuYyh2YWx1ZSk7XG4gICAgb3V0LnN0YXR1cyA9ICdzdWNjZXNzJztcbiAgfSBjYXRjaCAoZSkge1xuICAgIG91dC5zdGF0dXMgPSAnZXJyb3InO1xuICAgIG91dC52YWx1ZSA9IGU7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn0iLCIndXNlIHN0cmljdCc7XG5cbnZhciBpbW1lZGlhdGUgPSByZXF1aXJlKCdpbW1lZGlhdGUnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gdW53cmFwO1xuXG5mdW5jdGlvbiB1bndyYXAocHJvbWlzZSwgZnVuYywgdmFsdWUpIHtcbiAgaW1tZWRpYXRlKGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgcmV0dXJuVmFsdWU7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVyblZhbHVlID0gZnVuYyh2YWx1ZSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgcmV0dXJuIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCBlKTtcbiAgICB9XG4gICAgaWYgKHJldHVyblZhbHVlID09PSBwcm9taXNlKSB7XG4gICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgbmV3IFR5cGVFcnJvcignQ2Fubm90IHJlc29sdmUgcHJvbWlzZSB3aXRoIGl0c2VsZicpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaGFuZGxlcnMucmVzb2x2ZShwcm9taXNlLCByZXR1cm5WYWx1ZSk7XG4gICAgfVxuICB9KTtcbn0iLCIndXNlIHN0cmljdCc7XG52YXIgdHlwZXMgPSBbXG4gIHJlcXVpcmUoJy4vbmV4dFRpY2snKSxcbiAgcmVxdWlyZSgnLi9tdXRhdGlvbi5qcycpLFxuICByZXF1aXJlKCcuL21lc3NhZ2VDaGFubmVsJyksXG4gIHJlcXVpcmUoJy4vc3RhdGVDaGFuZ2UnKSxcbiAgcmVxdWlyZSgnLi90aW1lb3V0Jylcbl07XG52YXIgZHJhaW5pbmc7XG52YXIgcXVldWUgPSBbXTtcbi8vbmFtZWQgbmV4dFRpY2sgZm9yIGxlc3MgY29uZnVzaW5nIHN0YWNrIHRyYWNlc1xuZnVuY3Rpb24gbmV4dFRpY2soKSB7XG4gIGRyYWluaW5nID0gdHJ1ZTtcbiAgdmFyIGksIG9sZFF1ZXVlO1xuICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICB3aGlsZSAobGVuKSB7XG4gICAgb2xkUXVldWUgPSBxdWV1ZTtcbiAgICBxdWV1ZSA9IFtdO1xuICAgIGkgPSAtMTtcbiAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICBvbGRRdWV1ZVtpXSgpO1xuICAgIH1cbiAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gIH1cbiAgZHJhaW5pbmcgPSBmYWxzZTtcbn1cbnZhciBzY2hlZHVsZURyYWluO1xudmFyIGkgPSAtMTtcbnZhciBsZW4gPSB0eXBlcy5sZW5ndGg7XG53aGlsZSAoKysgaSA8IGxlbikge1xuICBpZiAodHlwZXNbaV0gJiYgdHlwZXNbaV0udGVzdCAmJiB0eXBlc1tpXS50ZXN0KCkpIHtcbiAgICBzY2hlZHVsZURyYWluID0gdHlwZXNbaV0uaW5zdGFsbChuZXh0VGljayk7XG4gICAgYnJlYWs7XG4gIH1cbn1cbm1vZHVsZS5leHBvcnRzID0gaW1tZWRpYXRlO1xuZnVuY3Rpb24gaW1tZWRpYXRlKHRhc2spIHtcbiAgaWYgKHF1ZXVlLnB1c2godGFzaykgPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgc2NoZWR1bGVEcmFpbigpO1xuICB9XG59IiwiJ3VzZSBzdHJpY3QnO1xuXG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIGlmIChnbG9iYWwuc2V0SW1tZWRpYXRlKSB7XG4gICAgLy8gd2UgY2FuIG9ubHkgZ2V0IGhlcmUgaW4gSUUxMFxuICAgIC8vIHdoaWNoIGRvZXNuJ3QgaGFuZGVsIHBvc3RNZXNzYWdlIHdlbGxcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHR5cGVvZiBnbG9iYWwuTWVzc2FnZUNoYW5uZWwgIT09ICd1bmRlZmluZWQnO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKGZ1bmMpIHtcbiAgdmFyIGNoYW5uZWwgPSBuZXcgZ2xvYmFsLk1lc3NhZ2VDaGFubmVsKCk7XG4gIGNoYW5uZWwucG9ydDEub25tZXNzYWdlID0gZnVuYztcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBjaGFubmVsLnBvcnQyLnBvc3RNZXNzYWdlKDApO1xuICB9O1xufTsiLCIndXNlIHN0cmljdCc7XG4vL2Jhc2VkIG9mZiByc3ZwIGh0dHBzOi8vZ2l0aHViLmNvbS90aWxkZWlvL3JzdnAuanNcbi8vbGljZW5zZSBodHRwczovL2dpdGh1Yi5jb20vdGlsZGVpby9yc3ZwLmpzL2Jsb2IvbWFzdGVyL0xJQ0VOU0Vcbi8vaHR0cHM6Ly9naXRodWIuY29tL3RpbGRlaW8vcnN2cC5qcy9ibG9iL21hc3Rlci9saWIvcnN2cC9hc2FwLmpzXG5cbnZhciBNdXRhdGlvbiA9IGdsb2JhbC5NdXRhdGlvbk9ic2VydmVyIHx8IGdsb2JhbC5XZWJLaXRNdXRhdGlvbk9ic2VydmVyO1xuXG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBNdXRhdGlvbjtcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uIChoYW5kbGUpIHtcbiAgdmFyIGNhbGxlZCA9IDA7XG4gIHZhciBvYnNlcnZlciA9IG5ldyBNdXRhdGlvbihoYW5kbGUpO1xuICB2YXIgZWxlbWVudCA9IGdsb2JhbC5kb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gIG9ic2VydmVyLm9ic2VydmUoZWxlbWVudCwge1xuICAgIGNoYXJhY3RlckRhdGE6IHRydWVcbiAgfSk7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgZWxlbWVudC5kYXRhID0gKGNhbGxlZCA9ICsrY2FsbGVkICUgMik7XG4gIH07XG59OyIsIid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gJ2RvY3VtZW50JyBpbiBnbG9iYWwgJiYgJ29ucmVhZHlzdGF0ZWNoYW5nZScgaW4gZ2xvYmFsLmRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3NjcmlwdCcpO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKGhhbmRsZSkge1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuXG4gICAgLy8gQ3JlYXRlIGEgPHNjcmlwdD4gZWxlbWVudDsgaXRzIHJlYWR5c3RhdGVjaGFuZ2UgZXZlbnQgd2lsbCBiZSBmaXJlZCBhc3luY2hyb25vdXNseSBvbmNlIGl0IGlzIGluc2VydGVkXG4gICAgLy8gaW50byB0aGUgZG9jdW1lbnQuIERvIHNvLCB0aHVzIHF1ZXVpbmcgdXAgdGhlIHRhc2suIFJlbWVtYmVyIHRvIGNsZWFuIHVwIG9uY2UgaXQncyBiZWVuIGNhbGxlZC5cbiAgICB2YXIgc2NyaXB0RWwgPSBnbG9iYWwuZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG4gICAgc2NyaXB0RWwub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgICAgaGFuZGxlKCk7XG5cbiAgICAgIHNjcmlwdEVsLm9ucmVhZHlzdGF0ZWNoYW5nZSA9IG51bGw7XG4gICAgICBzY3JpcHRFbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHNjcmlwdEVsKTtcbiAgICAgIHNjcmlwdEVsID0gbnVsbDtcbiAgICB9O1xuICAgIGdsb2JhbC5kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuYXBwZW5kQ2hpbGQoc2NyaXB0RWwpO1xuXG4gICAgcmV0dXJuIGhhbmRsZTtcbiAgfTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuZXhwb3J0cy50ZXN0ID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbmV4cG9ydHMuaW5zdGFsbCA9IGZ1bmN0aW9uICh0KSB7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG4gICAgc2V0VGltZW91dCh0LCAwKTtcbiAgfTtcbn07Il19
