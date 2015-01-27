/**
 * # Document
 *
 * Lazybones uses the Document class to represent a single document in the database. This class directly extends `Backbone.Model` and keeps it more or less true to its original form.
 */

var _ = require("underscore"),
	Backbone = require("backbone"),
	utils = require("./utils");

/**
 * ## Constructor
 *
 * To create a new document model, use `db.add()` on the Lazybones instance. This ensures the document is properly initialized, with correct reference back to the PouchDB object.
 *
 * ```javascript
 * var model = db.add({ foo: "bar" });
 * ```
 *
 * Documents always have an `_id` attribute. If one is not provided on creation, a new id is randomly generated and assigned.
 * 
 * #### Arguments
 * 
 * - **attr** _object_ - An object of initial properties for the document.
 * - **options** _object; optional_ - An object of options to initiate the document with. This variable is passed directly to the `Backbone.Model` constructor.
 *   - **options.pouch** _PouchDB - An instance of PouchDB to use as the attached database. This value is used by `Lazybones.sync` to make database writes.
 */

var Document =
module.exports = Backbone.Model.extend({

	constructor: function(attrs, options) {
		if (attrs == null) attrs = {};

		// make sure there is always an id
		if (attrs._id == null) attrs._id = utils.uuid();

		// attach any passed pouch references
		if (options && options.pouch) this.pouch = options.pouch;

		// call parent constructor
		Backbone.Model.call(this, attrs, options);
	},

	/**
	 * ## Instance Properties & Methods
	 *
	 * These properties are in addition to the properties set by `Backbone.Model`.
	 * 
	 * - **db.omitKeys** _array[string]_ - An array of attribute keys that `doc.toJSON()` will ignore. This is useful if there are attributes that should remain in-memory only and not be saved to the database.
	 */
	
	idAttribute: "_id",
	parse: utils.parse,
	sync: require("./sync"),
	omitKeys: null,

	/**
	 * ### toJSON()
	 *
	 * Produces a plain JavaScript object that can be saved directly to PouchDB. Date values are converted to ISO strings. Any keys found in the `doc.omitKeys` array are removed from the output.
	 */
	toJSON: function() {
		var data = Backbone.Model.prototype.toJSON.apply(this, arguments);

		// omit specified keys
		var omitKeys = _.result(this, "omitKeys");
		if (_.isArray(omitKeys)) data = _.omit(data, omitKeys);

		// convert dates
		Object.keys(data).forEach(function(key) {
			if (_.isDate(data[key])) {
				data[key] = data[key].toISOString();
			}
		});

		return data;
	},

	/**
	 * ### isNew()
	 *
	 * Determines if the document has ever been saved to the database by checking if `_rev` attribute exists.
	 */
	isNew: function() {
		return !this.has("_rev");
	}

});

/**
 * ## Backbone Symlink
 *
 * Document inherit methods from [Backbone Symlink](https://github.com/BeneathTheInk/backbone-symlink). This allows the document to have attribute id references to other documents.
 */
require("backbone-symlink").configure(Document);