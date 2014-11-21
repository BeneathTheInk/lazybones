var _ = require("underscore"),
	PouchDB = require("pouchdb");

// load the database
var Database = module.exports = require("./database");

// current version
Database.VERSION = "0.1.0";

// load other parts
Database.utils = require("./utils");
Database.Document = require("./document");