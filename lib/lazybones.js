/**
 * # Lazybones
 *
 * Lazybones is a modified Backbone collection that integrates with PouchDB. By combining Backbone's object-oriented approach with PouchDB's super flexible databases, Lazybones provides a highly-functional API for storing and manipulating data in the browser and Node.js.
 *
 * A deeper understanding of [Backbone](http://backbonejs.org) is recommended since many of Lazybones methods and concepts are inherited directly from Backbone Collection. Knowledge of PouchDB's API is also recommended, but not required to use Lazybones.
 */

var _ = require("underscore"),
	Backbone = require("backbone"),
	PouchDB = require("pouchdb"),
	Promise = require("bluebird");

var utils = require("./utils"),
	Document = require("./document"),
	sync = require("./sync");

/**
 * ## Constructor
 *
 * To use Lazybones, create a new database instance with a name:
 * 
 * ```javascript
 * var db = new Lazybones("testdb");
 * ```
 * 
 * Databases are always created with an associated PouchDB instance. If PouchDB needs to be specially initialized, instances can be created ahead of time and passed in via `options.pouch`. Otherwise, the Lazybones constructor will create a new PouchDB instance from the `name` argument.
 * 
 * #### Arguments
 * 
 * - **name** _string_ - The name of the Pouch database to connect to. This can either be a local database name (indexeddb or leveldb) or a remote CouchDB url. This argument is required and a `MISSING_ID` error is thrown when not provided.
 * - **options** _object; optional_ - An object of options to initiate the database with. This variable is passed directly to the `Backbone.Collection` constructor.
 *   - **options.pouch** _object | PouchDB_ - An instance of PouchDB or an object of options to pass to the PouchDB constructor.
 */

module.exports = Backbone.Collection.extend({

	constructor: function(models, options) {
		options = options || {};
		var pouch;

		if (typeof models === "string") {
			pouch = new PouchDB(models, options.pouch);
			models = null;
		} if (models instanceof PouchDB) {
			pouch = models;
			models = null;
		} else if (options.pouch) {
			pouch = options.pouch;
		}

		if (!(pouch instanceof PouchDB)) {
			throw new utils.LazyError("INVALID_POUCH");
		}

		this.pouch = pouch;
		pouch.once("destroyed", this.trigger.bind(this, "destroyed"));

		return Backbone.Collection.call(this, models, options);
	},

/**
 * ## Instance Properties
 * 
 * - **db.name** _string; non-writeable_ - The database name passed in to the constructor is set as a non-writeable property on the instance to make easy to access.
 * - **db.model** _function_ - The model constructor to use when creating documents from data. This defaults to `Lazybones.Document`, but can be any subclass of `Backbone.Model` or a function which returns new model instances.
 *
 * ## Instance Methods
 *
 * These methods are addition to methods provided by `Backbone.Collection`.
 */

	// add externally declared methods
	model: Document,
	parse: utils.parse,
	sync: require("./sync"),

	/**
	 * ### connect()
	 *
	 * Listens to the PouchDB changes feed and sets any changes on the in-memory [Documents](document.html). By default, the changes are "live" meaning that changes will be listened for continuously. Use `db.disconnect()` to stop a live connection.
	 *
	 * `this` is returned for method chaining.
	 * 
	 * #### Arguments
	 * 
	 * - **options** _object; optional_ - An object of properties that are passed to `pouch.changes()`. All PouchDB changes properties are allowed, except for `include_docs` which is set to true. Below are the properties with default values. Please see the [PocuhDB documentation](http://pouchdb.com/api.html#changes) for the remaining options.
	 *   - **options.attachments** _boolean_ - Whether or not to include attachment data in the request. If `true`, attachments will be accessible via the `_attachments` attribute. Default value is `false`.
	 *   - **options.conflicts** _boolean_ - Whether or not to include conflicting revision ids in the `_conflicts` attribute. Default value is `true`.
	 *   - **options.returnDocs** _boolean_ - Tells PouchDB to not return all the documents on the `complete` event, preventing a lot of extra memory usage. Default value is `false`.
	 *   - **options.live** _boolean_ - The database will continuously listen for changes, keeping the in-memory documents in sync with those in the database. Setting this to `false` will result in the database disconnecting as soon as it is has been caught up. Default value is `true`.
	 */
	connect: function(options) {
		var self = this;

		// always disconnect first
		this.disconnect();

		// create/update function
		function onChange(row) {
			self.add(row.doc, { merge: true, pouch: self.pouch });
		}

		// uptodate event should only be called once per connection
		var onUpToDate = _.once(function(info) {
			self.trigger("uptodate", info);
		});

		// the listener
		var listener =
		this._pouchChange = this.pouch.changes(_.extend({
			live: true
		}, options, {
			include_docs: true
		}))

		// listen for uptodate
		.on("uptodate", onUpToDate)
		.on("complete", onUpToDate) // when live = false

		// creates and updates are handled the same
		.on("create", onChange)
		.on("update", onChange)

		// remove everything marked as a delete
		.on("delete", function(row) {
			self.remove(row.id);
		});

		// catch any terminating errors
		Promise.cast(listener.catch(function(e) {
			self.trigger("error", e);
		}))

		.finally(function(resp) {
			// clean up
			self.disconnect();

			// announce disconnect
			self.trigger("disconnect", listener, resp);
		});

		// annouce the connection
		this.trigger("connect", listener);

		return this;
	},

	/**
	 * ### disconnect()
	 * 
	 * Stops the database from listening to the PouchDB changes feed. This method has no effect if the database is not currently connected.
	 *
	 * `this` is returned for method chaining.
	 */
	disconnect: function() {
		// only disconnect if connected
		if (this.isConnected()) {
			this._pouchChange.cancel();
			delete this._pouchChange;
		}

		return this;
	},

	/**
	 * ### isConnected()
	 * 
	 * Returns `true` if the Lazybones instance is actively listening to the PouchDB changes feed.
	 */
	isConnected: function() {
		return this._pouchChange != null;
	},

	/**
	 * ### destroy()
	 *
	 * Destroys the underlying PouchDB database. This will keep all the existing documents in-memory, so call `db.reset()` to remove those as well. The Lazybones instance should not used after this method has been called.
	 *
	 * This method returns a promise that is resolved when the database is destroyed.
	 */
	destroy: function() {
		// disconnect live connection
		this.disconnect();

		// destroy the underlying pouch database
		return Promise.cast(this.pouch.destroy()).bind(this);
	},

	_prepareModel: function(attrs, options) {
		options = options || {};
		if (options.pouch == null) options.pouch = this.pouch;
		return Backbone.Collection.prototype._prepareModel.call(this, attrs, options);
	}

});