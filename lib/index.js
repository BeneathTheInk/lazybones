var PouchDB = require("pouchdb");

var Lazybones = module.exports = require("./lazybones");
Lazybones.utils = require("./utils");
Lazybones.Document = require("./document");
Lazybones.Backbone = require("backbone");
Lazybones.PouchDB = PouchDB;
Lazybones.sync = require("./sync");

PouchDB.plugin({
	lazybones: function(options) {
		return new Lazybones(this, options);
	}
});