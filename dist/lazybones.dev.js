/* Lazybones / (c) 2014 Beneath the Ink, Inc. / MIT License / Version 0.3.1 */
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

			// changes feed result
			if (res[options.rowKey] != null) return res[options.rowKey];
		}

		return res;
	}
};

/* ## Sync
 *
 * This is the heart of Lazybones. Use it wherever `Backbone.sync` is used.
 */
Lazybones.sync = function(method, model, options) {
	var self, dbMethod, db, onChange, promise, chgopts, chgfilter, processed, processPromise;

	// resolve method and database
	self = this;
	options = merge.defaults({}, options, getSyncOptions(model), getSyncOptions(model.collection), Lazybones.defaults);
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
		chgopts = merge.defaults({
			include_docs: true
		}, options.changes, options.options.changes);

		if (typeof chgopts.filter === "function") {
			chgfilter = chgopts.filter;
			chgopts.filter = null;
		}

		promise = db.changes(chgopts);

		onChange = function(row) {
			var val = options.process.call(self, row, method, model, options);
			if (chgfilter && !chgfilter(val, row, options)) return;
			model.set(val, merge.extend({ remove: false }, options));
		}

		promise.on("create", onChange);
		promise.on("update", onChange);

		promise.on("delete", function(row) {
			var m = !isCollection(model) ? model : model.remove(row.id, options);

			if (m) {
				var val = options.process.call(self, row, method, model, options);
				m.set(val, options);
			}
		});

		// return the changes object immediately
		return promise;
	}

	// trigger the request event
	model.trigger('request', model, db, options);

	// process the result into something that backbone can use
	// and ship result to success and error callbacks
	return promise.then(function(res) {
		options.success(options.process.call(self, res, method, model, options));
		return res;
	}).catch(function(err) {
		options.error(err);
		throw err;
	});
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
	return m && lookup(m, ["syncOptions","sync_options"]);
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvbGF6eWJvbmVzLmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcmVzb2x2ZS9lbXB0eS5qcyIsIm5vZGVfbW9kdWxlcy9wbGFpbi1tZXJnZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9wbGFpbi1tZXJnZS9ub2RlX21vZHVsZXMvaXMtcGxhaW4tb2JqZWN0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BsYWluLW1lcmdlL25vZGVfbW9kdWxlcy9pcy1wbGFpbi1vYmplY3Qvbm9kZV9tb2R1bGVzL2lzb2JqZWN0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvZXh0cmFzL3Byb21pc2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9lcnJvcnMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9saWIvZGVwcy9wcm9taXNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2luaGVyaXRzL2luaGVyaXRzX2Jyb3dzZXIuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9JTlRFUk5BTC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL2FsbC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL2hhbmRsZXJzLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9wcm9taXNlLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcXVldWVJdGVtLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9saWIvcmFjZS5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3JlamVjdC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Jlc29sdmUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9yZXNvbHZlVGhlbmFibGUuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi9zdGF0ZXMuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL2xpYi90cnlDYXRjaC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbGliL3Vud3JhcC5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL21lc3NhZ2VDaGFubmVsLmpzIiwibm9kZV9tb2R1bGVzL3BvdWNoZGIvbm9kZV9tb2R1bGVzL2xpZS9ub2RlX21vZHVsZXMvaW1tZWRpYXRlL2xpYi9tdXRhdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9wb3VjaGRiL25vZGVfbW9kdWxlcy9saWUvbm9kZV9tb2R1bGVzL2ltbWVkaWF0ZS9saWIvc3RhdGVDaGFuZ2UuanMiLCJub2RlX21vZHVsZXMvcG91Y2hkYi9ub2RlX21vZHVsZXMvbGllL25vZGVfbW9kdWxlcy9pbW1lZGlhdGUvbGliL3RpbWVvdXQuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xPQTs7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN4Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qICMgTGF6eWJvbmVzICovXG5cbnZhciBtZXJnZSA9IHJlcXVpcmUoXCJwbGFpbi1tZXJnZVwiKSxcblx0UHJvbWlzZSA9IHJlcXVpcmUoXCJwb3VjaGRiL2V4dHJhcy9wcm9taXNlXCIpLFxuXHRQb3VjaEVycm9yID0gcmVxdWlyZShcInBvdWNoZGIvbGliL2RlcHMvZXJyb3JzXCIpO1xuXG5mdW5jdGlvbiBub29wKCl7fVxuXG4vKiAjIyBQb3VjaERCIFBsdWdpblxuICpcbiAqIFRoaXMgaXMgdGhlIFBvdWNoREIgcGx1Z2luIG1ldGhvZCB0aGF0IGF0dGFjaGVzIGEgYGxhenlib25lcygpYCBtZXRob2QgdG8gbmV3bHkgY3JlYXRlZCBQb3VjaERCIGluc3RhbmNlcy4gVGhlIGBsYXp5Ym9uZXMoKWAgd2lsbCBjcmVhdGUgYSBzeW5jIG1ldGhvZCAod2l0aCBvcHRpb25zKSB0aGF0IGlzIHRpZWQgZGlyZWN0bHkgdG8gdGhlIGRhdGFiYXNlIGl0IHdhcyBjYWxsZWQgb24uXG4gKlxuICogYGBganNcbiAqIFBvdWNoREIucGx1Z2luKExhenlib25lcygpKTtcbiAqIHZhciBkYiA9IG5ldyBQb3VjaERCKFwibXlkYlwiKTtcbiAqIGRiLmxhenlib25lcygpOyAvLyByZXR1cm5zIGEgc3luYyBmdW5jdGlvblxuICogYGBgXG4gKi9cbnZhciBMYXp5Ym9uZXMgPSBtb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGdkZWYpIHtcblx0cmV0dXJuIHsgbGF6eWJvbmVzOiBmdW5jdGlvbihkZWZhdWx0cykge1xuXHRcdHZhciBkYiA9IHRoaXM7XG5cdFx0cmV0dXJuIGZ1bmN0aW9uKG1ldGhvZCwgbW9kZWwsIG9wdGlvbnMpIHtcblx0XHRcdG9wdGlvbnMgPSBtZXJnZS5kZWZhdWx0cyh7fSwgb3B0aW9ucywgZGVmYXVsdHMsIGdkZWYsIHsgZGF0YWJhc2U6IGRiIH0pO1xuXHRcdFx0cmV0dXJuIExhenlib25lcy5zeW5jLmNhbGwodGhpcywgbWV0aG9kLCBtb2RlbCwgb3B0aW9ucyk7XG5cdFx0fVxuXHR9IH07XG59XG5cbnZhciBtZXRob2RNYXAgPSB7XG5cdGNyZWF0ZTogXCJwb3N0XCIsXG5cdHVwZGF0ZTogXCJwdXRcIixcblx0cGF0Y2g6IFwicHV0XCIsXG5cdGRlbGV0ZTogXCJyZW1vdmVcIlxufTtcblxuLyogIyMgT3B0aW9ucyAmIERlZmF1bHRzXG4gKlxuICogVGhlc2UgYXJlIHRoZSBkZWZhdWx0IG9wdGlvbnMgdXNlZCBieSBMYXp5Ym9uZXMuIE1vZGlmeSB0aGlzIHZhcmlhYmxlIHRvIGNoYW5nZSB0aGUgZGVmYXVsdCBvcHRpb25zIGdsb2JhbGx5LlxuICovXG5MYXp5Ym9uZXMuZGVmYXVsdHMgPSB7XG5cdHN1Y2Nlc3M6IG5vb3AsXG5cdGVycm9yOiBub29wLFxuXG5cdC8qICMjIyMgb3B0aW9ucy5jaGFuZ2VzXG5cdCAqXG5cdCAqIFRoaXMgcHJvcGVydHkgZGV0ZXJtaW5lcyBpZiBzeW5jIHVzZXMgdGhlIGNoYW5nZXMgZmVlZCB3aGVuIGZldGNoaW5nIGRhdGEuIFRoaXMgZm9yY2VzIHN5bmMgaW50byBhbiBhbHRlcm5hdGUgbW9kZSB0aGF0IGF2b2lkcyBCYWNrYm9uZSdzIGBzdWNjZXNzYCBhbmQgYGVycm9yYCBjYWxsYmFja3MgYW5kIHVwZGF0ZXMgdGhlXG5cdCAqL1xuXHRjaGFuZ2VzOiBmYWxzZSxcblxuXHQvKiAjIyMjIG9wdGlvbnMucXVlcnlcblx0ICpcblx0ICogVGhpcyBwcm9wZXJ0eSBjYW4gYmUgYSBtYXAgZnVuY3Rpb24gb3IgdGhlIGlkIG9mIGEgdmlldy4gVGhpcyBpcyB3aGF0IGdldHMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byBgZGIucXVlcnkoKWAuXG5cdCAqL1xuXHRxdWVyeTogbnVsbCxcblxuXHQvKiAjIyMjIG9wdGlvbnMucm93S2V5XG5cdCAqXG5cdCAqIFRoZSBrZXkgdG8gZXh0cmFjdCBmcm9tIHZpZXcgcm93cyBvbiBxdWVyeSBmZXRjaGVzLlxuXHQgKi9cblx0cm93S2V5OiBcImRvY1wiLFxuXG5cdC8qICMjIyMgb3B0aW9ucy5vcHRpb25zXG5cdCAqXG5cdCAqIFRoZXNlIGFyZSBzcGVjaWZpYyBvcHRpb25zIGZvciBlYWNoIFBvdWNoREIgbWV0aG9kLlxuXHQgKi9cblx0b3B0aW9uczoge1xuXHRcdGdldDoge30sXG5cdFx0cXVlcnk6IHsgaW5jbHVkZV9kb2NzOiB0cnVlLCByZXR1cm5Eb2NzOiBmYWxzZSB9LFxuXHRcdGFsbERvY3M6IHsgaW5jbHVkZV9kb2NzOiB0cnVlIH0sXG5cdFx0Y2hhbmdlczogeyByZXR1cm5Eb2NzOiBmYWxzZSB9XG5cdH0sXG5cblx0LyogIyMjIyBvcHRpb25zLmZldGNoKClcblx0ICpcblx0ICogVGhpcyBtZXRob2QgY29udHJvbHMgaG93IHRoZSBzeW5jIGZ1bmN0aW9uIHdpbGwgZmV0Y2ggZGF0YS4gVGhlIG1ldGhvZCBjdXJyZW50bHkgaGFuZGxlcyBub3JtYWwgZ2V0cyBhbmQgcXVlcmllcy5cblx0ICovXG5cdGZldGNoOiBmdW5jdGlvbihtb2RlbCwgZGIsIG9wdGlvbnMpIHtcblx0XHQvLyBhIHNpbmdsZSBtb2RlbFxuXHRcdGlmICghaXNDb2xsZWN0aW9uKG1vZGVsKSkgcmV0dXJuIGRiLmdldChtb2RlbC5pZCwgb3B0aW9ucy5vcHRpb25zLmdldCk7XG5cblx0XHQvLyBwcm9jZXNzIHF1ZXJ5IHJlcXVlc3RzXG5cdFx0aWYgKG9wdGlvbnMucXVlcnkpIHJldHVybiBkYi5xdWVyeShvcHRpb25zLnF1ZXJ5LCBvcHRpb25zLm9wdGlvbnMucXVlcnkpO1xuXG5cdFx0Ly8gcmVndWxhciBjb2xsZWN0aW9uIGZldGNoXG5cdFx0cmV0dXJuIGRiLmFsbERvY3Mob3B0aW9ucy5vcHRpb25zLmFsbERvY3MpO1xuXHR9LFxuXG5cdC8qICMjIyMgb3B0aW9ucy5wcm9jZXNzKClcblx0ICpcblx0ICogVGhpcyBtZXRob2QgcGFyc2VzIHRoZSByZXN1bHQgZnJvbSBQb3VjaERCIGJlZm9yZSBzZW5kaW5nIGl0IHRvIEJhY2tib25lLlxuXHQgKi9cblx0cHJvY2VzczogZnVuY3Rpb24ocmVzLCBtZXRob2QsIG1vZGVsLCBvcHRpb25zKSB7XG5cdFx0Ly8gcGFyc2Ugbm9uLWRvY3VtZW50IHJlc3BvbnNlc1xuXHRcdGlmIChyZXMuX2lkID09IG51bGwgJiYgcmVzLl9yZXYgPT0gbnVsbCkge1xuXHRcdFx0Ly8gd3JpdGUgcmVzdWx0XG5cdFx0XHRpZiAobWV0aG9kICE9PSBcInJlYWRcIikgcmV0dXJuIHsgX2lkOiByZXMuaWQsIF9yZXY6IHJlcy5yZXYgfTtcblxuXHRcdFx0Ly8gdmlldyByZXN1bHRcblx0XHRcdGlmIChyZXMucm93cyAhPSBudWxsKSB7XG5cdFx0XHRcdGlmIChpc0NvbGxlY3Rpb24obW9kZWwpKSByZXR1cm4gcmVzLnJvd3MubWFwKGZ1bmN0aW9uKHJvdykge1xuXHRcdFx0XHRcdHJldHVybiByb3dbb3B0aW9ucy5yb3dLZXldO1xuXHRcdFx0XHR9KTtcblxuXHRcdFx0XHQvLyBncmFiIGp1c3QgdGhlIGZpcnN0IHJvdyBmb3IgbW9kZWxzXG5cdFx0XHRcdHJldHVybiByZXMucm93cy5sZW5ndGggPyByZXMucm93c1swXVtvcHRpb25zLnJvd0tleV0gOiBudWxsO1xuXHRcdFx0fVxuXG5cdFx0XHQvLyBjaGFuZ2VzIGZlZWQgcmVzdWx0XG5cdFx0XHRpZiAocmVzW29wdGlvbnMucm93S2V5XSAhPSBudWxsKSByZXR1cm4gcmVzW29wdGlvbnMucm93S2V5XTtcblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzO1xuXHR9XG59O1xuXG4vKiAjIyBTeW5jXG4gKlxuICogVGhpcyBpcyB0aGUgaGVhcnQgb2YgTGF6eWJvbmVzLiBVc2UgaXQgd2hlcmV2ZXIgYEJhY2tib25lLnN5bmNgIGlzIHVzZWQuXG4gKi9cbkxhenlib25lcy5zeW5jID0gZnVuY3Rpb24obWV0aG9kLCBtb2RlbCwgb3B0aW9ucykge1xuXHR2YXIgc2VsZiwgZGJNZXRob2QsIGRiLCBvbkNoYW5nZSwgcHJvbWlzZSwgY2hnb3B0cywgY2hnZmlsdGVyLCBwcm9jZXNzZWQsIHByb2Nlc3NQcm9taXNlO1xuXG5cdC8vIHJlc29sdmUgbWV0aG9kIGFuZCBkYXRhYmFzZVxuXHRzZWxmID0gdGhpcztcblx0b3B0aW9ucyA9IG1lcmdlLmRlZmF1bHRzKHt9LCBvcHRpb25zLCBnZXRTeW5jT3B0aW9ucyhtb2RlbCksIGdldFN5bmNPcHRpb25zKG1vZGVsLmNvbGxlY3Rpb24pLCBMYXp5Ym9uZXMuZGVmYXVsdHMpO1xuXHRtZXRob2QgPSBtZXRob2QudG9Mb3dlckNhc2UoKS50cmltKCk7XG5cdGRiID0gZ2V0RGF0YWJhc2Uob3B0aW9ucykgfHwgZ2V0RGF0YWJhc2UobW9kZWwpO1xuXHRpZiAoZGIgPT0gbnVsbCkgdGhyb3cgbmV3IEVycm9yKFwiTWlzc2luZyBQb3VjaERCIGRhdGFiYXNlLlwiKTtcblxuXHQvLyBkZWFsIHdpdGggd3JpdGVzXG5cdGlmIChtZXRob2QgIT09IFwicmVhZFwiKSB7XG5cdFx0cHJvbWlzZSA9IGRiW21ldGhvZE1hcFttZXRob2RdXShtb2RlbC50b0pTT04oKSwgb3B0aW9ucy5vcHRpb25zW21ldGhvZE1hcFttZXRob2RdXSk7XG5cdH1cblxuXHQvLyBkZWFsIHdpdGggbm9ybWFsIHJlYWRzXG5cdGVsc2UgaWYgKCFvcHRpb25zLmNoYW5nZXMpIHtcblx0XHRwcm9taXNlID0gb3B0aW9ucy5mZXRjaC5jYWxsKHNlbGYsIG1vZGVsLCBkYiwgb3B0aW9ucyk7XG5cdFx0aWYgKHByb21pc2UgPT0gbnVsbCB8fCB0eXBlb2YgcHJvbWlzZS50aGVuICE9PSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUocHJvbWlzZSk7XG5cdFx0fVxuXHR9XG5cblx0Ly8gZGVhbCB3aXRoIGNoYW5nZXMgZmVlZCByZWFkc1xuXHRlbHNlIHtcblx0XHRjaGdvcHRzID0gbWVyZ2UuZGVmYXVsdHMoe1xuXHRcdFx0aW5jbHVkZV9kb2NzOiB0cnVlXG5cdFx0fSwgb3B0aW9ucy5jaGFuZ2VzLCBvcHRpb25zLm9wdGlvbnMuY2hhbmdlcyk7XG5cblx0XHRpZiAodHlwZW9mIGNoZ29wdHMuZmlsdGVyID09PSBcImZ1bmN0aW9uXCIpIHtcblx0XHRcdGNoZ2ZpbHRlciA9IGNoZ29wdHMuZmlsdGVyO1xuXHRcdFx0Y2hnb3B0cy5maWx0ZXIgPSBudWxsO1xuXHRcdH1cblxuXHRcdHByb21pc2UgPSBkYi5jaGFuZ2VzKGNoZ29wdHMpO1xuXG5cdFx0b25DaGFuZ2UgPSBmdW5jdGlvbihyb3cpIHtcblx0XHRcdHZhciB2YWwgPSBvcHRpb25zLnByb2Nlc3MuY2FsbChzZWxmLCByb3csIG1ldGhvZCwgbW9kZWwsIG9wdGlvbnMpO1xuXHRcdFx0aWYgKGNoZ2ZpbHRlciAmJiAhY2hnZmlsdGVyKHZhbCwgcm93LCBvcHRpb25zKSkgcmV0dXJuO1xuXHRcdFx0bW9kZWwuc2V0KHZhbCwgbWVyZ2UuZXh0ZW5kKHsgcmVtb3ZlOiBmYWxzZSB9LCBvcHRpb25zKSk7XG5cdFx0fVxuXG5cdFx0cHJvbWlzZS5vbihcImNyZWF0ZVwiLCBvbkNoYW5nZSk7XG5cdFx0cHJvbWlzZS5vbihcInVwZGF0ZVwiLCBvbkNoYW5nZSk7XG5cblx0XHRwcm9taXNlLm9uKFwiZGVsZXRlXCIsIGZ1bmN0aW9uKHJvdykge1xuXHRcdFx0dmFyIG0gPSAhaXNDb2xsZWN0aW9uKG1vZGVsKSA/IG1vZGVsIDogbW9kZWwucmVtb3ZlKHJvdy5pZCwgb3B0aW9ucyk7XG5cblx0XHRcdGlmIChtKSB7XG5cdFx0XHRcdHZhciB2YWwgPSBvcHRpb25zLnByb2Nlc3MuY2FsbChzZWxmLCByb3csIG1ldGhvZCwgbW9kZWwsIG9wdGlvbnMpO1xuXHRcdFx0XHRtLnNldCh2YWwsIG9wdGlvbnMpO1xuXHRcdFx0fVxuXHRcdH0pO1xuXG5cdFx0Ly8gcmV0dXJuIHRoZSBjaGFuZ2VzIG9iamVjdCBpbW1lZGlhdGVseVxuXHRcdHJldHVybiBwcm9taXNlO1xuXHR9XG5cblx0Ly8gdHJpZ2dlciB0aGUgcmVxdWVzdCBldmVudFxuXHRtb2RlbC50cmlnZ2VyKCdyZXF1ZXN0JywgbW9kZWwsIGRiLCBvcHRpb25zKTtcblxuXHQvLyBwcm9jZXNzIHRoZSByZXN1bHQgaW50byBzb21ldGhpbmcgdGhhdCBiYWNrYm9uZSBjYW4gdXNlXG5cdC8vIGFuZCBzaGlwIHJlc3VsdCB0byBzdWNjZXNzIGFuZCBlcnJvciBjYWxsYmFja3Ncblx0cmV0dXJuIHByb21pc2UudGhlbihmdW5jdGlvbihyZXMpIHtcblx0XHRvcHRpb25zLnN1Y2Nlc3Mob3B0aW9ucy5wcm9jZXNzLmNhbGwoc2VsZiwgcmVzLCBtZXRob2QsIG1vZGVsLCBvcHRpb25zKSk7XG5cdFx0cmV0dXJuIHJlcztcblx0fSkuY2F0Y2goZnVuY3Rpb24oZXJyKSB7XG5cdFx0b3B0aW9ucy5lcnJvcihlcnIpO1xuXHRcdHRocm93IGVycjtcblx0fSk7XG59XG5cbnZhciBpc0NvbGxlY3Rpb24gPVxuTGF6eWJvbmVzLmlzQ29sbGVjdGlvbiA9IGZ1bmN0aW9uKHYpIHtcblx0cmV0dXJuIHYgIT0gbnVsbCAmJlxuXHRcdEFycmF5LmlzQXJyYXkodi5tb2RlbHMpICYmXG5cdFx0dHlwZW9mIHYubW9kZWwgPT09IFwiZnVuY3Rpb25cIiAmJlxuXHRcdHR5cGVvZiB2LmFkZCA9PT0gXCJmdW5jdGlvblwiICYmXG5cdFx0dHlwZW9mIHYucmVtb3ZlID09PSBcImZ1bmN0aW9uXCI7XG59XG5cbkxhenlib25lcy5pc01vZGVsID0gZnVuY3Rpb24odmFsKSB7XG5cdHJldHVybiB2YWwgIT0gbnVsbCAmJlxuXHRcdHR5cGVvZiB2YWwuY2lkID09PSBcInN0cmluZ1wiICYmXG5cdFx0dHlwZW9mIHZhbC5hdHRyaWJ1dGVzID09PSBcIm9iamVjdFwiICYmXG5cdFx0dHlwZW9mIHZhbC5nZXQgPT09IFwiZnVuY3Rpb25cIiAmJlxuXHRcdHR5cGVvZiB2YWwuc2V0ID09PSBcImZ1bmN0aW9uXCI7XG59XG5cbmZ1bmN0aW9uIGdldFN5bmNPcHRpb25zKG0pIHtcblx0cmV0dXJuIG0gJiYgbG9va3VwKG0sIFtcInN5bmNPcHRpb25zXCIsXCJzeW5jX29wdGlvbnNcIl0pO1xufVxuXG5mdW5jdGlvbiBnZXREYXRhYmFzZShtKSB7XG5cdHJldHVybiBtICYmIChsb29rdXAobSwgW1wicG91Y2hcIixcInBvdWNoZGJcIixcImRiXCIsXCJkYXRhYmFzZVwiXSkgfHwgZ2V0RGF0YWJhc2UobS5jb2xsZWN0aW9uKSk7XG59XG5cbmZ1bmN0aW9uIGxvb2t1cChvLCBrZXlzKSB7XG5cdHZhciB2LCBpO1xuXHRmb3IgKGkgaW4ga2V5cykge1xuXHRcdHYgPSBvW2tleXNbaV1dO1xuXHRcdGlmICh0eXBlb2YgdiA9PT0gXCJmdW5jdGlvblwiKSB7XG5cdFx0XHRyZXR1cm4gdi5jYWxsKG8sIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMikpO1xuXHRcdH1cblx0XHRpZiAodHlwZW9mIHYgIT09IFwidW5kZWZpbmVkXCIpIHJldHVybiB2O1xuXHR9XG59XG4iLG51bGwsInZhciBpc09iamVjdCA9IHJlcXVpcmUoXCJpcy1wbGFpbi1vYmplY3RcIik7XG52YXIgaGFzT3duID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcblxudmFyIG1lcmdlID0gbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvYmosIHZhbCwgc2FmZSkge1xuXHRpZiAoaXNPYmplY3Qob2JqKSAmJiBpc09iamVjdCh2YWwpKSB7XG5cdFx0Zm9yICh2YXIgayBpbiB2YWwpIHtcblx0XHRcdGlmIChoYXNPd24uY2FsbCh2YWwsIGspKSBvYmpba10gPSBtZXJnZShvYmpba10sIHZhbFtrXSwgc2FmZSk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIG9iajtcblx0fVxuXG5cdHJldHVybiBzYWZlICYmIHR5cGVvZiBvYmogIT09IFwidW5kZWZpbmVkXCIgPyBvYmogOiB2YWw7XG59XG5cbi8vIGtlZXBpbmcgaXQgRFJZXG5mdW5jdGlvbiBtZXJnZUFsbChzYWZlLCBvYmopIHtcblx0dmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG5cdGZvciAodmFyIGkgPSAwOyBpIDwgYXJncy5sZW5ndGg7IGkrKykge1xuXHRcdG9iaiA9IG1lcmdlKG9iaiwgYXJnc1tpXSwgc2FmZSk7XG5cdH1cblx0cmV0dXJuIG9iajtcbn1cblxubWVyZ2UuZXh0ZW5kID0gbWVyZ2VBbGwuYmluZChudWxsLCBmYWxzZSk7XG5tZXJnZS5kZWZhdWx0cyA9IG1lcmdlQWxsLmJpbmQobnVsbCwgdHJ1ZSk7XG4iLCIvKiFcbiAqIGlzLXBsYWluLW9iamVjdCA8aHR0cHM6Ly9naXRodWIuY29tL2pvbnNjaGxpbmtlcnQvaXMtcGxhaW4tb2JqZWN0PlxuICpcbiAqIENvcHlyaWdodCAoYykgMjAxNC0yMDE1LCBKb24gU2NobGlua2VydC5cbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgTGljZW5zZS5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBpc09iamVjdCA9IHJlcXVpcmUoJ2lzb2JqZWN0Jyk7XG5cbmZ1bmN0aW9uIGlzT2JqZWN0T2JqZWN0KG8pIHtcbiAgcmV0dXJuIGlzT2JqZWN0KG8pID09PSB0cnVlXG4gICAgJiYgT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG8pID09PSAnW29iamVjdCBPYmplY3RdJztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpc1BsYWluT2JqZWN0KG8pIHtcbiAgdmFyIGN0b3IscHJvdDtcbiAgXG4gIGlmIChpc09iamVjdE9iamVjdChvKSA9PT0gZmFsc2UpIHJldHVybiBmYWxzZTtcbiAgXG4gIC8vIElmIGhhcyBtb2RpZmllZCBjb25zdHJ1Y3RvclxuICBjdG9yID0gby5jb25zdHJ1Y3RvcjtcbiAgaWYgKHR5cGVvZiBjdG9yICE9PSAnZnVuY3Rpb24nKSByZXR1cm4gZmFsc2U7XG4gIFxuICAvLyBJZiBoYXMgbW9kaWZpZWQgcHJvdG90eXBlXG4gIHByb3QgPSBjdG9yLnByb3RvdHlwZTtcbiAgaWYgKGlzT2JqZWN0T2JqZWN0KHByb3QpID09PSBmYWxzZSkgcmV0dXJuIGZhbHNlO1xuICBcbiAgLy8gSWYgY29uc3RydWN0b3IgZG9lcyBub3QgaGF2ZSBhbiBPYmplY3Qtc3BlY2lmaWMgbWV0aG9kXG4gIGlmIChwcm90Lmhhc093blByb3BlcnR5KCdpc1Byb3RvdHlwZU9mJykgPT09IGZhbHNlKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIFxuICAvLyBNb3N0IGxpa2VseSBhIHBsYWluIE9iamVjdFxuICByZXR1cm4gdHJ1ZTtcbn07XG4iLCIvKiFcbiAqIGlzb2JqZWN0IDxodHRwczovL2dpdGh1Yi5jb20vam9uc2NobGlua2VydC9pc29iamVjdD5cbiAqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTQtMjAxNSwgSm9uIFNjaGxpbmtlcnQuXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgTUlUIExpY2Vuc2UuXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGlzT2JqZWN0KG8pIHtcbiAgcmV0dXJuIG8gIT0gbnVsbCAmJiB0eXBlb2YgbyA9PT0gJ29iamVjdCdcbiAgICAmJiAhQXJyYXkuaXNBcnJheShvKTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG4vLyBhbGxvdyBleHRlcm5hbCBwbHVnaW5zIHRvIHJlcXVpcmUoJ3BvdWNoZGIvZXh0cmFzL3Byb21pc2UnKVxubW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuLi9saWIvZGVwcy9wcm9taXNlJyk7IiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbnZhciBpbmhlcml0cyA9IHJlcXVpcmUoJ2luaGVyaXRzJyk7XG5pbmhlcml0cyhQb3VjaEVycm9yLCBFcnJvcik7XG5cbmZ1bmN0aW9uIFBvdWNoRXJyb3Iob3B0cykge1xuICBFcnJvci5jYWxsKG9wdHMucmVhc29uKTtcbiAgdGhpcy5zdGF0dXMgPSBvcHRzLnN0YXR1cztcbiAgdGhpcy5uYW1lID0gb3B0cy5lcnJvcjtcbiAgdGhpcy5tZXNzYWdlID0gb3B0cy5yZWFzb247XG4gIHRoaXMuZXJyb3IgPSB0cnVlO1xufVxuXG5Qb3VjaEVycm9yLnByb3RvdHlwZS50b1N0cmluZyA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHtcbiAgICBzdGF0dXM6IHRoaXMuc3RhdHVzLFxuICAgIG5hbWU6IHRoaXMubmFtZSxcbiAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2VcbiAgfSk7XG59O1xuXG5leHBvcnRzLlVOQVVUSE9SSVpFRCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDEsXG4gIGVycm9yOiAndW5hdXRob3JpemVkJyxcbiAgcmVhc29uOiBcIk5hbWUgb3IgcGFzc3dvcmQgaXMgaW5jb3JyZWN0LlwiXG59KTtcblxuZXhwb3J0cy5NSVNTSU5HX0JVTEtfRE9DUyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246IFwiTWlzc2luZyBKU09OIGxpc3Qgb2YgJ2RvY3MnXCJcbn0pO1xuXG5leHBvcnRzLk1JU1NJTkdfRE9DID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwNCxcbiAgZXJyb3I6ICdub3RfZm91bmQnLFxuICByZWFzb246ICdtaXNzaW5nJ1xufSk7XG5cbmV4cG9ydHMuUkVWX0NPTkZMSUNUID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwOSxcbiAgZXJyb3I6ICdjb25mbGljdCcsXG4gIHJlYXNvbjogJ0RvY3VtZW50IHVwZGF0ZSBjb25mbGljdCdcbn0pO1xuXG5leHBvcnRzLklOVkFMSURfSUQgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ2ludmFsaWRfaWQnLFxuICByZWFzb246ICdfaWQgZmllbGQgbXVzdCBjb250YWluIGEgc3RyaW5nJ1xufSk7XG5cbmV4cG9ydHMuTUlTU0lOR19JRCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MTIsXG4gIGVycm9yOiAnbWlzc2luZ19pZCcsXG4gIHJlYXNvbjogJ19pZCBpcyByZXF1aXJlZCBmb3IgcHV0cydcbn0pO1xuXG5leHBvcnRzLlJFU0VSVkVEX0lEID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdiYWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogJ09ubHkgcmVzZXJ2ZWQgZG9jdW1lbnQgaWRzIG1heSBzdGFydCB3aXRoIHVuZGVyc2NvcmUuJ1xufSk7XG5cbmV4cG9ydHMuTk9UX09QRU4gPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDEyLFxuICBlcnJvcjogJ3ByZWNvbmRpdGlvbl9mYWlsZWQnLFxuICByZWFzb246ICdEYXRhYmFzZSBub3Qgb3Blbidcbn0pO1xuXG5leHBvcnRzLlVOS05PV05fRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ3Vua25vd25fZXJyb3InLFxuICByZWFzb246ICdEYXRhYmFzZSBlbmNvdW50ZXJlZCBhbiB1bmtub3duIGVycm9yJ1xufSk7XG5cbmV4cG9ydHMuQkFEX0FSRyA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnYmFkYXJnJyxcbiAgcmVhc29uOiAnU29tZSBxdWVyeSBhcmd1bWVudCBpcyBpbnZhbGlkJ1xufSk7XG5cbmV4cG9ydHMuSU5WQUxJRF9SRVFVRVNUID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdpbnZhbGlkX3JlcXVlc3QnLFxuICByZWFzb246ICdSZXF1ZXN0IHdhcyBpbnZhbGlkJ1xufSk7XG5cbmV4cG9ydHMuUVVFUllfUEFSU0VfRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNDAwLFxuICBlcnJvcjogJ3F1ZXJ5X3BhcnNlX2Vycm9yJyxcbiAgcmVhc29uOiAnU29tZSBxdWVyeSBwYXJhbWV0ZXIgaXMgaW52YWxpZCdcbn0pO1xuXG5leHBvcnRzLkRPQ19WQUxJREFUSU9OID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICdkb2NfdmFsaWRhdGlvbicsXG4gIHJlYXNvbjogJ0JhZCBzcGVjaWFsIGRvY3VtZW50IG1lbWJlcidcbn0pO1xuXG5leHBvcnRzLkJBRF9SRVFVRVNUID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdiYWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogJ1NvbWV0aGluZyB3cm9uZyB3aXRoIHRoZSByZXF1ZXN0J1xufSk7XG5cbmV4cG9ydHMuTk9UX0FOX09CSkVDVCA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDAsXG4gIGVycm9yOiAnYmFkX3JlcXVlc3QnLFxuICByZWFzb246ICdEb2N1bWVudCBtdXN0IGJlIGEgSlNPTiBvYmplY3QnXG59KTtcblxuZXhwb3J0cy5EQl9NSVNTSU5HID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwNCxcbiAgZXJyb3I6ICdub3RfZm91bmQnLFxuICByZWFzb246ICdEYXRhYmFzZSBub3QgZm91bmQnXG59KTtcblxuZXhwb3J0cy5JREJfRVJST1IgPSBuZXcgUG91Y2hFcnJvcih7XG4gIHN0YXR1czogNTAwLFxuICBlcnJvcjogJ2luZGV4ZWRfZGJfd2VudF9iYWQnLFxuICByZWFzb246ICd1bmtub3duJ1xufSk7XG5cbmV4cG9ydHMuV1NRX0VSUk9SID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDUwMCxcbiAgZXJyb3I6ICd3ZWJfc3FsX3dlbnRfYmFkJyxcbiAgcmVhc29uOiAndW5rbm93bidcbn0pO1xuXG5leHBvcnRzLkxEQl9FUlJPUiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA1MDAsXG4gIGVycm9yOiAnbGV2ZWxEQl93ZW50X3dlbnRfYmFkJyxcbiAgcmVhc29uOiAndW5rbm93bidcbn0pO1xuXG5leHBvcnRzLkZPUkJJRERFTiA9IG5ldyBQb3VjaEVycm9yKHtcbiAgc3RhdHVzOiA0MDMsXG4gIGVycm9yOiAnZm9yYmlkZGVuJyxcbiAgcmVhc29uOiAnRm9yYmlkZGVuIGJ5IGRlc2lnbiBkb2MgdmFsaWRhdGVfZG9jX3VwZGF0ZSBmdW5jdGlvbidcbn0pO1xuXG5leHBvcnRzLklOVkFMSURfUkVWID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQwMCxcbiAgZXJyb3I6ICdiYWRfcmVxdWVzdCcsXG4gIHJlYXNvbjogJ0ludmFsaWQgcmV2IGZvcm1hdCdcbn0pO1xuXG5leHBvcnRzLkZJTEVfRVhJU1RTID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQxMixcbiAgZXJyb3I6ICdmaWxlX2V4aXN0cycsXG4gIHJlYXNvbjogJ1RoZSBkYXRhYmFzZSBjb3VsZCBub3QgYmUgY3JlYXRlZCwgdGhlIGZpbGUgYWxyZWFkeSBleGlzdHMuJ1xufSk7XG5cbmV4cG9ydHMuTUlTU0lOR19TVFVCID0gbmV3IFBvdWNoRXJyb3Ioe1xuICBzdGF0dXM6IDQxMixcbiAgZXJyb3I6ICdtaXNzaW5nX3N0dWInXG59KTtcblxuZXhwb3J0cy5lcnJvciA9IGZ1bmN0aW9uIChlcnJvciwgcmVhc29uLCBuYW1lKSB7XG4gIGZ1bmN0aW9uIEN1c3RvbVBvdWNoRXJyb3IocmVhc29uKSB7XG4gICAgLy8gaW5oZXJpdCBlcnJvciBwcm9wZXJ0aWVzIGZyb20gb3VyIHBhcmVudCBlcnJvciBtYW51YWxseVxuICAgIC8vIHNvIGFzIHRvIGFsbG93IHByb3BlciBKU09OIHBhcnNpbmcuXG4gICAgLyoganNoaW50IGlnbm9yZTpzdGFydCAqL1xuICAgIGZvciAodmFyIHAgaW4gZXJyb3IpIHtcbiAgICAgIGlmICh0eXBlb2YgZXJyb3JbcF0gIT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgdGhpc1twXSA9IGVycm9yW3BdO1xuICAgICAgfVxuICAgIH1cbiAgICAvKiBqc2hpbnQgaWdub3JlOmVuZCAqL1xuICAgIGlmIChuYW1lICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgfVxuICAgIGlmIChyZWFzb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5yZWFzb24gPSByZWFzb247XG4gICAgfVxuICB9XG4gIEN1c3RvbVBvdWNoRXJyb3IucHJvdG90eXBlID0gUG91Y2hFcnJvci5wcm90b3R5cGU7XG4gIHJldHVybiBuZXcgQ3VzdG9tUG91Y2hFcnJvcihyZWFzb24pO1xufTtcblxuLy8gRmluZCBvbmUgb2YgdGhlIGVycm9ycyBkZWZpbmVkIGFib3ZlIGJhc2VkIG9uIHRoZSB2YWx1ZVxuLy8gb2YgdGhlIHNwZWNpZmllZCBwcm9wZXJ0eS5cbi8vIElmIHJlYXNvbiBpcyBwcm92aWRlZCBwcmVmZXIgdGhlIGVycm9yIG1hdGNoaW5nIHRoYXQgcmVhc29uLlxuLy8gVGhpcyBpcyBmb3IgZGlmZmVyZW50aWF0aW5nIGJldHdlZW4gZXJyb3JzIHdpdGggdGhlIHNhbWUgbmFtZSBhbmQgc3RhdHVzLFxuLy8gZWcsIGJhZF9yZXF1ZXN0LlxuZXhwb3J0cy5nZXRFcnJvclR5cGVCeVByb3AgPSBmdW5jdGlvbiAocHJvcCwgdmFsdWUsIHJlYXNvbikge1xuICB2YXIgZXJyb3JzID0gZXhwb3J0cztcbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhlcnJvcnMpLmZpbHRlcihmdW5jdGlvbiAoa2V5KSB7XG4gICAgdmFyIGVycm9yID0gZXJyb3JzW2tleV07XG4gICAgcmV0dXJuIHR5cGVvZiBlcnJvciAhPT0gJ2Z1bmN0aW9uJyAmJiBlcnJvcltwcm9wXSA9PT0gdmFsdWU7XG4gIH0pO1xuICB2YXIga2V5ID0gcmVhc29uICYmIGtleXMuZmlsdGVyKGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgdmFyIGVycm9yID0gZXJyb3JzW2tleV07XG4gICAgICAgIHJldHVybiBlcnJvci5tZXNzYWdlID09PSByZWFzb247XG4gICAgICB9KVswXSB8fCBrZXlzWzBdO1xuICByZXR1cm4gKGtleSkgPyBlcnJvcnNba2V5XSA6IG51bGw7XG59O1xuXG5leHBvcnRzLmdlbmVyYXRlRXJyb3JGcm9tUmVzcG9uc2UgPSBmdW5jdGlvbiAocmVzKSB7XG4gIHZhciBlcnJvciwgZXJyTmFtZSwgZXJyVHlwZSwgZXJyTXNnLCBlcnJSZWFzb247XG4gIHZhciBlcnJvcnMgPSBleHBvcnRzO1xuXG4gIGVyck5hbWUgPSAocmVzLmVycm9yID09PSB0cnVlICYmIHR5cGVvZiByZXMubmFtZSA9PT0gJ3N0cmluZycpID9cbiAgICAgICAgICAgICAgcmVzLm5hbWUgOlxuICAgICAgICAgICAgICByZXMuZXJyb3I7XG4gIGVyclJlYXNvbiA9IHJlcy5yZWFzb247XG4gIGVyclR5cGUgPSBlcnJvcnMuZ2V0RXJyb3JUeXBlQnlQcm9wKCduYW1lJywgZXJyTmFtZSwgZXJyUmVhc29uKTtcblxuICBpZiAocmVzLm1pc3NpbmcgfHxcbiAgICAgIGVyclJlYXNvbiA9PT0gJ21pc3NpbmcnIHx8XG4gICAgICBlcnJSZWFzb24gPT09ICdkZWxldGVkJyB8fFxuICAgICAgZXJyTmFtZSA9PT0gJ25vdF9mb3VuZCcpIHtcbiAgICBlcnJUeXBlID0gZXJyb3JzLk1JU1NJTkdfRE9DO1xuICB9IGVsc2UgaWYgKGVyck5hbWUgPT09ICdkb2NfdmFsaWRhdGlvbicpIHtcbiAgICAvLyBkb2MgdmFsaWRhdGlvbiBuZWVkcyBzcGVjaWFsIHRyZWF0bWVudCBzaW5jZVxuICAgIC8vIHJlcy5yZWFzb24gZGVwZW5kcyBvbiB0aGUgdmFsaWRhdGlvbiBlcnJvci5cbiAgICAvLyBzZWUgdXRpbHMuanNcbiAgICBlcnJUeXBlID0gZXJyb3JzLkRPQ19WQUxJREFUSU9OO1xuICAgIGVyck1zZyA9IGVyclJlYXNvbjtcbiAgfSBlbHNlIGlmIChlcnJOYW1lID09PSAnYmFkX3JlcXVlc3QnICYmIGVyclR5cGUubWVzc2FnZSAhPT0gZXJyUmVhc29uKSB7XG4gICAgLy8gaWYgYmFkX3JlcXVlc3QgZXJyb3IgYWxyZWFkeSBmb3VuZCBiYXNlZCBvbiByZWFzb24gZG9uJ3Qgb3ZlcnJpZGUuXG5cbiAgICAvLyBhdHRhY2htZW50IGVycm9ycy5cbiAgICBpZiAoZXJyUmVhc29uLmluZGV4T2YoJ3Vua25vd24gc3R1YiBhdHRhY2htZW50JykgPT09IDApIHtcbiAgICAgIGVyclR5cGUgPSBlcnJvcnMuTUlTU0lOR19TVFVCO1xuICAgICAgZXJyTXNnID0gZXJyUmVhc29uO1xuICAgIH0gZWxzZSB7XG4gICAgICBlcnJUeXBlID0gZXJyb3JzLkJBRF9SRVFVRVNUO1xuICAgIH1cbiAgfVxuXG4gIC8vIGZhbGxiYWNrIHRvIGVycm9yIGJ5IHN0YXR5cyBvciB1bmtub3duIGVycm9yLlxuICBpZiAoIWVyclR5cGUpIHtcbiAgICBlcnJUeXBlID0gZXJyb3JzLmdldEVycm9yVHlwZUJ5UHJvcCgnc3RhdHVzJywgcmVzLnN0YXR1cywgZXJyUmVhc29uKSB8fFxuICAgICAgICAgICAgICAgIGVycm9ycy5VTktOT1dOX0VSUk9SO1xuICB9XG5cbiAgZXJyb3IgPSBlcnJvcnMuZXJyb3IoZXJyVHlwZSwgZXJyUmVhc29uLCBlcnJOYW1lKTtcblxuICAvLyBLZWVwIGN1c3RvbSBtZXNzYWdlLlxuICBpZiAoZXJyTXNnKSB7XG4gICAgZXJyb3IubWVzc2FnZSA9IGVyck1zZztcbiAgfVxuXG4gIC8vIEtlZXAgaGVscGZ1bCByZXNwb25zZSBkYXRhIGluIG91ciBlcnJvciBtZXNzYWdlcy5cbiAgaWYgKHJlcy5pZCkge1xuICAgIGVycm9yLmlkID0gcmVzLmlkO1xuICB9XG4gIGlmIChyZXMuc3RhdHVzKSB7XG4gICAgZXJyb3Iuc3RhdHVzID0gcmVzLnN0YXR1cztcbiAgfVxuICBpZiAocmVzLnN0YXR1c1RleHQpIHtcbiAgICBlcnJvci5uYW1lID0gcmVzLnN0YXR1c1RleHQ7XG4gIH1cbiAgaWYgKHJlcy5taXNzaW5nKSB7XG4gICAgZXJyb3IubWlzc2luZyA9IHJlcy5taXNzaW5nO1xuICB9XG5cbiAgcmV0dXJuIGVycm9yO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuaWYgKHR5cGVvZiBQcm9taXNlID09PSAnZnVuY3Rpb24nKSB7XG4gIG1vZHVsZS5leHBvcnRzID0gUHJvbWlzZTtcbn0gZWxzZSB7XG4gIG1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnYmx1ZWJpcmQnKTtcbn0iLCJpZiAodHlwZW9mIE9iamVjdC5jcmVhdGUgPT09ICdmdW5jdGlvbicpIHtcbiAgLy8gaW1wbGVtZW50YXRpb24gZnJvbSBzdGFuZGFyZCBub2RlLmpzICd1dGlsJyBtb2R1bGVcbiAgbW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBpbmhlcml0cyhjdG9yLCBzdXBlckN0b3IpIHtcbiAgICBjdG9yLnN1cGVyXyA9IHN1cGVyQ3RvclxuICAgIGN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckN0b3IucHJvdG90eXBlLCB7XG4gICAgICBjb25zdHJ1Y3Rvcjoge1xuICAgICAgICB2YWx1ZTogY3RvcixcbiAgICAgICAgZW51bWVyYWJsZTogZmFsc2UsXG4gICAgICAgIHdyaXRhYmxlOiB0cnVlLFxuICAgICAgICBjb25maWd1cmFibGU6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcbiAgfTtcbn0gZWxzZSB7XG4gIC8vIG9sZCBzY2hvb2wgc2hpbSBmb3Igb2xkIGJyb3dzZXJzXG4gIG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaW5oZXJpdHMoY3Rvciwgc3VwZXJDdG9yKSB7XG4gICAgY3Rvci5zdXBlcl8gPSBzdXBlckN0b3JcbiAgICB2YXIgVGVtcEN0b3IgPSBmdW5jdGlvbiAoKSB7fVxuICAgIFRlbXBDdG9yLnByb3RvdHlwZSA9IHN1cGVyQ3Rvci5wcm90b3R5cGVcbiAgICBjdG9yLnByb3RvdHlwZSA9IG5ldyBUZW1wQ3RvcigpXG4gICAgY3Rvci5wcm90b3R5cGUuY29uc3RydWN0b3IgPSBjdG9yXG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBJTlRFUk5BTDtcblxuZnVuY3Rpb24gSU5URVJOQUwoKSB7fSIsIid1c2Ugc3RyaWN0JztcbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgcmVqZWN0ID0gcmVxdWlyZSgnLi9yZWplY3QnKTtcbnZhciByZXNvbHZlID0gcmVxdWlyZSgnLi9yZXNvbHZlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IGFsbDtcbmZ1bmN0aW9uIGFsbChpdGVyYWJsZSkge1xuICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKGl0ZXJhYmxlKSAhPT0gJ1tvYmplY3QgQXJyYXldJykge1xuICAgIHJldHVybiByZWplY3QobmV3IFR5cGVFcnJvcignbXVzdCBiZSBhbiBhcnJheScpKTtcbiAgfVxuXG4gIHZhciBsZW4gPSBpdGVyYWJsZS5sZW5ndGg7XG4gIHZhciBjYWxsZWQgPSBmYWxzZTtcbiAgaWYgKCFsZW4pIHtcbiAgICByZXR1cm4gcmVzb2x2ZShbXSk7XG4gIH1cblxuICB2YXIgdmFsdWVzID0gbmV3IEFycmF5KGxlbik7XG4gIHZhciByZXNvbHZlZCA9IDA7XG4gIHZhciBpID0gLTE7XG4gIHZhciBwcm9taXNlID0gbmV3IFByb21pc2UoSU5URVJOQUwpO1xuICBcbiAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgIGFsbFJlc29sdmVyKGl0ZXJhYmxlW2ldLCBpKTtcbiAgfVxuICByZXR1cm4gcHJvbWlzZTtcbiAgZnVuY3Rpb24gYWxsUmVzb2x2ZXIodmFsdWUsIGkpIHtcbiAgICByZXNvbHZlKHZhbHVlKS50aGVuKHJlc29sdmVGcm9tQWxsLCBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgIGlmICghY2FsbGVkKSB7XG4gICAgICAgIGNhbGxlZCA9IHRydWU7XG4gICAgICAgIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCBlcnJvcik7XG4gICAgICB9XG4gICAgfSk7XG4gICAgZnVuY3Rpb24gcmVzb2x2ZUZyb21BbGwob3V0VmFsdWUpIHtcbiAgICAgIHZhbHVlc1tpXSA9IG91dFZhbHVlO1xuICAgICAgaWYgKCsrcmVzb2x2ZWQgPT09IGxlbiAmICFjYWxsZWQpIHtcbiAgICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgaGFuZGxlcnMucmVzb2x2ZShwcm9taXNlLCB2YWx1ZXMpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufSIsIid1c2Ugc3RyaWN0JztcbnZhciB0cnlDYXRjaCA9IHJlcXVpcmUoJy4vdHJ5Q2F0Y2gnKTtcbnZhciByZXNvbHZlVGhlbmFibGUgPSByZXF1aXJlKCcuL3Jlc29sdmVUaGVuYWJsZScpO1xudmFyIHN0YXRlcyA9IHJlcXVpcmUoJy4vc3RhdGVzJyk7XG5cbmV4cG9ydHMucmVzb2x2ZSA9IGZ1bmN0aW9uIChzZWxmLCB2YWx1ZSkge1xuICB2YXIgcmVzdWx0ID0gdHJ5Q2F0Y2goZ2V0VGhlbiwgdmFsdWUpO1xuICBpZiAocmVzdWx0LnN0YXR1cyA9PT0gJ2Vycm9yJykge1xuICAgIHJldHVybiBleHBvcnRzLnJlamVjdChzZWxmLCByZXN1bHQudmFsdWUpO1xuICB9XG4gIHZhciB0aGVuYWJsZSA9IHJlc3VsdC52YWx1ZTtcblxuICBpZiAodGhlbmFibGUpIHtcbiAgICByZXNvbHZlVGhlbmFibGUuc2FmZWx5KHNlbGYsIHRoZW5hYmxlKTtcbiAgfSBlbHNlIHtcbiAgICBzZWxmLnN0YXRlID0gc3RhdGVzLkZVTEZJTExFRDtcbiAgICBzZWxmLm91dGNvbWUgPSB2YWx1ZTtcbiAgICB2YXIgaSA9IC0xO1xuICAgIHZhciBsZW4gPSBzZWxmLnF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgICBzZWxmLnF1ZXVlW2ldLmNhbGxGdWxmaWxsZWQodmFsdWUpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gc2VsZjtcbn07XG5leHBvcnRzLnJlamVjdCA9IGZ1bmN0aW9uIChzZWxmLCBlcnJvcikge1xuICBzZWxmLnN0YXRlID0gc3RhdGVzLlJFSkVDVEVEO1xuICBzZWxmLm91dGNvbWUgPSBlcnJvcjtcbiAgdmFyIGkgPSAtMTtcbiAgdmFyIGxlbiA9IHNlbGYucXVldWUubGVuZ3RoO1xuICB3aGlsZSAoKytpIDwgbGVuKSB7XG4gICAgc2VsZi5xdWV1ZVtpXS5jYWxsUmVqZWN0ZWQoZXJyb3IpO1xuICB9XG4gIHJldHVybiBzZWxmO1xufTtcblxuZnVuY3Rpb24gZ2V0VGhlbihvYmopIHtcbiAgLy8gTWFrZSBzdXJlIHdlIG9ubHkgYWNjZXNzIHRoZSBhY2Nlc3NvciBvbmNlIGFzIHJlcXVpcmVkIGJ5IHRoZSBzcGVjXG4gIHZhciB0aGVuID0gb2JqICYmIG9iai50aGVuO1xuICBpZiAob2JqICYmIHR5cGVvZiBvYmogPT09ICdvYmplY3QnICYmIHR5cGVvZiB0aGVuID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIGFwcHlUaGVuKCkge1xuICAgICAgdGhlbi5hcHBseShvYmosIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG5cbmV4cG9ydHMucmVzb2x2ZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZScpO1xuZXhwb3J0cy5yZWplY3QgPSByZXF1aXJlKCcuL3JlamVjdCcpO1xuZXhwb3J0cy5hbGwgPSByZXF1aXJlKCcuL2FsbCcpO1xuZXhwb3J0cy5yYWNlID0gcmVxdWlyZSgnLi9yYWNlJyk7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1bndyYXAgPSByZXF1aXJlKCcuL3Vud3JhcCcpO1xudmFyIElOVEVSTkFMID0gcmVxdWlyZSgnLi9JTlRFUk5BTCcpO1xudmFyIHJlc29sdmVUaGVuYWJsZSA9IHJlcXVpcmUoJy4vcmVzb2x2ZVRoZW5hYmxlJyk7XG52YXIgc3RhdGVzID0gcmVxdWlyZSgnLi9zdGF0ZXMnKTtcbnZhciBRdWV1ZUl0ZW0gPSByZXF1aXJlKCcuL3F1ZXVlSXRlbScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFByb21pc2U7XG5mdW5jdGlvbiBQcm9taXNlKHJlc29sdmVyKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBQcm9taXNlKSkge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlcik7XG4gIH1cbiAgaWYgKHR5cGVvZiByZXNvbHZlciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3Jlc29sdmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIHRoaXMuc3RhdGUgPSBzdGF0ZXMuUEVORElORztcbiAgdGhpcy5xdWV1ZSA9IFtdO1xuICB0aGlzLm91dGNvbWUgPSB2b2lkIDA7XG4gIGlmIChyZXNvbHZlciAhPT0gSU5URVJOQUwpIHtcbiAgICByZXNvbHZlVGhlbmFibGUuc2FmZWx5KHRoaXMsIHJlc29sdmVyKTtcbiAgfVxufVxuXG5Qcm9taXNlLnByb3RvdHlwZVsnY2F0Y2gnXSA9IGZ1bmN0aW9uIChvblJlamVjdGVkKSB7XG4gIHJldHVybiB0aGlzLnRoZW4obnVsbCwgb25SZWplY3RlZCk7XG59O1xuUHJvbWlzZS5wcm90b3R5cGUudGhlbiA9IGZ1bmN0aW9uIChvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xuICBpZiAodHlwZW9mIG9uRnVsZmlsbGVkICE9PSAnZnVuY3Rpb24nICYmIHRoaXMuc3RhdGUgPT09IHN0YXRlcy5GVUxGSUxMRUQgfHxcbiAgICB0eXBlb2Ygb25SZWplY3RlZCAhPT0gJ2Z1bmN0aW9uJyAmJiB0aGlzLnN0YXRlID09PSBzdGF0ZXMuUkVKRUNURUQpIHtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcbiAgaWYgKHRoaXMuc3RhdGUgIT09IHN0YXRlcy5QRU5ESU5HKSB7XG4gICAgdmFyIHJlc29sdmVyID0gdGhpcy5zdGF0ZSA9PT0gc3RhdGVzLkZVTEZJTExFRCA/IG9uRnVsZmlsbGVkIDogb25SZWplY3RlZDtcbiAgICB1bndyYXAocHJvbWlzZSwgcmVzb2x2ZXIsIHRoaXMub3V0Y29tZSk7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5xdWV1ZS5wdXNoKG5ldyBRdWV1ZUl0ZW0ocHJvbWlzZSwgb25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpKTtcbiAgfVxuXG4gIHJldHVybiBwcm9taXNlO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbnZhciB1bndyYXAgPSByZXF1aXJlKCcuL3Vud3JhcCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFF1ZXVlSXRlbTtcbmZ1bmN0aW9uIFF1ZXVlSXRlbShwcm9taXNlLCBvbkZ1bGZpbGxlZCwgb25SZWplY3RlZCkge1xuICB0aGlzLnByb21pc2UgPSBwcm9taXNlO1xuICBpZiAodHlwZW9mIG9uRnVsZmlsbGVkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5vbkZ1bGZpbGxlZCA9IG9uRnVsZmlsbGVkO1xuICAgIHRoaXMuY2FsbEZ1bGZpbGxlZCA9IHRoaXMub3RoZXJDYWxsRnVsZmlsbGVkO1xuICB9XG4gIGlmICh0eXBlb2Ygb25SZWplY3RlZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMub25SZWplY3RlZCA9IG9uUmVqZWN0ZWQ7XG4gICAgdGhpcy5jYWxsUmVqZWN0ZWQgPSB0aGlzLm90aGVyQ2FsbFJlamVjdGVkO1xuICB9XG59XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLmNhbGxGdWxmaWxsZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaGFuZGxlcnMucmVzb2x2ZSh0aGlzLnByb21pc2UsIHZhbHVlKTtcbn07XG5RdWV1ZUl0ZW0ucHJvdG90eXBlLm90aGVyQ2FsbEZ1bGZpbGxlZCA9IGZ1bmN0aW9uICh2YWx1ZSkge1xuICB1bndyYXAodGhpcy5wcm9taXNlLCB0aGlzLm9uRnVsZmlsbGVkLCB2YWx1ZSk7XG59O1xuUXVldWVJdGVtLnByb3RvdHlwZS5jYWxsUmVqZWN0ZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgaGFuZGxlcnMucmVqZWN0KHRoaXMucHJvbWlzZSwgdmFsdWUpO1xufTtcblF1ZXVlSXRlbS5wcm90b3R5cGUub3RoZXJDYWxsUmVqZWN0ZWQgPSBmdW5jdGlvbiAodmFsdWUpIHtcbiAgdW53cmFwKHRoaXMucHJvbWlzZSwgdGhpcy5vblJlamVjdGVkLCB2YWx1ZSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcbnZhciByZWplY3QgPSByZXF1aXJlKCcuL3JlamVjdCcpO1xudmFyIHJlc29sdmUgPSByZXF1aXJlKCcuL3Jlc29sdmUnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gcmFjZTtcbmZ1bmN0aW9uIHJhY2UoaXRlcmFibGUpIHtcbiAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChpdGVyYWJsZSkgIT09ICdbb2JqZWN0IEFycmF5XScpIHtcbiAgICByZXR1cm4gcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ211c3QgYmUgYW4gYXJyYXknKSk7XG4gIH1cblxuICB2YXIgbGVuID0gaXRlcmFibGUubGVuZ3RoO1xuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGlmICghbGVuKSB7XG4gICAgcmV0dXJuIHJlc29sdmUoW10pO1xuICB9XG5cbiAgdmFyIGkgPSAtMTtcbiAgdmFyIHByb21pc2UgPSBuZXcgUHJvbWlzZShJTlRFUk5BTCk7XG5cbiAgd2hpbGUgKCsraSA8IGxlbikge1xuICAgIHJlc29sdmVyKGl0ZXJhYmxlW2ldKTtcbiAgfVxuICByZXR1cm4gcHJvbWlzZTtcbiAgZnVuY3Rpb24gcmVzb2x2ZXIodmFsdWUpIHtcbiAgICByZXNvbHZlKHZhbHVlKS50aGVuKGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgaWYgKCFjYWxsZWQpIHtcbiAgICAgICAgY2FsbGVkID0gdHJ1ZTtcbiAgICAgICAgaGFuZGxlcnMucmVzb2x2ZShwcm9taXNlLCByZXNwb25zZSk7XG4gICAgICB9XG4gICAgfSwgZnVuY3Rpb24gKGVycm9yKSB7XG4gICAgICBpZiAoIWNhbGxlZCkge1xuICAgICAgICBjYWxsZWQgPSB0cnVlO1xuICAgICAgICBoYW5kbGVycy5yZWplY3QocHJvbWlzZSwgZXJyb3IpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG59XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBQcm9taXNlID0gcmVxdWlyZSgnLi9wcm9taXNlJyk7XG52YXIgSU5URVJOQUwgPSByZXF1aXJlKCcuL0lOVEVSTkFMJyk7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG5tb2R1bGUuZXhwb3J0cyA9IHJlamVjdDtcblxuZnVuY3Rpb24gcmVqZWN0KHJlYXNvbikge1xuXHR2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKElOVEVSTkFMKTtcblx0cmV0dXJuIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCByZWFzb24pO1xufSIsIid1c2Ugc3RyaWN0JztcblxudmFyIFByb21pc2UgPSByZXF1aXJlKCcuL3Byb21pc2UnKTtcbnZhciBJTlRFUk5BTCA9IHJlcXVpcmUoJy4vSU5URVJOQUwnKTtcbnZhciBoYW5kbGVycyA9IHJlcXVpcmUoJy4vaGFuZGxlcnMnKTtcbm1vZHVsZS5leHBvcnRzID0gcmVzb2x2ZTtcblxudmFyIEZBTFNFID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIGZhbHNlKTtcbnZhciBOVUxMID0gaGFuZGxlcnMucmVzb2x2ZShuZXcgUHJvbWlzZShJTlRFUk5BTCksIG51bGwpO1xudmFyIFVOREVGSU5FRCA9IGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCB2b2lkIDApO1xudmFyIFpFUk8gPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgMCk7XG52YXIgRU1QVFlTVFJJTkcgPSBoYW5kbGVycy5yZXNvbHZlKG5ldyBQcm9taXNlKElOVEVSTkFMKSwgJycpO1xuXG5mdW5jdGlvbiByZXNvbHZlKHZhbHVlKSB7XG4gIGlmICh2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGhhbmRsZXJzLnJlc29sdmUobmV3IFByb21pc2UoSU5URVJOQUwpLCB2YWx1ZSk7XG4gIH1cbiAgdmFyIHZhbHVlVHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgc3dpdGNoICh2YWx1ZVR5cGUpIHtcbiAgICBjYXNlICdib29sZWFuJzpcbiAgICAgIHJldHVybiBGQUxTRTtcbiAgICBjYXNlICd1bmRlZmluZWQnOlxuICAgICAgcmV0dXJuIFVOREVGSU5FRDtcbiAgICBjYXNlICdvYmplY3QnOlxuICAgICAgcmV0dXJuIE5VTEw7XG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiBaRVJPO1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gRU1QVFlTVFJJTkc7XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG52YXIgaGFuZGxlcnMgPSByZXF1aXJlKCcuL2hhbmRsZXJzJyk7XG52YXIgdHJ5Q2F0Y2ggPSByZXF1aXJlKCcuL3RyeUNhdGNoJyk7XG5mdW5jdGlvbiBzYWZlbHlSZXNvbHZlVGhlbmFibGUoc2VsZiwgdGhlbmFibGUpIHtcbiAgLy8gRWl0aGVyIGZ1bGZpbGwsIHJlamVjdCBvciByZWplY3Qgd2l0aCBlcnJvclxuICB2YXIgY2FsbGVkID0gZmFsc2U7XG4gIGZ1bmN0aW9uIG9uRXJyb3IodmFsdWUpIHtcbiAgICBpZiAoY2FsbGVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNhbGxlZCA9IHRydWU7XG4gICAgaGFuZGxlcnMucmVqZWN0KHNlbGYsIHZhbHVlKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIG9uU3VjY2Vzcyh2YWx1ZSkge1xuICAgIGlmIChjYWxsZWQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY2FsbGVkID0gdHJ1ZTtcbiAgICBoYW5kbGVycy5yZXNvbHZlKHNlbGYsIHZhbHVlKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRyeVRvVW53cmFwKCkge1xuICAgIHRoZW5hYmxlKG9uU3VjY2Vzcywgb25FcnJvcik7XG4gIH1cbiAgXG4gIHZhciByZXN1bHQgPSB0cnlDYXRjaCh0cnlUb1Vud3JhcCk7XG4gIGlmIChyZXN1bHQuc3RhdHVzID09PSAnZXJyb3InKSB7XG4gICAgb25FcnJvcihyZXN1bHQudmFsdWUpO1xuICB9XG59XG5leHBvcnRzLnNhZmVseSA9IHNhZmVseVJlc29sdmVUaGVuYWJsZTsiLCIvLyBMYXp5IG1hbidzIHN5bWJvbHMgZm9yIHN0YXRlc1xuXG5leHBvcnRzLlJFSkVDVEVEID0gWydSRUpFQ1RFRCddO1xuZXhwb3J0cy5GVUxGSUxMRUQgPSBbJ0ZVTEZJTExFRCddO1xuZXhwb3J0cy5QRU5ESU5HID0gWydQRU5ESU5HJ107XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gdHJ5Q2F0Y2g7XG5cbmZ1bmN0aW9uIHRyeUNhdGNoKGZ1bmMsIHZhbHVlKSB7XG4gIHZhciBvdXQgPSB7fTtcbiAgdHJ5IHtcbiAgICBvdXQudmFsdWUgPSBmdW5jKHZhbHVlKTtcbiAgICBvdXQuc3RhdHVzID0gJ3N1Y2Nlc3MnO1xuICB9IGNhdGNoIChlKSB7XG4gICAgb3V0LnN0YXR1cyA9ICdlcnJvcic7XG4gICAgb3V0LnZhbHVlID0gZTtcbiAgfVxuICByZXR1cm4gb3V0O1xufSIsIid1c2Ugc3RyaWN0JztcblxudmFyIGltbWVkaWF0ZSA9IHJlcXVpcmUoJ2ltbWVkaWF0ZScpO1xudmFyIGhhbmRsZXJzID0gcmVxdWlyZSgnLi9oYW5kbGVycycpO1xubW9kdWxlLmV4cG9ydHMgPSB1bndyYXA7XG5cbmZ1bmN0aW9uIHVud3JhcChwcm9taXNlLCBmdW5jLCB2YWx1ZSkge1xuICBpbW1lZGlhdGUoZnVuY3Rpb24gKCkge1xuICAgIHZhciByZXR1cm5WYWx1ZTtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuVmFsdWUgPSBmdW5jKHZhbHVlKTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICByZXR1cm4gaGFuZGxlcnMucmVqZWN0KHByb21pc2UsIGUpO1xuICAgIH1cbiAgICBpZiAocmV0dXJuVmFsdWUgPT09IHByb21pc2UpIHtcbiAgICAgIGhhbmRsZXJzLnJlamVjdChwcm9taXNlLCBuZXcgVHlwZUVycm9yKCdDYW5ub3QgcmVzb2x2ZSBwcm9taXNlIHdpdGggaXRzZWxmJykpO1xuICAgIH0gZWxzZSB7XG4gICAgICBoYW5kbGVycy5yZXNvbHZlKHByb21pc2UsIHJldHVyblZhbHVlKTtcbiAgICB9XG4gIH0pO1xufSIsIid1c2Ugc3RyaWN0JztcbnZhciB0eXBlcyA9IFtcbiAgcmVxdWlyZSgnLi9uZXh0VGljaycpLFxuICByZXF1aXJlKCcuL211dGF0aW9uLmpzJyksXG4gIHJlcXVpcmUoJy4vbWVzc2FnZUNoYW5uZWwnKSxcbiAgcmVxdWlyZSgnLi9zdGF0ZUNoYW5nZScpLFxuICByZXF1aXJlKCcuL3RpbWVvdXQnKVxuXTtcbnZhciBkcmFpbmluZztcbnZhciBxdWV1ZSA9IFtdO1xuLy9uYW1lZCBuZXh0VGljayBmb3IgbGVzcyBjb25mdXNpbmcgc3RhY2sgdHJhY2VzXG5mdW5jdGlvbiBuZXh0VGljaygpIHtcbiAgZHJhaW5pbmcgPSB0cnVlO1xuICB2YXIgaSwgb2xkUXVldWU7XG4gIHZhciBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gIHdoaWxlIChsZW4pIHtcbiAgICBvbGRRdWV1ZSA9IHF1ZXVlO1xuICAgIHF1ZXVlID0gW107XG4gICAgaSA9IC0xO1xuICAgIHdoaWxlICgrK2kgPCBsZW4pIHtcbiAgICAgIG9sZFF1ZXVlW2ldKCk7XG4gICAgfVxuICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgfVxuICBkcmFpbmluZyA9IGZhbHNlO1xufVxudmFyIHNjaGVkdWxlRHJhaW47XG52YXIgaSA9IC0xO1xudmFyIGxlbiA9IHR5cGVzLmxlbmd0aDtcbndoaWxlICgrKyBpIDwgbGVuKSB7XG4gIGlmICh0eXBlc1tpXSAmJiB0eXBlc1tpXS50ZXN0ICYmIHR5cGVzW2ldLnRlc3QoKSkge1xuICAgIHNjaGVkdWxlRHJhaW4gPSB0eXBlc1tpXS5pbnN0YWxsKG5leHRUaWNrKTtcbiAgICBicmVhaztcbiAgfVxufVxubW9kdWxlLmV4cG9ydHMgPSBpbW1lZGlhdGU7XG5mdW5jdGlvbiBpbW1lZGlhdGUodGFzaykge1xuICBpZiAocXVldWUucHVzaCh0YXNrKSA9PT0gMSAmJiAhZHJhaW5pbmcpIHtcbiAgICBzY2hlZHVsZURyYWluKCk7XG4gIH1cbn0iLCIndXNlIHN0cmljdCc7XG5cbmV4cG9ydHMudGVzdCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKGdsb2JhbC5zZXRJbW1lZGlhdGUpIHtcbiAgICAvLyB3ZSBjYW4gb25seSBnZXQgaGVyZSBpbiBJRTEwXG4gICAgLy8gd2hpY2ggZG9lc24ndCBoYW5kZWwgcG9zdE1lc3NhZ2Ugd2VsbFxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHlwZW9mIGdsb2JhbC5NZXNzYWdlQ2hhbm5lbCAhPT0gJ3VuZGVmaW5lZCc7XG59O1xuXG5leHBvcnRzLmluc3RhbGwgPSBmdW5jdGlvbiAoZnVuYykge1xuICB2YXIgY2hhbm5lbCA9IG5ldyBnbG9iYWwuTWVzc2FnZUNoYW5uZWwoKTtcbiAgY2hhbm5lbC5wb3J0MS5vbm1lc3NhZ2UgPSBmdW5jO1xuICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgIGNoYW5uZWwucG9ydDIucG9zdE1lc3NhZ2UoMCk7XG4gIH07XG59OyIsIid1c2Ugc3RyaWN0Jztcbi8vYmFzZWQgb2ZmIHJzdnAgaHR0cHM6Ly9naXRodWIuY29tL3RpbGRlaW8vcnN2cC5qc1xuLy9saWNlbnNlIGh0dHBzOi8vZ2l0aHViLmNvbS90aWxkZWlvL3JzdnAuanMvYmxvYi9tYXN0ZXIvTElDRU5TRVxuLy9odHRwczovL2dpdGh1Yi5jb20vdGlsZGVpby9yc3ZwLmpzL2Jsb2IvbWFzdGVyL2xpYi9yc3ZwL2FzYXAuanNcblxudmFyIE11dGF0aW9uID0gZ2xvYmFsLk11dGF0aW9uT2JzZXJ2ZXIgfHwgZ2xvYmFsLldlYktpdE11dGF0aW9uT2JzZXJ2ZXI7XG5cbmV4cG9ydHMudGVzdCA9IGZ1bmN0aW9uICgpIHtcbiAgcmV0dXJuIE11dGF0aW9uO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKGhhbmRsZSkge1xuICB2YXIgY2FsbGVkID0gMDtcbiAgdmFyIG9ic2VydmVyID0gbmV3IE11dGF0aW9uKGhhbmRsZSk7XG4gIHZhciBlbGVtZW50ID0gZ2xvYmFsLmRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgb2JzZXJ2ZXIub2JzZXJ2ZShlbGVtZW50LCB7XG4gICAgY2hhcmFjdGVyRGF0YTogdHJ1ZVxuICB9KTtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBlbGVtZW50LmRhdGEgPSAoY2FsbGVkID0gKytjYWxsZWQgJSAyKTtcbiAgfTtcbn07IiwiJ3VzZSBzdHJpY3QnO1xuXG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiAnZG9jdW1lbnQnIGluIGdsb2JhbCAmJiAnb25yZWFkeXN0YXRlY2hhbmdlJyBpbiBnbG9iYWwuZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0Jyk7XG59O1xuXG5leHBvcnRzLmluc3RhbGwgPSBmdW5jdGlvbiAoaGFuZGxlKSB7XG4gIHJldHVybiBmdW5jdGlvbiAoKSB7XG5cbiAgICAvLyBDcmVhdGUgYSA8c2NyaXB0PiBlbGVtZW50OyBpdHMgcmVhZHlzdGF0ZWNoYW5nZSBldmVudCB3aWxsIGJlIGZpcmVkIGFzeW5jaHJvbm91c2x5IG9uY2UgaXQgaXMgaW5zZXJ0ZWRcbiAgICAvLyBpbnRvIHRoZSBkb2N1bWVudC4gRG8gc28sIHRodXMgcXVldWluZyB1cCB0aGUgdGFzay4gUmVtZW1iZXIgdG8gY2xlYW4gdXAgb25jZSBpdCdzIGJlZW4gY2FsbGVkLlxuICAgIHZhciBzY3JpcHRFbCA9IGdsb2JhbC5kb2N1bWVudC5jcmVhdGVFbGVtZW50KCdzY3JpcHQnKTtcbiAgICBzY3JpcHRFbC5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbiAoKSB7XG4gICAgICBoYW5kbGUoKTtcblxuICAgICAgc2NyaXB0RWwub25yZWFkeXN0YXRlY2hhbmdlID0gbnVsbDtcbiAgICAgIHNjcmlwdEVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoc2NyaXB0RWwpO1xuICAgICAgc2NyaXB0RWwgPSBudWxsO1xuICAgIH07XG4gICAgZ2xvYmFsLmRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5hcHBlbmRDaGlsZChzY3JpcHRFbCk7XG5cbiAgICByZXR1cm4gaGFuZGxlO1xuICB9O1xufTsiLCIndXNlIHN0cmljdCc7XG5leHBvcnRzLnRlc3QgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiB0cnVlO1xufTtcblxuZXhwb3J0cy5pbnN0YWxsID0gZnVuY3Rpb24gKHQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICBzZXRUaW1lb3V0KHQsIDApO1xuICB9O1xufTsiXX0=
