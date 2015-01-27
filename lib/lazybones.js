/**
 * # Lazybones
 *
 * Lazybones is a modified Backbone collection that integrates with PouchDB. By combining Backbone's object-oriented approach with PouchDB's super flexible databases, Lazybones provides a highly-functional API for storing and manipulating data in the browser and Node.js.
 *
 * A deeper understanding of [Backbone](http://backbonejs.org) is recommended since many of Lazybones methods and concepts are inherited directly from Backbone. Knowledge of PouchDB's API is also recommended, but not required to use Lazybones.
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
 * To use Lazybones, create a new database instance with a name or PouchDB instance:
 * 
 * ```javascript
 * var db = new Lazybones("testdb");
 * ```
 * 
 * Databases are always created with an associated PouchDB instance. If PouchDB needs to be specially initialized, instances can be created ahead of time and passed in via `options.pouch`. Otherwise, the Lazybones constructor will create a new PouchDB instance from the `name` argument.
 * 
 * #### Arguments
 * 
 * - **name** _PouchDB | string_  - A PouchDB instance or a database name. This could also be `null` or an array like a traditional Backbone collection, however then the PouchDB instance must be passed via `options.pouch`.
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
	 * ## Instance Properties & Methods
	 *
	 * These properties are addition to methods provided by `Backbone.Collection`.
	 */
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

	/**
	 * ### _prepareModel()
	 *
	 * Any models created from the collection should have references back to the underlying PouchDB instance. This helps during syncing, but is also useful inside the model classes. This custom `_prepareModel()` method overrides Backbone's to ensure the PouchDB is always passed along to documents.
	 */
	_prepareModel: function(attrs, options) {
		options = options || {};
		if (options.pouch == null) options.pouch = this.pouch;
		return Backbone.Collection.prototype._prepareModel.call(this, attrs, options);
	}

}, {

	/**
	 * ## Static Methods & Properties
	 * 
	 * - **Lazybones.utils** _object_ - Lazybones and PouchDB utility methods.
	 * - **Lazybones.Document** _function_ - The Document constructor, which is a subclass of `Backbone.Model`.
	 * - **Lazybones.sync** _function_ - The Lazybones sync method. This replaces `Backbone.sync`.
	 * - **Lazybones.extend** _function_ - Creates a subclass of Lazybones. This is the same method that Backbone uses.
	 */
	VERSION: '0.2.0',
	utils: utils,
	sync: sync,
	Document: Document,
	Backbone: Backbone,
	PouchDB: PouchDB

});